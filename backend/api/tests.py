from datetime import datetime
from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.models import ActivityType, Category, Client, Collaborator, Company, Person, ProjectItemType, ProjectType, Site, Task


def make_collaborator(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Collaborator.objects.create(person=person, **kwargs)
from projects.models import Project, ProjectItem, ProjectTask, RackPosition, TaskDependency, TaskExecutionEvent, WorkBlock
from projects.analytics import build_activity_productivity
from scope_import.ai_provider import AIProviderError, OpenRouterProvider
from scope_import.models import ScopeImport
from scope_import.services import run_ai_interpretation
from updates.models import DailyUpdate, DailyUpdateAllocation
from users.models import User


class DashboardTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")

    def _login(self, is_superuser=True):
        user = User.objects.create_superuser(
            username="dashboard_admin",
            email="dashboard@example.com",
            password="test-password",
        ) if is_superuser else User.objects.create_user(
            username="dashboard_user",
            email="dashboard-user@example.com",
            password="test-password",
            company=self.company,
        )
        self.client_api.force_authenticate(user=user)
        return user

    def test_projects_performance_requires_authentication(self):
        response = self.client_api.get(reverse("dashboard-projects"))
        self.assertEqual(response.status_code, 401)

    def test_projects_performance_summary(self):
        self._login()
        Project.objects.create(
            company=self.company, name="Projeto Ativo", status=Project.STATUS_IN_PROGRESS, link_count=10,
        )
        completed = Project.objects.create(
            company=self.company, name="Projeto Concluído", status=Project.STATUS_COMPLETED, link_count=5,
        )
        task = Task.objects.create(name="Instalação")
        completed_task = ProjectTask.objects.create(
            project=completed,
            task=task,
            status=ProjectTask.STATUS_COMPLETED,
            actual_start=timezone.make_aware(datetime(2026, 1, 1, 8, 0)),
            actual_end=timezone.make_aware(datetime(2026, 1, 1, 12, 0)),
        )

        response = self.client_api.get(reverse("dashboard-projects"))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["summary"]["total_projects"], 2)
        self.assertEqual(data["summary"]["total_links"], 15)
        self.assertEqual(data["summary"]["total_worked_hours"], 4.0)
        statuses = {row["status"]: row["count"] for row in data["by_status"]}
        self.assertEqual(statuses.get("in_progress"), 1)
        self.assertEqual(statuses.get("completed"), 1)
        completed_row = next(row for row in data["projects"] if row["id"] == completed.pk)
        self.assertEqual(completed_row["worked_hours"], 4.0)
        self.assertEqual(completed_row["completed_tasks"], 1)
        self.assertEqual(completed_task.task, task)

    def test_projects_performance_filters_by_status(self):
        self._login()
        Project.objects.create(company=self.company, name="Ativo", status=Project.STATUS_IN_PROGRESS)
        Project.objects.create(company=self.company, name="Pausado", status=Project.STATUS_PAUSED)

        response = self.client_api.get(reverse("dashboard-projects"), {"status": "paused"})

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["summary"]["total_projects"], 1)
        self.assertEqual(data["projects"][0]["name"], "Pausado")

    def test_technical_performance_aggregates_hours_tasks_and_links(self):
        self._login()
        project = Project.objects.create(company=self.company, name="Projeto Rack", has_rack_positions=True)
        rack_a = RackPosition.objects.create(project=project, position="RACK01", links=24)
        rack_b = RackPosition.objects.create(project=project, position="RACK02", links=12)
        collaborator = make_collaborator(self.company, "Técnico Um")
        other_collaborator = make_collaborator(self.company, "Técnico Dois")
        task = Task.objects.create(name="Lançamento de Cabos")

        completed_task = ProjectTask.objects.create(
            project=project,
            task=task,
            status=ProjectTask.STATUS_COMPLETED,
            actual_start=timezone.make_aware(datetime(2026, 2, 1, 8, 0)),
            actual_end=timezone.make_aware(datetime(2026, 2, 1, 10, 0)),
        )
        completed_task.collaborators.add(collaborator)
        completed_task.rack_positions.set([rack_a, rack_b])

        other_task = Task.objects.create(name="Outra Tarefa")
        not_completed_task = ProjectTask.objects.create(project=project, task=other_task)
        not_completed_task.collaborators.add(collaborator)

        response = self.client_api.get(reverse("dashboard-technical"))

        self.assertEqual(response.status_code, 200)
        data = response.json()
        rows = {row["collaborator_id"]: row for row in data["collaborators"]}
        self.assertIn(collaborator.pk, rows)
        row = rows[collaborator.pk]
        self.assertEqual(row["tasks_total"], 2)
        self.assertEqual(row["tasks_completed"], 1)
        self.assertEqual(row["hours_worked"], 2.0)
        self.assertEqual(row["links_executed"], 36)
        self.assertEqual(rows[other_collaborator.pk]["tasks_total"], 0)

    def test_technical_performance_filters_by_date_range(self):
        self._login()
        project = Project.objects.create(company=self.company, name="Projeto Período")
        collaborator = make_collaborator(self.company, "Técnico Período")
        task_in_range = Task.objects.create(name="Tarefa Dentro do Período")
        task_out_of_range = Task.objects.create(name="Tarefa Fora do Período")

        pt_in_range = ProjectTask.objects.create(
            project=project,
            task=task_in_range,
            status=ProjectTask.STATUS_COMPLETED,
            actual_start=timezone.make_aware(datetime(2026, 3, 10, 8, 0)),
            actual_end=timezone.make_aware(datetime(2026, 3, 10, 9, 0)),
        )
        pt_in_range.collaborators.add(collaborator)

        pt_out_of_range = ProjectTask.objects.create(
            project=project,
            task=task_out_of_range,
            status=ProjectTask.STATUS_COMPLETED,
            actual_start=timezone.make_aware(datetime(2026, 5, 10, 8, 0)),
            actual_end=timezone.make_aware(datetime(2026, 5, 10, 9, 0)),
        )
        pt_out_of_range.collaborators.add(collaborator)

        response = self.client_api.get(
            reverse("dashboard-technical"),
            {"date_from": "2026-03-01", "date_to": "2026-03-31"},
        )

        self.assertEqual(response.status_code, 200)
        row = next(r for r in response.json()["collaborators"] if r["collaborator_id"] == collaborator.pk)
        self.assertEqual(row["tasks_total"], 2)
        self.assertEqual(row["tasks_completed"], 1)
        self.assertEqual(row["hours_worked"], 1.0)

    def test_technical_performance_requires_permission(self):
        user = self._login(is_superuser=False)
        response = self.client_api.get(reverse("dashboard-technical"))
        self.assertEqual(response.status_code, 403)
        self.assertFalse(user.is_superuser)


class RackPositionApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(
            company=self.company, name="Projeto Rack", status=Project.STATUS_IN_PROGRESS, has_rack_positions=True,
        )
        user = User.objects.create_superuser(username="rack_admin", email="rack@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_create_list_update_delete(self):
        create = self.client_api.post(
            "/api/rack-positions/", {"project": self.project.pk, "position": "RACK01", "dh": "DH1", "links": 24, "utp": 48},
        )
        self.assertEqual(create.status_code, 201, create.data)
        rack_id = create.data["id"]

        listed = self.client_api.get("/api/rack-positions/", {"project": self.project.pk})
        self.assertEqual(listed.data["count"], 1)

        updated = self.client_api.patch(f"/api/rack-positions/{rack_id}/", {"links": 30})
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.data["links"], 30)

        deleted = self.client_api.delete(f"/api/rack-positions/{rack_id}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(RackPosition.objects.filter(project=self.project).count(), 0)

    def test_create_blank_links_defaults_to_zero(self):
        response = self.client_api.post("/api/rack-positions/", {"project": self.project.pk, "position": "RACK02"})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["links"], 0)
        self.assertEqual(response.data["utp"], 0)

    def test_bulk_create(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/rack-positions/bulk/",
            {"text": "RACK01;DH1;24;48\nRACK02;;12\nRACK01;DH1;24;48"},
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(RackPosition.objects.filter(project=self.project).count(), 2)

    def test_bulk_create_requires_has_rack_positions(self):
        self.project.has_rack_positions = False
        self.project.save(update_fields=["has_rack_positions"])
        response = self.client_api.post(f"/api/projects/{self.project.pk}/rack-positions/bulk/", {"text": "RACK01"})
        self.assertEqual(response.status_code, 400)

    def test_bulk_create_invalid_line_reports_error(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/rack-positions/bulk/", {"text": "RACK01;DH1;abc"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("Links inválido", response.data["detail"])


class ProjectTaskApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Tarefas", status=Project.STATUS_IN_PROGRESS)
        self.task_a = Task.objects.create(name="Instalação")
        self.task_b = Task.objects.create(name="Certificação")
        self.collaborator = make_collaborator(self.company, "Fulano")
        user = User.objects.create_superuser(username="tasks_admin", email="tasks@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_create_assigns_incremental_order(self):
        first = self.client_api.post("/api/project-tasks/", {"project": self.project.pk, "task": self.task_a.pk})
        second = self.client_api.post("/api/project-tasks/", {"project": self.project.pk, "task": self.task_b.pk})
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(first.data["order"], 1)
        self.assertEqual(second.data["order"], 2)

    def test_update_collaborators_via_collaborator_ids(self):
        project_task = ProjectTask.objects.create(project=self.project, task=self.task_a, order=1)
        response = self.client_api.patch(
            f"/api/project-tasks/{project_task.pk}/", {"collaborator_ids": [self.collaborator.pk]}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(list(project_task.collaborators.values_list("pk", flat=True)), [self.collaborator.pk])

    def test_rack_position_from_other_project_rejected(self):
        other_project = Project.objects.create(company=self.company, name="Outro Projeto")
        foreign_rack = RackPosition.objects.create(project=other_project, position="RACK99")
        response = self.client_api.post(
            "/api/project-tasks/",
            {"project": self.project.pk, "task": self.task_a.pk, "rack_positions": [foreign_rack.pk]},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("rack_positions", response.data)

    def test_delete(self):
        project_task = ProjectTask.objects.create(project=self.project, task=self.task_a, order=1)
        response = self.client_api.delete(f"/api/project-tasks/{project_task.pk}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(ProjectTask.objects.filter(pk=project_task.pk).exists())

    def test_import_tasks_from_project_type(self):
        project_type = ProjectType.objects.create(name="Instalação Padrão")
        project_type.tasks.set([self.task_a, self.task_b])
        self.project.project_type = project_type
        self.project.save(update_fields=["project_type"])

        response = self.client_api.post(f"/api/projects/{self.project.pk}/import-tasks/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(self.project.project_tasks.count(), 2)

    def test_import_tasks_without_project_type_fails(self):
        response = self.client_api.post(f"/api/projects/{self.project.pk}/import-tasks/")
        self.assertEqual(response.status_code, 400)

    def test_bulk_add_from_catalog(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "add", "add_task_ids": [self.task_a.pk, self.task_b.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)

    def test_bulk_update_status_and_collaborators(self):
        pt1 = ProjectTask.objects.create(project=self.project, task=self.task_a, order=1)
        pt2 = ProjectTask.objects.create(project=self.project, task=self.task_b, order=2)

        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {
                "action": "update",
                "task_ids": [pt1.pk, pt2.pk],
                "status": ProjectTask.STATUS_IN_PROGRESS,
                "collaborator_ids": [self.collaborator.pk],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated"], 2)
        pt1.refresh_from_db()
        self.assertEqual(pt1.status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertEqual(list(pt1.collaborators.values_list("pk", flat=True)), [self.collaborator.pk])

    def test_bulk_delete(self):
        pt1 = ProjectTask.objects.create(project=self.project, task=self.task_a, order=1)
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "delete", "task_ids": [pt1.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["deleted"], 1)
        self.assertFalse(ProjectTask.objects.filter(pk=pt1.pk).exists())

    def test_bulk_update_without_values_returns_error(self):
        pt1 = ProjectTask.objects.create(project=self.project, task=self.task_a, order=1)
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "update", "task_ids": [pt1.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_tasks_bulk_requires_change_permission(self):
        self.client_api.force_authenticate(user=None)
        limited_user = User.objects.create_user(
            username="limited", email="limited@example.com", password="test-password", company=self.company,
        )
        self.client_api.force_authenticate(user=limited_user)
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/", {"action": "delete", "task_ids": [1]}, format="json",
        )
        self.assertEqual(response.status_code, 403)


class ProjectTaskRackPositionExplodeApiTests(TestCase):
    """Uma Tarefa aplicada a vários Rack Positions deve virar uma
    ProjectTask por Rack Position (não uma tarefa só cobrindo todos)."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(
            company=self.company, name="Projeto Rack", status=Project.STATUS_IN_PROGRESS, has_rack_positions=True,
        )
        self.rack_a = RackPosition.objects.create(project=self.project, position="01-02-060-25")
        self.rack_b = RackPosition.objects.create(project=self.project, position="01-02-060-26")
        self.rack_c = RackPosition.objects.create(project=self.project, position="01-02-060-27")
        self.task = Task.objects.create(name="Aplicação de Label")
        self.collaborator = make_collaborator(self.company, "Fulano")
        user = User.objects.create_superuser(username="explode_admin", email="explode@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_tasks_create_explodes_one_per_rack_position(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/create/",
            {
                "task": self.task.pk,
                "rack_position_ids": [self.rack_a.pk, self.rack_b.pk, self.rack_c.pk],
                "collaborator_ids": [self.collaborator.pk],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 3)
        self.assertEqual(response.data["skipped"], 0)
        project_tasks = ProjectTask.objects.filter(project=self.project, task=self.task)
        self.assertEqual(project_tasks.count(), 3)
        for pt in project_tasks:
            self.assertEqual(pt.rack_positions.count(), 1)
            self.assertEqual(list(pt.collaborators.values_list("pk", flat=True)), [self.collaborator.pk])

    def test_tasks_create_skips_existing_rack_position(self):
        pt = ProjectTask.objects.create(project=self.project, task=self.task, order=1)
        pt.rack_positions.set([self.rack_a])

        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/create/",
            {"task": self.task.pk, "rack_position_ids": [self.rack_a.pk, self.rack_b.pk]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(ProjectTask.objects.filter(project=self.project, task=self.task).count(), 2)

    def test_tasks_create_without_rack_positions_creates_single_task(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/create/", {"task": self.task.pk}, format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        project_task = ProjectTask.objects.get(project=self.project, task=self.task)
        self.assertEqual(project_task.rack_positions.count(), 0)

    def test_tasks_create_rejects_foreign_rack_position(self):
        other_project = Project.objects.create(company=self.company, name="Outro Projeto")
        foreign_rack = RackPosition.objects.create(project=other_project, position="RACK99")
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/create/",
            {"task": self.task.pk, "rack_position_ids": [foreign_rack.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_add_from_catalog_explodes_across_existing_rack_positions(self):
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "add", "add_task_ids": [self.task.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 3)
        self.assertEqual(ProjectTask.objects.filter(project=self.project, task=self.task).count(), 3)

    def test_add_from_catalog_with_explicit_rack_positions(self):
        second_task = Task.objects.create(name="Conectorização UTP")
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {
                "action": "add",
                "add_task_ids": [self.task.pk, second_task.pk],
                "rack_position_ids": [self.rack_a.pk, self.rack_b.pk],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 4)
        self.assertEqual(ProjectTask.objects.filter(project=self.project, task=self.task).count(), 2)
        self.assertEqual(ProjectTask.objects.filter(project=self.project, task=second_task).count(), 2)
        self.assertFalse(ProjectTask.objects.filter(project=self.project, rack_positions=self.rack_c).exists())

    def test_add_from_catalog_rejects_foreign_rack_position(self):
        other_project = Project.objects.create(company=self.company, name="Outro Projeto")
        foreign_rack = RackPosition.objects.create(project=other_project, position="RACK99")
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "add", "add_task_ids": [self.task.pk], "rack_position_ids": [foreign_rack.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_import_tasks_from_project_type_explodes_across_rack_positions(self):
        project_type = ProjectType.objects.create(name="Padrão Rack")
        project_type.tasks.set([self.task])
        self.project.project_type = project_type
        self.project.save(update_fields=["project_type"])

        response = self.client_api.post(f"/api/projects/{self.project.pk}/import-tasks/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 3)

    def test_direct_create_same_task_different_rack_positions_allowed(self):
        first = self.client_api.post(
            "/api/project-tasks/", {"project": self.project.pk, "task": self.task.pk, "rack_positions": [self.rack_a.pk]},
        )
        second = self.client_api.post(
            "/api/project-tasks/", {"project": self.project.pk, "task": self.task.pk, "rack_positions": [self.rack_b.pk]},
        )
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(second.status_code, 201, second.data)

    def test_direct_create_duplicate_rack_position_rejected(self):
        ProjectTask.objects.create(project=self.project, task=self.task, order=1).rack_positions.set([self.rack_a])
        response = self.client_api.post(
            "/api/project-tasks/", {"project": self.project.pk, "task": self.task.pk, "rack_positions": [self.rack_a.pk]},
        )
        self.assertEqual(response.status_code, 400)

    def test_direct_create_duplicate_without_rack_position_rejected(self):
        ProjectTask.objects.create(project=self.project, task=self.task, order=1)
        response = self.client_api.post("/api/project-tasks/", {"project": self.project.pk, "task": self.task.pk})
        self.assertEqual(response.status_code, 400)


class WorkBlockProjectItemApiTests(TestCase):
    """Fase 2 do módulo de tarefas: WorkBlock/ProjectItem (CRUD escopado por
    projeto), catálogos ActivityType/ProjectItemType, e o resumo agregado
    planning-summary."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Planejamento", status=Project.STATUS_IN_PROGRESS)
        self.other_project = Project.objects.create(company=self.company, name="Outro Projeto")
        # Nomes distintos dos já semeados pela migration 0032 (core.ActivityType/
        # ProjectItemType têm o catálogo padrão pré-populado no banco de teste
        # também, já que migrations de dados rodam ao montar o banco de teste).
        self.item_type = ProjectItemType.objects.create(name="Cabo óptico (teste)")
        self.activity_type = ActivityType.objects.create(name="Lançamento de cabo óptico (teste)")
        user = User.objects.create_superuser(username="planning_admin", email="planning@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_work_block_create_list_scoped_by_project(self):
        create = self.client_api.post("/api/work-blocks/", {"project": self.project.pk, "name": "UMN"})
        self.assertEqual(create.status_code, 201, create.data)
        WorkBlock.objects.create(project=self.other_project, name="Bloco de outro projeto")

        listed = self.client_api.get("/api/work-blocks/", {"project": self.project.pk})
        self.assertEqual(listed.data["count"], 1)
        self.assertEqual(listed.data["results"][0]["name"], "UMN")

    def test_project_item_create_and_filter_by_work_block(self):
        block = WorkBlock.objects.create(project=self.project, name="BFC")
        other_block = WorkBlock.objects.create(project=self.project, name="EG1")
        ProjectItem.objects.create(project=self.project, work_block=block, item_type=self.item_type, internal_code="ROB-001")
        ProjectItem.objects.create(project=self.project, work_block=other_block, item_type=self.item_type, internal_code="ROB-002")

        response = self.client_api.get(f"/api/projects/{self.project.pk}/items/", {"work_block": block.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["internal_code"], "ROB-001")

    def test_project_item_rejects_cross_project_via_api_scoping(self):
        foreign_item = ProjectItem.objects.create(project=self.other_project, item_type=self.item_type, internal_code="X")
        response = self.client_api.get(f"/api/project-items/{foreign_item.pk}/", {"project": self.project.pk})
        # Escopado por ?project= no queryset — some da listagem filtrada, mas o
        # detail continua acessível por pk direto (mesmo padrão do RackPositionViewSet,
        # que não isola detail por query param). Confirma só que o filtro por
        # querystring de fato exclui itens de outro projeto na listagem.
        listed = self.client_api.get("/api/project-items/", {"project": self.project.pk})
        self.assertNotIn(foreign_item.pk, [row["id"] for row in listed.data["results"]])

    def test_planning_summary_groups_by_block_and_activity_type(self):
        block = WorkBlock.objects.create(project=self.project, name="UMN")
        # Dois ITENS diferentes no mesmo bloco, cada um com uma tarefa do
        # mesmo tipo de atividade — não dá pra usar o mesmo item nas duas
        # (a constraint unique_activity_per_item da Fase 1 impede duas
        # tarefas do mesmo tipo de atividade no mesmo item).
        item_a = ProjectItem.objects.create(project=self.project, work_block=block, item_type=self.item_type, internal_code="ROB-001")
        item_b = ProjectItem.objects.create(project=self.project, work_block=block, item_type=self.item_type, internal_code="ROB-002")
        ProjectTask.objects.create(
            project=self.project, activity_type=self.activity_type, project_item=item_a, work_block=block,
            quantity_planned="20", quantity_completed="20", status=ProjectTask.STATUS_COMPLETED, order=1,
        )
        ProjectTask.objects.create(
            project=self.project, activity_type=self.activity_type, project_item=item_b, work_block=block,
            quantity_planned="15", quantity_completed="0", status=ProjectTask.STATUS_NOT_STARTED, order=2,
        )
        # Tarefa sem bloco/tipo de atividade (caminho antigo) — deve cair no
        # "balde" null, sem quebrar o agrupamento das outras.
        ProjectTask.objects.create(project=self.project, custom_name="Tarefa avulsa antiga", order=3)

        response = self.client_api.get(f"/api/projects/{self.project.pk}/planning-summary/")

        self.assertEqual(response.status_code, 200, response.data)
        rows = {(row["work_block_id"], row["activity_type_id"]): row for row in response.data}
        grouped = rows[(block.pk, self.activity_type.pk)]
        self.assertEqual(grouped["task_count"], 2)
        self.assertEqual(grouped["completed_task_count"], 1)
        self.assertEqual(str(grouped["quantity_planned"]), "35.00")
        self.assertEqual(str(grouped["quantity_completed"]), "20.00")
        null_bucket = rows[(None, None)]
        self.assertEqual(null_bucket["task_count"], 1)

    def test_bulk_update_new_fields(self):
        pt = ProjectTask.objects.create(project=self.project, custom_name="Tarefa", order=1)
        block = WorkBlock.objects.create(project=self.project, name="UMN")

        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {
                "action": "update",
                "task_ids": [pt.pk],
                "work_block": block.pk,
                "activity_type": self.activity_type.pk,
                "quantity_planned": "42.5",
                "quantity_completed": "10",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated"], 1)
        pt.refresh_from_db()
        self.assertEqual(pt.work_block_id, block.pk)
        self.assertEqual(pt.activity_type_id, self.activity_type.pk)
        self.assertEqual(str(pt.quantity_planned), "42.50")

    def test_bulk_update_old_shape_payload_unaffected(self):
        """Regressão: chamar tasks/bulk sem nenhum dos 4 campos novos da
        Fase 2 continua se comportando exatamente como antes."""
        pt = ProjectTask.objects.create(project=self.project, custom_name="Tarefa", order=1)
        response = self.client_api.post(
            f"/api/projects/{self.project.pk}/tasks/bulk/",
            {"action": "update", "task_ids": [pt.pk], "status": ProjectTask.STATUS_IN_PROGRESS},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        pt.refresh_from_db()
        self.assertEqual(pt.status, ProjectTask.STATUS_IN_PROGRESS)
        self.assertIsNone(pt.work_block_id)
        self.assertIsNone(pt.activity_type_id)

    def test_activity_type_registry_crud(self):
        create = self.client_api.post("/api/registry/activity-types/", {"name": "Handover (teste)", "default_unit": "un"})
        self.assertEqual(create.status_code, 201, create.data)
        listed = self.client_api.get("/api/registry/activity-types/", {"search": "Handover (teste)"})
        self.assertEqual(listed.data["count"], 1)

    def test_project_item_type_registry_crud(self):
        create = self.client_api.post("/api/registry/project-item-types/", {"name": "Equipamento de teste"})
        self.assertEqual(create.status_code, 201, create.data)
        listed = self.client_api.get("/api/registry/project-item-types/")
        self.assertGreaterEqual(listed.data["count"], 1)


class ScopeImportApiTests(TestCase):
    """Fase 4 do módulo de tarefas: importação de escopo assistida por IA.
    `OpenRouterProvider.interpret_scope` é sempre mockado — o teste nunca
    deve bater na API real do OpenRouter."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Importação", status=Project.STATUS_IN_PROGRESS)
        self.item_type = ProjectItemType.objects.create(name="Cabo óptico (scope-teste)")
        self.activity_type = ActivityType.objects.create(name="Lançamento de cabo óptico (scope-teste)")
        self.user = User.objects.create_superuser(username="scope_admin", email="scope@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.user)
        # Em produção a interpretação roda numa thread separada (ver
        # api.views._dispatch_interpretation) — numa thread de verdade ela
        # usaria uma conexão de banco fora da transação do teste e nunca
        # veria os fixtures criados acima. Substitui por execução síncrona
        # só pra teste, mantendo a mesma lógica de negócio (run_ai_interpretation).
        dispatch_patcher = patch("api.views._dispatch_interpretation", side_effect=run_ai_interpretation)
        self.addCleanup(dispatch_patcher.stop)
        dispatch_patcher.start()

    def _ai_response(self, item_type_name=None, activity_type_name=None):
        return {
            "work_blocks": [
                {
                    "name": "UMN",
                    "items": [
                        {
                            "internal_code": "UMN-CB-001",
                            "item_type": item_type_name or self.item_type.name,
                            "technology": "Robust 2F",
                            "fiber_count": None,
                            "length_meters": 20,
                            "origin": "Rack A",
                            "destination": "Rack B",
                            "route": "",
                            "priority": "medium",
                            "complexity": "simple",
                            "tasks": [
                                {
                                    "activity_type": activity_type_name or self.activity_type.name,
                                    "quantity_planned": 20,
                                    "unit": "m",
                                }
                            ],
                        }
                    ],
                }
            ]
        }

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_create_runs_interpretation_and_becomes_ready(self, mock_interpret):
        mock_interpret.return_value = self._ai_response()

        response = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "lançar cabo Robust 2F 20m entre rack A e B"}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ScopeImport.STATUS_READY)
        self.assertEqual(response.data["requested_by"], self.user.pk)
        blocks = response.data["ai_raw_response"]["work_blocks"]
        item = blocks[0]["items"][0]
        self.assertEqual(item["item_type_id"], self.item_type.pk)
        self.assertFalse(item["item_type_unmatched"])
        task = item["tasks"][0]
        self.assertEqual(task["activity_type_id"], self.activity_type.pk)
        self.assertFalse(task["activity_type_unmatched"])

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_create_marks_unmatched_catalog_values(self, mock_interpret):
        mock_interpret.return_value = self._ai_response(item_type_name="Tipo Inventado", activity_type_name="Atividade Inventada")

        response = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        item = response.data["ai_raw_response"]["work_blocks"][0]["items"][0]
        self.assertIsNone(item["item_type_id"])
        self.assertTrue(item["item_type_unmatched"])
        task = item["tasks"][0]
        self.assertIsNone(task["activity_type_id"])
        self.assertTrue(task["activity_type_unmatched"])

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_create_marks_failed_on_provider_error(self, mock_interpret):
        mock_interpret.side_effect = AIProviderError("timeout simulado")

        response = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["status"], ScopeImport.STATUS_FAILED)
        self.assertIn("timeout simulado", response.data["error_message"])

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_retry_reprocesses_same_row(self, mock_interpret):
        mock_interpret.side_effect = AIProviderError("falha passageira")
        created = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")
        scope_import_id = created.data["id"]

        mock_interpret.side_effect = None
        mock_interpret.return_value = self._ai_response()
        response = self.client_api.post(f"/api/scope-imports/{scope_import_id}/retry/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], ScopeImport.STATUS_READY)
        self.assertEqual(ScopeImport.objects.count(), 1)

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_confirm_creates_records_linked_to_scope_import(self, mock_interpret):
        mock_interpret.return_value = self._ai_response()
        created = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")
        reviewed_payload = created.data["ai_raw_response"]

        response = self.client_api.post(
            f"/api/scope-imports/{created.data['id']}/confirm/", {"reviewed_payload": reviewed_payload}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["counts"], {"work_blocks": 1, "items": 1, "tasks": 1})
        self.assertEqual(response.data["scope_import"]["status"], ScopeImport.STATUS_CONFIRMED)

        block = WorkBlock.objects.get(project=self.project, name="UMN")
        item = ProjectItem.objects.get(project=self.project, internal_code="UMN-CB-001")
        task = ProjectTask.objects.get(project_item=item)
        self.assertEqual(block.scope_import_id, created.data["id"])
        self.assertEqual(item.scope_import_id, created.data["id"])
        self.assertEqual(task.scope_import_id, created.data["id"])
        self.assertEqual(item.work_block_id, block.pk)
        self.assertEqual(task.work_block_id, block.pk)

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_confirm_rejects_unresolved_catalog_reference(self, mock_interpret):
        mock_interpret.return_value = self._ai_response(item_type_name="Tipo Inventado")
        created = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")
        reviewed_payload = created.data["ai_raw_response"]

        response = self.client_api.post(
            f"/api/scope-imports/{created.data['id']}/confirm/", {"reviewed_payload": reviewed_payload}, format="json"
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(ProjectItem.objects.count(), 0)

    @patch.object(OpenRouterProvider, "interpret_scope")
    def test_discard_marks_status(self, mock_interpret):
        mock_interpret.return_value = self._ai_response()
        created = self.client_api.post("/api/scope-imports/", {"project": self.project.pk, "raw_text": "texto qualquer"}, format="json")

        response = self.client_api.post(f"/api/scope-imports/{created.data['id']}/discard/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], ScopeImport.STATUS_DISCARDED)


class RegistryCsvApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        user = User.objects.create_superuser(username="csv_admin", email="csv@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_export_csv(self):
        Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA", trade_name="Consultimer")
        response = self.client_api.get("/api/registry/companies/export-csv/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        content = response.content.decode("utf-8-sig")
        self.assertIn("Consultimer", content)
        self.assertIn("razão social", content)

    def test_list_ordering_by_updated_at(self):
        older = Company.objects.create(legal_name="EMPRESA ANTIGA")
        newer = Company.objects.create(legal_name="EMPRESA NOVA")
        older.legal_name = "EMPRESA ANTIGA EDITADA"
        older.save()

        response = self.client_api.get("/api/registry/companies/", {"ordering": "-updated_at", "page_size": "2"})

        self.assertEqual(response.status_code, 200)
        names = [row["legal_name"] for row in response.data["results"]]
        self.assertEqual(names[0], "EMPRESA ANTIGA EDITADA")

    def test_list_ordering_ignores_unknown_field(self):
        Company.objects.create(legal_name="EMPRESA X")
        response = self.client_api.get("/api/registry/companies/", {"ordering": "tax_id; DROP TABLE"})
        self.assertEqual(response.status_code, 200)

    def test_import_csv_creates_rows(self):
        csv_content = "razão social;nome fantasia\nCONSULTIMER BRASIL LTDA;Consultimer\nOUTRA EMPRESA LTDA;Outra\n"
        upload = SimpleUploadedFile("companies.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/registry/companies/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        self.assertEqual(Company.objects.count(), 2)

    def test_import_csv_reports_row_errors(self):
        csv_content = "razão social;nome fantasia;e-mail\nCONSULTIMER BRASIL LTDA;Consultimer;nao-e-um-email\n"
        upload = SimpleUploadedFile("companies.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/registry/companies/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 0)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertIn("Linha 2", response.data["errors"][0])

    def test_import_csv_requires_add_permission(self):
        self.client_api.force_authenticate(user=None)
        limited_user = User.objects.create_user(username="limited_csv", email="limited-csv@example.com", password="test-password")
        self.client_api.force_authenticate(user=limited_user)
        upload = SimpleUploadedFile("companies.csv", b"Razao Social\nX\n", content_type="text/csv")
        response = self.client_api.post("/api/registry/companies/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 403)


class BulkCreateApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        user = User.objects.create_superuser(username="bulk_admin", email="bulk@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_project_type_bulk_create(self):
        response = self.client_api.post(
            "/api/registry/project-types/bulk-create/",
            {"names": ["Fibra Óptica", "Fibra Óptica", " ", "Cabeamento Estruturado"], "description": "Padrão", "is_active": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(ProjectType.objects.filter(description="Padrão").count(), 2)

    def test_project_type_bulk_create_requires_names(self):
        response = self.client_api.post("/api/registry/project-types/bulk-create/", {"names": []}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_task_bulk_create_assigns_project_types(self):
        pt = ProjectType.objects.create(name="Fibra Óptica")
        response = self.client_api.post(
            "/api/registry/tasks/bulk-create/",
            {"names": ["Lançamento", "Certificação"], "estimated_hours": "2.5", "project_types": [pt.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        tasks = Task.objects.filter(name__in=["Lançamento", "Certificação"])
        self.assertEqual(tasks.count(), 2)
        for task in tasks:
            self.assertTrue(task.code)
            self.assertEqual(list(task.project_types.values_list("pk", flat=True)), [pt.pk])

    def test_task_bulk_create_requires_add_permission(self):
        self.client_api.force_authenticate(user=None)
        limited_user = User.objects.create_user(username="limited_bulk", email="limited-bulk@example.com", password="test-password")
        self.client_api.force_authenticate(user=limited_user)
        response = self.client_api.post("/api/registry/tasks/bulk-create/", {"names": ["X"]}, format="json")
        self.assertEqual(response.status_code, 403)


class SiteMapAndGeocodeApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_obj = Client.objects.create(company=self.company, legal_name="Cliente Teste")
        user = User.objects.create_superuser(username="site_admin", email="site@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    @patch("core.geocoding.geocode_site_address")
    def test_map_data_lists_geocoded_active_sites(self, mock_geocode):
        mock_geocode.side_effect = lambda address, city, state: (-23.55, -46.63) if address else None
        site = Site.objects.create(client=self.client_obj, name="Site 1", address="Rua Teste, 100", city="São Paulo", state="SP")
        Project.objects.create(company=self.company, name="Projeto Ativo", site=site, status=Project.STATUS_IN_PROGRESS)
        Site.objects.create(client=self.client_obj, name="Sem Endereço")

        response = self.client_api.get("/api/registry/sites/map-data/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["points_count"], 1)
        self.assertEqual(response.data["without_coords"], 1)
        point = response.data["points"][0]
        self.assertEqual(point["lat"], -23.55)
        self.assertEqual(len(point["projects"]), 1)
        self.assertEqual(point["projects"][0]["name"], "Projeto Ativo")

    @patch("core.geocoding.geocode_site_address", return_value=(-10.0, -20.0))
    def test_regeocode_single_site(self, mock_geocode):
        site = Site.objects.create(client=self.client_obj, name="Site 1", address="Endereço Antigo")
        mock_geocode.return_value = (-11.0, -21.0)

        response = self.client_api.post(f"/api/registry/sites/{site.pk}/regeocode/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(float(response.data["latitude"]), -11.0)

    def test_regeocode_manual_coordinates_rejected(self):
        site = Site.objects.create(
            client=self.client_obj, name="Site Manual", manual_coordinates=True, latitude=-1, longitude=-1,
        )
        response = self.client_api.post(f"/api/registry/sites/{site.pk}/regeocode/")
        self.assertEqual(response.status_code, 400)

    @patch("core.geocoding.geocode_site_address", return_value=(-5.0, -5.0))
    def test_regeocode_bulk_skips_manual_and_reports_counts(self, mock_geocode):
        auto_site = Site.objects.create(client=self.client_obj, name="Auto", address="Endereço")
        manual_site = Site.objects.create(client=self.client_obj, name="Manual", manual_coordinates=True, latitude=1, longitude=1)

        response = self.client_api.post("/api/registry/sites/regeocode-bulk/", {"ids": [auto_site.pk, manual_site.pk]}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["updated"], 1)
        self.assertEqual(response.data["skipped_manual"], 1)

    def test_regeocode_requires_change_permission(self):
        site = Site.objects.create(client=self.client_obj, name="Site 1")
        self.client_api.force_authenticate(user=None)
        limited_user = User.objects.create_user(username="limited_site", email="limited-site@example.com", password="test-password")
        self.client_api.force_authenticate(user=limited_user)
        response = self.client_api.post(f"/api/registry/sites/{site.pk}/regeocode/")
        self.assertEqual(response.status_code, 403)


class AuditLogApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")

    def test_requires_superuser(self):
        user = User.objects.create_user(username="regular", email="regular@example.com", password="test-password", company=self.company)
        self.client_api.force_authenticate(user=user)
        response = self.client_api.get("/api/audit-logs/")
        self.assertEqual(response.status_code, 403)

    def test_superuser_lists_and_filters(self):
        superuser = User.objects.create_superuser(username="auditor", email="auditor@example.com", password="test-password")
        AuditLog.objects.create(app_label="core", model_name="company", object_repr="Empresa A", action=AuditLog.ACTION_CREATE)
        AuditLog.objects.create(app_label="projects", model_name="project", object_repr="Projeto X", action=AuditLog.ACTION_UPDATE)
        self.client_api.force_authenticate(user=superuser)

        response = self.client_api.get("/api/audit-logs/")
        self.assertEqual(response.status_code, 200)
        reprs = [row["object_repr"] for row in response.data["results"]]
        self.assertIn("Empresa A", reprs)
        self.assertIn("Projeto X", reprs)

        filtered = self.client_api.get("/api/audit-logs/", {"app_label": "core", "model_name": "company", "search": "Empresa A"})
        self.assertEqual(filtered.data["count"], 1)
        self.assertEqual(filtered.data["results"][0]["object_repr"], "Empresa A")

        searched = self.client_api.get("/api/audit-logs/", {"search": "Projeto X"})
        self.assertEqual(searched.data["count"], 1)

    def test_readonly_no_write_actions(self):
        superuser = User.objects.create_superuser(username="auditor2", email="auditor2@example.com", password="test-password")
        self.client_api.force_authenticate(user=superuser)
        response = self.client_api.post("/api/audit-logs/", {"app_label": "core"}, format="json")
        self.assertEqual(response.status_code, 405)


class DailyUpdateConsolidatedPdfApiTests(TestCase):
    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Teste", status=Project.STATUS_IN_PROGRESS)
        self.collaborator = make_collaborator(self.company, "Fulano")
        user = User.objects.create_superuser(username="pdf_admin", email="pdf@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)

    def test_pdf_consolidado_requires_valid_date(self):
        response = self.client_api.get("/api/daily-updates/pdf-consolidado/")
        self.assertEqual(response.status_code, 400)

    def test_pdf_consolidado_404_when_no_updates(self):
        response = self.client_api.get("/api/daily-updates/pdf-consolidado/", {"date": "2026-01-01"})
        self.assertEqual(response.status_code, 404)

    def test_pdf_consolidado_returns_pdf(self):
        daily_update = DailyUpdate.objects.create(allocation_date=datetime(2026, 6, 1).date())
        allocation = DailyUpdateAllocation.objects.create(daily_update=daily_update, project=self.project)
        allocation.collaborators.add(self.collaborator)

        response = self.client_api.get("/api/daily-updates/pdf-consolidado/", {"date": "2026-06-01"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")

    def test_pdf_consolidado_requires_change_permission(self):
        self.client_api.force_authenticate(user=None)
        limited_user = User.objects.create_user(username="limited_pdf", email="limited-pdf@example.com", password="test-password")
        self.client_api.force_authenticate(user=limited_user)
        response = self.client_api.get("/api/daily-updates/pdf-consolidado/", {"date": "2026-06-01"})
        self.assertEqual(response.status_code, 403)


class ClientUserAccessScopeApiTests(TestCase):
    """Escopo de acesso do usuário-cliente: um Usuário com Cliente vinculado
    (User.client) só enxerga os Projetos daquele Cliente (e dos Sites/
    Categorias marcados em User.client_sites/client_categories)."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_a = Client.objects.create(company=self.company, legal_name="Cliente A")
        self.client_b = Client.objects.create(company=self.company, legal_name="Cliente B")
        self.site_a1 = Site.objects.create(client=self.client_a, name="Site A1")
        self.site_a2 = Site.objects.create(client=self.client_a, name="Site A2")
        self.project_a1 = Project.objects.create(company=self.company, name="Projeto A1", client=self.client_a, site=self.site_a1)
        self.project_a2 = Project.objects.create(company=self.company, name="Projeto A2", client=self.client_a, site=self.site_a2)
        self.project_b = Project.objects.create(company=self.company, name="Projeto B", client=self.client_b)

    def _client_user(self, username, *, client, sites=(), categories=(), perms=("view_project",)):
        user = User.objects.create_user(
            username=username, email=f"{username}@example.com", password="test-password", company=self.company, client=client,
        )
        for codename in perms:
            app_label = "projects" if "project" in codename else "core"
            perm = Permission.objects.get(codename=codename, content_type__app_label=app_label)
            user.user_permissions.add(perm)
        user.client_sites.set(sites)
        user.client_categories.set(categories)
        self.client_api.force_authenticate(user=user)
        return user

    def test_unrestricted_user_sees_all_projects(self):
        user = User.objects.create_superuser(username="admin_scope", email="admin_scope@example.com", password="test-password")
        self.client_api.force_authenticate(user=user)
        response = self.client_api.get("/api/projects/")
        self.assertEqual(response.data["count"], 3)

    def test_client_user_restricted_to_own_client(self):
        self._client_user("cliente_a_user", client=self.client_a)
        response = self.client_api.get("/api/projects/")
        self.assertEqual(response.status_code, 200)
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"Projeto A1", "Projeto A2"})

    def test_client_user_restricted_further_by_site(self):
        self._client_user("cliente_a_site1_user", client=self.client_a, sites=[self.site_a1])
        response = self.client_api.get("/api/projects/")
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"Projeto A1"})

    def test_client_user_cannot_retrieve_out_of_scope_project(self):
        self._client_user("cliente_a_user2", client=self.client_a)
        response = self.client_api.get(f"/api/projects/{self.project_b.pk}/")
        self.assertEqual(response.status_code, 404)

    def test_client_user_project_tasks_filtered_by_project_scope(self):
        task_catalog = Task.objects.create(name="Instalação")
        ProjectTask.objects.create(project=self.project_a1, task=task_catalog, order=1)
        ProjectTask.objects.create(project=self.project_b, task=task_catalog, order=1)
        self._client_user("cliente_a_tasks_user", client=self.client_a, perms=("view_project", "view_projecttask"))
        response = self.client_api.get("/api/project-tasks/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["project"], self.project_a1.pk)

    def test_staff_user_without_client_link_is_unrestricted(self):
        user = User.objects.create_user(username="staff_no_scope", email="staff@example.com", password="test-password", company=self.company)
        perm = Permission.objects.get(codename="view_project", content_type__app_label="projects")
        user.user_permissions.add(perm)
        self.client_api.force_authenticate(user=user)
        response = self.client_api.get("/api/projects/")
        self.assertEqual(response.data["count"], 3)

    def test_category_scope_restricts_registry(self):
        cat_allowed = Category.objects.create(name="Categoria Permitida")
        cat_blocked = Category.objects.create(name="Categoria Bloqueada")
        self._client_user("cat_user", client=self.client_a, categories=[cat_allowed], perms=("view_category",))
        response = self.client_api.get("/api/registry/categories/")
        self.assertEqual(response.status_code, 200)
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"Categoria Permitida"})
        self.assertNotIn(cat_blocked.name, names)

    def test_category_scope_also_restricts_projects(self):
        cat_allowed = Category.objects.create(name="Categoria Permitida")
        cat_blocked = Category.objects.create(name="Categoria Bloqueada")
        self.project_a1.category = cat_allowed
        self.project_a1.save(update_fields=["category"])
        self.project_a2.category = cat_blocked
        self.project_a2.save(update_fields=["category"])

        self._client_user("cat_project_user", client=self.client_a, categories=[cat_allowed])
        response = self.client_api.get("/api/projects/")

        self.assertEqual(response.status_code, 200)
        names = {row["name"] for row in response.data["results"]}
        self.assertEqual(names, {"Projeto A1"})


class TaskExecutionEventApiTests(TestCase):
    """Fase 5: instrumentação de TaskExecutionEvent (STARTED/COMPLETED via
    Minhas Tarefas, DISPATCHED via despacho) e as métricas/pool que
    dependem dela."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Execução", status=Project.STATUS_IN_PROGRESS)
        self.activity_type = ActivityType.objects.create(name="Lançamento (evento-teste)")
        self.item_type = ProjectItemType.objects.create(name="Cabo (evento-teste)")
        self.item = ProjectItem.objects.create(project=self.project, item_type=self.item_type, technology="Robust 2F", internal_code="EV-001")

        self.tech_user = User.objects.create_user(username="tecnico1", email="tecnico1@example.com", password="test-password")
        person = Person.objects.create(name="Técnico Um", company=self.company, user=self.tech_user)
        self.collaborator = Collaborator.objects.create(person=person)

        self.admin = User.objects.create_superuser(username="event_admin", email="event_admin@example.com", password="test-password")

    def _create_task(self, **extra):
        task = ProjectTask.objects.create(
            project=self.project, activity_type=self.activity_type, project_item=self.item,
            quantity_planned="20", unit="m", order=1, **extra,
        )
        task.collaborators.set([self.collaborator])
        return task

    def test_transition_to_in_progress_creates_started_event(self):
        task = self._create_task()
        self.client_api.force_authenticate(user=self.tech_user)

        response = self.client_api.patch(
            f"/api/my-tasks/{task.pk}/", {"status": ProjectTask.STATUS_IN_PROGRESS, "actual_start": timezone.now().isoformat()}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.data)
        events = list(TaskExecutionEvent.objects.filter(project_task=task))
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0].event_type, TaskExecutionEvent.EVENT_STARTED)
        self.assertEqual(events[0].collaborator_id, self.collaborator.pk)

    def test_transition_to_completed_records_quantity_delta(self):
        task = self._create_task(status=ProjectTask.STATUS_IN_PROGRESS, actual_start=timezone.now(), quantity_completed="5")
        self.client_api.force_authenticate(user=self.tech_user)

        response = self.client_api.patch(
            f"/api/my-tasks/{task.pk}/",
            {"status": ProjectTask.STATUS_COMPLETED, "actual_end": timezone.now().isoformat(), "quantity_completed": "20"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        event = TaskExecutionEvent.objects.get(project_task=task, event_type=TaskExecutionEvent.EVENT_COMPLETED)
        self.assertEqual(str(event.quantity_delta), "15.00")

    def test_no_event_when_status_unchanged(self):
        task = self._create_task(status=ProjectTask.STATUS_IN_PROGRESS, actual_start=timezone.now())
        self.client_api.force_authenticate(user=self.tech_user)

        response = self.client_api.patch(f"/api/my-tasks/{task.pk}/", {"notes": "só uma observação"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(TaskExecutionEvent.objects.filter(project_task=task).count(), 0)

    def test_dispatch_creates_dispatched_event(self):
        task = ProjectTask.objects.create(project=self.project, custom_name="Tarefa avulsa", order=1)
        self.client_api.force_authenticate(user=self.admin)

        response = self.client_api.post(f"/api/project-tasks/{task.pk}/dispatch/", {"collaborator_ids": [self.collaborator.pk]}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        event = TaskExecutionEvent.objects.get(project_task=task, event_type=TaskExecutionEvent.EVENT_DISPATCHED)
        self.assertEqual(event.collaborator_id, self.collaborator.pk)

    def test_build_activity_productivity_aggregates_by_activity_and_technology(self):
        ProjectTask.objects.create(
            project=self.project, activity_type=self.activity_type, project_item=self.item,
            status=ProjectTask.STATUS_COMPLETED, quantity_completed="10", actual_hours="2", order=2,
        )
        other_item = ProjectItem.objects.create(project=self.project, item_type=self.item_type, technology="Robust 2F", internal_code="EV-002")
        ProjectTask.objects.create(
            project=self.project, activity_type=self.activity_type, project_item=other_item,
            status=ProjectTask.STATUS_COMPLETED, quantity_completed="10", actual_hours="4", order=3,
        )

        data = build_activity_productivity()

        row = next(r for r in data["rows"] if r["activity_type_id"] == self.activity_type.pk)
        self.assertEqual(row["sample_count"], 2)
        self.assertEqual(row["total_quantity"], "20.00")
        self.assertEqual(row["avg_hours_per_unit"], 0.3)  # (2+4)h / 20 unidades

    def test_pool_marks_blocked_by_pending_dependency(self):
        blocking_task = self._create_task(status=ProjectTask.STATUS_NOT_STARTED)
        # Dependência exige o mesmo project_item — precisa de um segundo
        # activity_type, já que (project_item, activity_type) é único.
        second_activity_type = ActivityType.objects.create(name="Certificação (evento-teste)")
        blocked_task = ProjectTask.objects.create(
            project=self.project, activity_type=second_activity_type, project_item=self.item,
            order=4, planned_start=timezone.now(),
        )
        TaskDependency.objects.create(task=blocked_task, depends_on=blocking_task)

        self.client_api.force_authenticate(user=self.admin)
        response = self.client_api.get("/api/operations/board/", {"site": "all"})

        self.assertEqual(response.status_code, 200, response.data)
        pool_row = next(row for row in response.data["pool"] if row["id"] == blocked_task.pk)
        self.assertEqual([b["task_id"] for b in pool_row["blocked_by"]], [blocking_task.pk])
