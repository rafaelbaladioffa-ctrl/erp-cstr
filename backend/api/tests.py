from datetime import datetime, timedelta
from unittest.mock import patch

from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db.models import ProtectedError
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from core.models import Category, Client, Collaborator, Company, Person, ProjectType, Site, Task


def make_collaborator(company, name, **kwargs):
    person = Person.objects.create(name=name, company=company)
    return Collaborator.objects.create(person=person, **kwargs)
from dispatch.models import CollaboratorPair, TechnicianAbsence
from master_data.models import Activity, CableAlias, CableFamily, CableSpec, CertificationType, Network, Workstream
from projects.models import Project, ProjectTask, ProjectTaskAssignment, RackPosition
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


class ProjectTaskDispatchApiTests(TestCase):
    """dispatch/undispatch de ProjectTaskAssignment via ProjectTaskViewSet."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.project = Project.objects.create(company=self.company, name="Projeto Despacho", status=Project.STATUS_IN_PROGRESS)
        self.task = ProjectTask.objects.create(project=self.project, custom_name="Tarefa avulsa", order=1)
        self.collaborator_a = make_collaborator(self.company, "Técnico A")
        self.collaborator_b = make_collaborator(self.company, "Técnico B")
        self.admin = User.objects.create_superuser(username="dispatch_admin", email="dispatch_admin@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.admin)

    def test_undispatch_removes_single_collaborator(self):
        self.client_api.post(f"/api/project-tasks/{self.task.pk}/dispatch/", {"collaborator_ids": [self.collaborator_a.pk, self.collaborator_b.pk]}, format="json")
        self.assertEqual(ProjectTaskAssignment.objects.filter(project_task=self.task).count(), 2)

        response = self.client_api.post(f"/api/project-tasks/{self.task.pk}/undispatch/", {"collaborator_ids": [self.collaborator_a.pk]}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        remaining = ProjectTaskAssignment.objects.filter(project_task=self.task)
        self.assertEqual(remaining.count(), 1)
        self.assertEqual(remaining.first().collaborator_id, self.collaborator_b.pk)

    def test_undispatch_without_ids_removes_all(self):
        self.client_api.post(f"/api/project-tasks/{self.task.pk}/dispatch/", {"collaborator_ids": [self.collaborator_a.pk, self.collaborator_b.pk]}, format="json")

        response = self.client_api.post(f"/api/project-tasks/{self.task.pk}/undispatch/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(ProjectTaskAssignment.objects.filter(project_task=self.task).count(), 0)

    def test_undispatch_removes_paired_partner_too(self):
        CollaboratorPair.objects.create(collaborator_a=self.collaborator_a, collaborator_b=self.collaborator_b, is_active=True)
        self.client_api.post(f"/api/project-tasks/{self.task.pk}/dispatch/", {"collaborator_ids": [self.collaborator_a.pk]}, format="json")
        self.assertEqual(ProjectTaskAssignment.objects.filter(project_task=self.task).count(), 2)

        response = self.client_api.post(f"/api/project-tasks/{self.task.pk}/undispatch/", {"collaborator_ids": [self.collaborator_a.pk]}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(ProjectTaskAssignment.objects.filter(project_task=self.task).count(), 0)


class TechnicianAbsenceApiTests(TestCase):
    """CRUD de TechnicianAbsence e o efeito de uma ausência ativa sobre a
    Central de Operações (build_board_data)."""

    def setUp(self):
        self.client_api = APIClient()
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.collaborator = make_collaborator(self.company, "Técnico Ausente")
        self.admin = User.objects.create_superuser(username="absence_admin", email="absence_admin@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.admin)

    def test_create_absence_sets_created_by(self):
        today = timezone.localdate()
        response = self.client_api.post(
            "/api/technician-absences/",
            {
                "collaborator": self.collaborator.pk,
                "date_from": str(today),
                "date_to": str(today + timedelta(days=5)),
                "reason": "Férias",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        absence = TechnicianAbsence.objects.get(pk=response.data["id"])
        self.assertEqual(absence.created_by, self.admin)

    def test_date_to_before_date_from_rejected(self):
        today = timezone.localdate()
        response = self.client_api.post(
            "/api/technician-absences/",
            {"collaborator": self.collaborator.pk, "date_from": str(today), "date_to": str(today - timedelta(days=1))},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(TechnicianAbsence.objects.exists())

    def test_list_filters_by_collaborator(self):
        other = make_collaborator(self.company, "Outro Técnico")
        today = timezone.localdate()
        TechnicianAbsence.objects.create(collaborator=self.collaborator, date_from=today, date_to=today, created_by=self.admin)
        TechnicianAbsence.objects.create(collaborator=other, date_from=today, date_to=today, created_by=self.admin)

        response = self.client_api.get(f"/api/technician-absences/?collaborator={self.collaborator.pk}")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["collaborator"], self.collaborator.pk)

    def test_board_marks_technician_on_leave(self):
        today = timezone.localdate()
        TechnicianAbsence.objects.create(
            collaborator=self.collaborator, date_from=today, date_to=today, reason="Atestado médico", created_by=self.admin
        )

        response = self.client_api.get("/api/operations/board/?site=all")

        self.assertEqual(response.status_code, 200)
        tech = next(t for t in response.data["technicians"] if t["id"] == self.collaborator.pk)
        self.assertTrue(tech["on_leave"])
        self.assertEqual(tech["presence_status"], "on_leave")
        self.assertEqual(tech["presence_status_display"], "Atestado médico")

    def test_board_ignores_absence_outside_range(self):
        today = timezone.localdate()
        TechnicianAbsence.objects.create(
            collaborator=self.collaborator,
            date_from=today - timedelta(days=10),
            date_to=today - timedelta(days=5),
            created_by=self.admin,
        )

        response = self.client_api.get("/api/operations/board/?site=all")

        self.assertEqual(response.status_code, 200)
        tech = next(t for t in response.data["technicians"] if t["id"] == self.collaborator.pk)
        self.assertFalse(tech["on_leave"])
        self.assertEqual(tech["presence_status"], "not_started")


class CableFamilyApiTests(TestCase):
    """Cadastros Mestres > Engenharia > Famílias de Cabo — CRUD, código
    duplicado, busca e rastreio de criado/atualizado por."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(username="master_data_admin", email="master_data@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.admin)

    # Códigos prefixados com "TST-" de propósito: a migration de seed
    # (master_data/0002_seed_cable_families) roda também na criação do
    # banco de testes, então os 15 códigos reais (FIB-8F-LCLC etc.) já
    # existem — usar um deles aqui causaria colisão de "code" único.

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/cable-families/",
            {"code": "TST-0001", "name": "Cabo de teste", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        family = CableFamily.objects.get(pk=response.data["id"])
        self.assertEqual(family.created_by, self.admin)
        self.assertEqual(family.updated_by, self.admin)
        self.assertEqual(response.data["created_by_name"], self.admin.get_full_name() or self.admin.get_username())

    def test_duplicate_code_rejected(self):
        CableFamily.objects.create(code="TST-DUP", name="Cabo de teste")
        response = self.client_api.post(
            "/api/master-data/cable-families/",
            {"code": "TST-DUP", "name": "Outro nome"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(CableFamily.objects.filter(code="TST-DUP").count(), 1)

    def test_search_by_code_name_description(self):
        CableFamily.objects.create(code="TST-TRUNK", name="Cabo de teste", description="Trunk fiber padrão")
        CableFamily.objects.create(code="TST-PATCH", name="Cabo patch", description="Par trançado")

        response = self.client_api.get("/api/master-data/cable-families/", {"search": "trunk"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-TRUNK")

    def test_update_sets_updated_by_without_changing_created_by(self):
        other_user = User.objects.create_superuser(username="other_admin", email="other@example.com", password="test-password")
        family = CableFamily.objects.create(code="TST-0002", name="Cabo de teste", created_by=other_user, updated_by=other_user)

        response = self.client_api.patch(f"/api/master-data/cable-families/{family.pk}/", {"name": "Cabo de teste editado"}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        family.refresh_from_db()
        self.assertEqual(family.created_by, other_user)
        self.assertEqual(family.updated_by, self.admin)

    def test_is_active_filter(self):
        # O modelo usa "active" (não "is_active", diferente do resto dos
        # Cadastros Gerais) — o parâmetro de busca na URL continua
        # ?is_active= (ver RegistryViewSet.active_field).
        CableFamily.objects.create(code="TST-ACTIVE", name="Cabo ativo", active=True)
        CableFamily.objects.create(code="TST-OLD", name="Descontinuado", active=False)

        response = self.client_api.get("/api/master-data/cable-families/", {"is_active": "false"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-OLD")

    def test_medium_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-families/",
            {"code": "TST-NOMEDIUM", "name": "Sem meio"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("medium", response.data)

    def test_fiber_count_rejects_negative(self):
        response = self.client_api.post(
            "/api/master-data/cable-families/",
            {"code": "TST-NEGATIVE", "name": "Fibras negativas", "medium": "FIBER", "fiber_count": -1},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fiber_count", response.data)

    def test_deactivate_does_not_hard_delete(self):
        family = CableFamily.objects.create(code="TST-TOGGLE", name="Cabo para inativar", active=True)

        response = self.client_api.patch(f"/api/master-data/cable-families/{family.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(CableFamily.objects.filter(pk=family.pk).exists())
        family.refresh_from_db()
        self.assertFalse(family.active)


class CableAliasApiTests(TestCase):
    """Cadastros Mestres > Engenharia > Aliases de Cabos — CRUD, normalização,
    duplicidade, busca, filtros e ausência de hard delete."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(username="cable_alias_admin", email="cable_alias@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo do CableFamilyApiTests: o seed
        # real (0002/0004/0006) roda também no banco de testes.
        self.family = CableFamily.objects.create(code="TST-8F-LCLC", name="8F LC-LC de teste", medium="FIBER")

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/cable-aliases/",
            {"cable_family": self.family.pk, "alias": "8F LC TEST"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        alias = CableAlias.objects.get(pk=response.data["id"])
        self.assertEqual(alias.created_by, self.admin)
        self.assertEqual(alias.updated_by, self.admin)
        self.assertEqual(response.data["cable_family_code"], "TST-8F-LCLC")

    def test_alias_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-aliases/",
            {"cable_family": self.family.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("alias", response.data)

    def test_cable_family_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-aliases/",
            {"alias": "8F LC SEM FAMILIA"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cable_family", response.data)

    def test_normalization(self):
        # "Test" no texto para não colidir com o alias real "8F LC<>LC" do
        # seed (0006_seed_cable_aliases roda também no banco de testes, e a
        # unicidade de normalized_alias é GLOBAL, não por família).
        response = self.client_api.post(
            "/api/master-data/cable-aliases/",
            {"cable_family": self.family.pk, "alias": "  8f   lc<>lc test  "},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["normalized_alias"], "8F LC<>LC TEST")

    def test_duplicate_normalized_alias_rejected(self):
        CableAlias.objects.create(cable_family=self.family, alias="8F LC-LC TEST")
        response = self.client_api.post(
            "/api/master-data/cable-aliases/",
            # Mesmo alias com espaçamento/caixa diferentes -> mesmo normalized_alias.
            {"cable_family": self.family.pk, "alias": "  8f lc-lc test "},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("alias", response.data)
        self.assertEqual(CableAlias.objects.filter(normalized_alias="8F LC-LC TEST").count(), 1)

    def test_search_by_alias_and_family(self):
        other_family = CableFamily.objects.create(code="TST-CAT6", name="CAT6 de teste", medium="COPPER")
        CableAlias.objects.create(cable_family=self.family, alias="8F LC TRUNK FIBER TEST")
        CableAlias.objects.create(cable_family=other_family, alias="CAT6 UTP TEST")

        by_alias = self.client_api.get("/api/master-data/cable-aliases/", {"search": "trunk fiber test"})
        self.assertEqual(by_alias.data["count"], 1)
        self.assertEqual(by_alias.data["results"][0]["cable_family_code"], "TST-8F-LCLC")

        by_family_code = self.client_api.get("/api/master-data/cable-aliases/", {"search": "TST-CAT6"})
        self.assertEqual(by_family_code.data["count"], 1)
        self.assertEqual(by_family_code.data["results"][0]["alias"], "CAT6 UTP TEST")

    def test_filter_by_cable_family(self):
        other_family = CableFamily.objects.create(code="TST-OTHER", name="Outra família")
        CableAlias.objects.create(cable_family=self.family, alias="ALIAS A TEST")
        CableAlias.objects.create(cable_family=other_family, alias="ALIAS B TEST")

        response = self.client_api.get("/api/master-data/cable-aliases/", {"cable_family": self.family.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["alias"], "ALIAS A TEST")

    def test_filter_by_alias_type(self):
        # O seed real já tem outros aliases PART_NUMBER (part numbers das
        # famílias reais) — não assumir contagem absoluta, só que o filtro
        # inclui o registro criado aqui e exclui o NAME_VARIATION criado
        # junto (prova que o filtro de fato restringe, não é um no-op).
        CableAlias.objects.create(cable_family=self.family, alias="PN-TEST-0001", alias_type="PART_NUMBER")
        CableAlias.objects.create(cable_family=self.family, alias="NOME ALTERNATIVO TEST", alias_type="NAME_VARIATION")

        response = self.client_api.get("/api/master-data/cable-aliases/", {"alias_type": "PART_NUMBER"})

        returned_aliases = [row["alias"] for row in response.data["results"]]
        self.assertIn("PN-TEST-0001", returned_aliases)
        self.assertNotIn("NOME ALTERNATIVO TEST", returned_aliases)

    def test_deactivate_does_not_hard_delete(self):
        alias = CableAlias.objects.create(cable_family=self.family, alias="ALIAS PARA INATIVAR TEST", active=True)

        response = self.client_api.patch(f"/api/master-data/cable-aliases/{alias.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(CableAlias.objects.filter(pk=alias.pk).exists())
        alias.refresh_from_db()
        self.assertFalse(alias.active)

    def test_cable_family_foreign_key_integrity(self):
        alias = CableAlias.objects.create(cable_family=self.family, alias="ALIAS COM FK TEST")
        with self.assertRaises(ProtectedError):
            self.family.delete()
        alias.refresh_from_db()
        self.assertEqual(alias.cable_family_id, self.family.pk)


class CableSpecApiTests(TestCase):
    """Cadastros Mestres > Engenharia > Especificações de Cabos — CRUD,
    duplicidade de part number ativo, consistência com aliases, busca,
    filtros e ausência de hard delete."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(username="cable_spec_admin", email="cable_spec@example.com", password="test-password")
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0002/0004/0006/0008) roda também no banco
        # de testes.
        self.family = CableFamily.objects.create(code="TST-SPEC-FAMILY", name="Família de teste", medium="FIBER")
        self.other_family = CableFamily.objects.create(code="TST-SPEC-OTHER", name="Outra família de teste", medium="FIBER")

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-0001", "name": "Spec de teste"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        spec = CableSpec.objects.get(pk=response.data["id"])
        self.assertEqual(spec.created_by, self.admin)
        self.assertEqual(spec.updated_by, self.admin)
        self.assertEqual(response.data["cable_family_code"], "TST-SPEC-FAMILY")

    def test_cable_family_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"code": "TST-SPEC-0002", "name": "Sem família"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cable_family", response.data)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "name": "Sem código"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-DUP", name="Original")
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-DUP", "name": "Duplicado"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(CableSpec.objects.filter(code="TST-SPEC-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-0003"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_fiber_count_rejects_negative(self):
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-0004", "name": "Fibras negativas", "fiber_count": -1},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("fiber_count", response.data)

    def test_duplicate_active_part_number_rejected(self):
        CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-PN1", name="Original", part_number="TST-PN-0001")
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-PN2", "name": "Duplicado", "part_number": "tst-pn-0001"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("part_number", response.data)
        self.assertEqual(CableSpec.objects.filter(part_number__iexact="TST-PN-0001").count(), 1)

    def test_inactive_duplicate_part_number_allowed(self):
        # Um spec INATIVO (ex: revisão descontinuada) não deve travar o
        # cadastro de um novo spec ativo com o mesmo part number.
        CableSpec.objects.create(
            cable_family=self.family, code="TST-SPEC-OLD", name="Revisão antiga", part_number="TST-PN-0002", active=False
        )
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {"cable_family": self.family.pk, "code": "TST-SPEC-NEW", "name": "Revisão nova", "part_number": "TST-PN-0002"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_part_number_alias_family_mismatch_rejected(self):
        CableAlias.objects.create(cable_family=self.other_family, alias="TST-ALIAS-PN-0001")
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {
                "cable_family": self.family.pk,
                "code": "TST-SPEC-MISMATCH",
                "name": "Spec com part number conflitante",
                "part_number": "tst-alias-pn-0001",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("part_number", response.data)
        self.assertFalse(CableSpec.objects.filter(code="TST-SPEC-MISMATCH").exists())

    def test_part_number_alias_family_match_allowed(self):
        CableAlias.objects.create(cable_family=self.family, alias="TST-ALIAS-PN-0002")
        response = self.client_api.post(
            "/api/master-data/cable-specs/",
            {
                "cable_family": self.family.pk,
                "code": "TST-SPEC-MATCH",
                "name": "Spec com part number consistente",
                "part_number": "tst-alias-pn-0002",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_search_by_code_name_part_number_manufacturer_and_family(self):
        CableSpec.objects.create(
            cable_family=self.family,
            code="TST-SPEC-SEARCH",
            name="Spec pesquisável",
            manufacturer="Fabricante Teste Search",
            part_number="TST-PN-SEARCH",
        )

        by_manufacturer = self.client_api.get("/api/master-data/cable-specs/", {"search": "Fabricante Teste Search"})
        self.assertEqual(by_manufacturer.data["count"], 1)

        by_family_code = self.client_api.get("/api/master-data/cable-specs/", {"search": "TST-SPEC-FAMILY"})
        self.assertEqual(by_family_code.data["count"], 1)
        self.assertEqual(by_family_code.data["results"][0]["code"], "TST-SPEC-SEARCH")

    def test_filter_by_cable_family(self):
        CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-FILTER-A", name="A")
        CableSpec.objects.create(cable_family=self.other_family, code="TST-SPEC-FILTER-B", name="B")

        response = self.client_api.get("/api/master-data/cable-specs/", {"cable_family": self.family.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-SPEC-FILTER-A")

    def test_filter_by_fiber_type_and_polarity(self):
        # O seed real já tem um spec com fiber_type=OS2/polarity=B
        # (SPEC-72F-MPOB-0072X6P64, também presente no banco de testes) —
        # não assumir contagem absoluta, só que o filtro inclui o registro
        # criado aqui e exclui o de fiber_type/polarity diferente.
        CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-OS2-A", name="OS2 A", fiber_type="OS2", polarity="A")
        CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-OM4-B", name="OM4 B", fiber_type="OM4", polarity="B")

        by_fiber_type = self.client_api.get("/api/master-data/cable-specs/", {"fiber_type": "OS2"})
        codes = [row["code"] for row in by_fiber_type.data["results"]]
        self.assertIn("TST-SPEC-OS2-A", codes)
        self.assertNotIn("TST-SPEC-OM4-B", codes)

        by_polarity = self.client_api.get("/api/master-data/cable-specs/", {"polarity": "B"})
        codes = [row["code"] for row in by_polarity.data["results"]]
        self.assertIn("TST-SPEC-OM4-B", codes)
        self.assertNotIn("TST-SPEC-OS2-A", codes)

    def test_deactivate_does_not_hard_delete(self):
        spec = CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-TOGGLE", name="Spec para inativar", active=True)

        response = self.client_api.patch(f"/api/master-data/cable-specs/{spec.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(CableSpec.objects.filter(pk=spec.pk).exists())
        spec.refresh_from_db()
        self.assertFalse(spec.active)

    def test_cable_family_foreign_key_integrity(self):
        spec = CableSpec.objects.create(cable_family=self.family, code="TST-SPEC-FK", name="Spec com FK")
        with self.assertRaises(ProtectedError):
            self.family.delete()
        spec.refresh_from_db()
        self.assertEqual(spec.cable_family_id, self.family.pk)


class CertificationTypeApiTests(TestCase):
    """Cadastros Mestres > Engenharia > Tipos de Certificação — CRUD,
    obrigatoriedade, busca, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="certification_type_admin", email="certification_type@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0010_seed_certification_types) roda também
        # no banco de testes (4 registros: CERT-OTDR, CERT-COPPER,
        # CERT-FIBER-GENERAL, CERT-QAQC).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"code": "TST-CERT-0001", "name": "Certificação de teste", "method": "TEST_METHOD"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        cert = CertificationType.objects.get(pk=response.data["id"])
        self.assertEqual(cert.created_by, self.admin)
        self.assertEqual(cert.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"name": "Sem código", "method": "TEST_METHOD"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        CertificationType.objects.create(code="TST-CERT-DUP", name="Original", method="TEST_METHOD")
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"code": "TST-CERT-DUP", "name": "Duplicado", "method": "TEST_METHOD"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(CertificationType.objects.filter(code="TST-CERT-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"code": "TST-CERT-0002", "method": "TEST_METHOD"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_method_is_required(self):
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"code": "TST-CERT-0003", "name": "Sem método"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("method", response.data)

    def test_medium_is_optional(self):
        response = self.client_api.post(
            "/api/master-data/certification-types/",
            {"code": "TST-CERT-0004", "name": "Sem meio", "method": "TEST_METHOD"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["medium"], "")

    def test_search_by_code_name_and_method(self):
        CertificationType.objects.create(code="TST-CERT-SEARCH", name="Busca de teste", method="SEARCHABLE_METHOD")

        response = self.client_api.get("/api/master-data/certification-types/", {"search": "SEARCHABLE_METHOD"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-CERT-SEARCH")

    def test_deactivate_does_not_hard_delete(self):
        cert = CertificationType.objects.create(code="TST-CERT-TOGGLE", name="Para inativar", method="TEST_METHOD", active=True)

        response = self.client_api.patch(f"/api/master-data/certification-types/{cert.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(CertificationType.objects.filter(pk=cert.pk).exists())
        cert.refresh_from_db()
        self.assertFalse(cert.active)

    def test_export_csv(self):
        CertificationType.objects.create(code="TST-CERT-EXPORT", name="Exportação de teste", method="EXPORT_METHOD")
        response = self.client_api.get("/api/master-data/certification-types/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-CERT-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;meio;método;exige relatório;exige anexo\n"
            "TST-CERT-IMPORT1;Certificação Importada 1;FIBER;IMPORT_METHOD;Sim;Sim\n"
            "TST-CERT-IMPORT2;Certificação Importada 2;;IMPORT_METHOD_2;Não;Não\n"
        )
        upload = SimpleUploadedFile("certification_types.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/certification-types/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = CertificationType.objects.get(code="TST-CERT-IMPORT1")
        self.assertTrue(imported.requires_report)
        self.assertTrue(imported.requires_attachment)

    def test_seed_matches_expected_four_records(self):
        codes = set(CertificationType.objects.values_list("code", flat=True))
        self.assertEqual(
            {"CERT-OTDR", "CERT-COPPER", "CERT-FIBER-GENERAL", "CERT-QAQC"} & codes,
            {"CERT-OTDR", "CERT-COPPER", "CERT-FIBER-GENERAL", "CERT-QAQC"},
        )

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0010_seed_certification_types")
        count_before = CertificationType.objects.count()
        module.seed_certification_types(django_apps, None)
        module.seed_certification_types(django_apps, None)
        self.assertEqual(CertificationType.objects.count(), count_before)


class ActivityApiTests(TestCase):
    """Cadastros Mestres > Operação > Atividades — CRUD, obrigatoriedade,
    busca, filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="activity_admin", email="activity@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0012_seed_activities) roda também no banco
        # de testes (14 registros: MAT-SEP, MAT-CHECK, CAB-MEASURE,
        # CAB-CUT, CAB-LABEL, CAB-RUN, CAB-DRESS, CAB-CRIMP, CAB-PATCH,
        # CERTIFY, QAQC, EVIDENCE, SITE-CLEAN, HANDOVER).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/activities/",
            {"code": "TST-ACT-0001", "name": "Atividade de teste", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        activity = Activity.objects.get(pk=response.data["id"])
        self.assertEqual(activity.created_by, self.admin)
        self.assertEqual(activity.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/activities/",
            {"name": "Sem código", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        Activity.objects.create(code="TST-ACT-DUP", name="Original", category="TEST_CATEGORY")
        response = self.client_api.post(
            "/api/master-data/activities/",
            {"code": "TST-ACT-DUP", "name": "Duplicado", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(Activity.objects.filter(code="TST-ACT-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/activities/",
            {"code": "TST-ACT-0002", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_category_is_required(self):
        response = self.client_api.post(
            "/api/master-data/activities/",
            {"code": "TST-ACT-0003", "name": "Sem categoria"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_update_edits_fields(self):
        activity = Activity.objects.create(code="TST-ACT-EDIT", name="Original", category="TEST_CATEGORY")

        response = self.client_api.patch(
            f"/api/master-data/activities/{activity.pk}/",
            {"name": "Editada", "execution_type": "MANUAL", "measurable": True},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        activity.refresh_from_db()
        self.assertEqual(activity.name, "Editada")
        self.assertEqual(activity.execution_type, "MANUAL")
        self.assertTrue(activity.measurable)

    def test_search_by_code_name_category_execution_type(self):
        Activity.objects.create(
            code="TST-ACT-SEARCH", name="Atividade pesquisável", category="TEST_CATEGORY", execution_type="TEST_EXEC"
        )

        response = self.client_api.get("/api/master-data/activities/", {"search": "TEST_EXEC"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-ACT-SEARCH")

    def test_filter_by_category(self):
        Activity.objects.create(code="TST-ACT-CATA", name="A", category="TST_CAT_A")
        Activity.objects.create(code="TST-ACT-CATB", name="B", category="TST_CAT_B")

        response = self.client_api.get("/api/master-data/activities/", {"category": "TST_CAT_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-ACT-CATA")

    def test_filter_by_execution_type(self):
        Activity.objects.create(code="TST-ACT-EXECA", name="A", category="TEST_CATEGORY", execution_type="TST_EXEC_A")
        Activity.objects.create(code="TST-ACT-EXECB", name="B", category="TEST_CATEGORY", execution_type="TST_EXEC_B")

        response = self.client_api.get("/api/master-data/activities/", {"execution_type": "TST_EXEC_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-ACT-EXECA")

    def test_filter_by_measurable(self):
        Activity.objects.create(code="TST-ACT-MEASURABLE", name="A", category="TEST_CATEGORY", measurable=True)
        Activity.objects.create(code="TST-ACT-NOTMEASURABLE", name="B", category="TEST_CATEGORY", measurable=False)

        response = self.client_api.get("/api/master-data/activities/", {"measurable": "true"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-ACT-MEASURABLE", codes)
        self.assertNotIn("TST-ACT-NOTMEASURABLE", codes)

    def test_filter_by_active(self):
        Activity.objects.create(code="TST-ACT-ACTIVE", name="Ativa", category="TEST_CATEGORY", active=True)
        Activity.objects.create(code="TST-ACT-INACTIVE", name="Inativa", category="TEST_CATEGORY", active=False)

        response = self.client_api.get("/api/master-data/activities/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-ACT-INACTIVE", codes)
        self.assertNotIn("TST-ACT-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        activity = Activity.objects.create(code="TST-ACT-TOGGLE", name="Para inativar", category="TEST_CATEGORY", active=True)

        response = self.client_api.patch(f"/api/master-data/activities/{activity.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Activity.objects.filter(pk=activity.pk).exists())
        activity.refresh_from_db()
        self.assertFalse(activity.active)

    def test_export_csv(self):
        Activity.objects.create(code="TST-ACT-EXPORT", name="Exportação de teste", category="TEST_CATEGORY")
        response = self.client_api.get("/api/master-data/activities/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-ACT-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;categoria;tipo de execução;unidade padrão;mensurável;exige quantidade;exige evidência;exige certificação\n"
            "TST-ACT-IMPORT1;Atividade Importada 1;TEST_CATEGORY;MANUAL;UNIT;Sim;Sim;Não;Não\n"
            "TST-ACT-IMPORT2;Atividade Importada 2;TEST_CATEGORY;;PROJECT;Não;Não;Sim;Não\n"
        )
        upload = SimpleUploadedFile("activities.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/activities/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = Activity.objects.get(code="TST-ACT-IMPORT1")
        self.assertTrue(imported.measurable)
        self.assertTrue(imported.requires_quantity)
        self.assertFalse(imported.requires_evidence)

    def test_seed_matches_expected_fourteen_records(self):
        expected_codes = {
            "MAT-SEP", "MAT-CHECK", "CAB-MEASURE", "CAB-CUT", "CAB-LABEL", "CAB-RUN", "CAB-DRESS",
            "CAB-CRIMP", "CAB-PATCH", "CERTIFY", "QAQC", "EVIDENCE", "SITE-CLEAN", "HANDOVER",
        }
        codes = set(Activity.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0012_seed_activities")
        count_before = Activity.objects.count()
        module.seed_activities(django_apps, None)
        module.seed_activities(django_apps, None)
        self.assertEqual(Activity.objects.count(), count_before)


class NetworkApiTests(TestCase):
    """Cadastros Mestres > Operação > Redes — CRUD, obrigatoriedade, busca,
    filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="network_admin", email="network@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0014_seed_networks) roda também no banco de
        # testes (6 registros: CORP_FIBER, CONSOLE_FIBER, MN_FIBER,
        # CONSOLE_COPPER, MN_COPPER, WAP_COPPER).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"code": "TST-NET-0001", "name": "Rede de teste", "domain": "TEST_DOMAIN", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        network = Network.objects.get(pk=response.data["id"])
        self.assertEqual(network.created_by, self.admin)
        self.assertEqual(network.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"name": "Sem código", "domain": "TEST_DOMAIN", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        Network.objects.create(code="TST-NET-DUP", name="Original", domain="TEST_DOMAIN", medium="FIBER")
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"code": "TST-NET-DUP", "name": "Duplicado", "domain": "TEST_DOMAIN", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(Network.objects.filter(code="TST-NET-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"code": "TST-NET-0002", "domain": "TEST_DOMAIN", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_domain_is_required(self):
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"code": "TST-NET-0003", "name": "Sem domínio", "medium": "FIBER"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("domain", response.data)

    def test_medium_is_required(self):
        response = self.client_api.post(
            "/api/master-data/networks/",
            {"code": "TST-NET-0004", "name": "Sem meio", "domain": "TEST_DOMAIN"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("medium", response.data)

    def test_update_edits_fields(self):
        network = Network.objects.create(code="TST-NET-EDIT", name="Original", domain="TEST_DOMAIN", medium="FIBER")

        response = self.client_api.patch(
            f"/api/master-data/networks/{network.pk}/",
            {"name": "Editada", "domain": "OTHER_DOMAIN"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        network.refresh_from_db()
        self.assertEqual(network.name, "Editada")
        self.assertEqual(network.domain, "OTHER_DOMAIN")

    def test_search_by_code_name_domain_medium(self):
        Network.objects.create(code="TST-NET-SEARCH", name="Rede pesquisável", domain="TST_SEARCHABLE_DOMAIN", medium="FIBER")

        response = self.client_api.get("/api/master-data/networks/", {"search": "TST_SEARCHABLE_DOMAIN"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-NET-SEARCH")

    def test_filter_by_domain(self):
        Network.objects.create(code="TST-NET-DOMA", name="A", domain="TST_DOMAIN_A", medium="FIBER")
        Network.objects.create(code="TST-NET-DOMB", name="B", domain="TST_DOMAIN_B", medium="FIBER")

        response = self.client_api.get("/api/master-data/networks/", {"domain": "TST_DOMAIN_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-NET-DOMA")

    def test_filter_by_medium(self):
        Network.objects.create(code="TST-NET-FIBER", name="A", domain="TEST_DOMAIN", medium="TST_FIBER_MEDIUM")
        Network.objects.create(code="TST-NET-COPPER", name="B", domain="TEST_DOMAIN", medium="TST_COPPER_MEDIUM")

        response = self.client_api.get("/api/master-data/networks/", {"medium": "TST_FIBER_MEDIUM"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-NET-FIBER")

    def test_filter_by_active(self):
        Network.objects.create(code="TST-NET-ACTIVE", name="Ativa", domain="TEST_DOMAIN", medium="FIBER", active=True)
        Network.objects.create(code="TST-NET-INACTIVE", name="Inativa", domain="TEST_DOMAIN", medium="FIBER", active=False)

        response = self.client_api.get("/api/master-data/networks/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-NET-INACTIVE", codes)
        self.assertNotIn("TST-NET-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        network = Network.objects.create(code="TST-NET-TOGGLE", name="Para inativar", domain="TEST_DOMAIN", medium="FIBER", active=True)

        response = self.client_api.patch(f"/api/master-data/networks/{network.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Network.objects.filter(pk=network.pk).exists())
        network.refresh_from_db()
        self.assertFalse(network.active)

    def test_export_csv(self):
        Network.objects.create(code="TST-NET-EXPORT", name="Exportação de teste", domain="TEST_DOMAIN", medium="FIBER")
        response = self.client_api.get("/api/master-data/networks/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-NET-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;domínio;meio\n"
            "TST-NET-IMPORT1;Rede Importada 1;TEST_DOMAIN;FIBER\n"
            "TST-NET-IMPORT2;Rede Importada 2;TEST_DOMAIN;COPPER\n"
        )
        upload = SimpleUploadedFile("networks.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/networks/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = Network.objects.get(code="TST-NET-IMPORT1")
        self.assertEqual(imported.domain, "TEST_DOMAIN")
        self.assertEqual(imported.medium, "FIBER")

    def test_seed_matches_expected_six_records(self):
        expected_codes = {"CORP_FIBER", "CONSOLE_FIBER", "MN_FIBER", "CONSOLE_COPPER", "MN_COPPER", "WAP_COPPER"}
        codes = set(Network.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0014_seed_networks")
        count_before = Network.objects.count()
        module.seed_networks(django_apps, None)
        module.seed_networks(django_apps, None)
        self.assertEqual(Network.objects.count(), count_before)


class WorkstreamApiTests(TestCase):
    """Cadastros Mestres > Operação > Workstreams — CRUD, obrigatoriedade,
    busca, filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="workstream_admin", email="workstream@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0016_seed_workstreams) roda também no banco
        # de testes (9 registros: WS-MGMT-FIBER, WS-CONSOLE, WS-BFC-FIBER,
        # WS-EUCLID-FIBER, WS-IDF-CABLING, WS-HARDWARE, WS-WAP,
        # WS-SMART-HAND, WS-CLOSURE).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"code": "TST-WS-0001", "name": "Workstream de teste", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        workstream = Workstream.objects.get(pk=response.data["id"])
        self.assertEqual(workstream.created_by, self.admin)
        self.assertEqual(workstream.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"name": "Sem código", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        Workstream.objects.create(code="TST-WS-DUP", name="Original", category="TEST_CATEGORY")
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"code": "TST-WS-DUP", "name": "Duplicado", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(Workstream.objects.filter(code="TST-WS-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"code": "TST-WS-0002", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_category_is_required(self):
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"code": "TST-WS-0003", "name": "Sem categoria"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_default_medium_is_optional(self):
        response = self.client_api.post(
            "/api/master-data/workstreams/",
            {"code": "TST-WS-0004", "name": "Sem meio padrão", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["default_medium"], "")

    def test_update_edits_fields(self):
        workstream = Workstream.objects.create(code="TST-WS-EDIT", name="Original", category="TEST_CATEGORY")

        response = self.client_api.patch(
            f"/api/master-data/workstreams/{workstream.pk}/",
            {"name": "Editada", "default_medium": "MIXED"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        workstream.refresh_from_db()
        self.assertEqual(workstream.name, "Editada")
        self.assertEqual(workstream.default_medium, "MIXED")

    def test_search_by_code_name_category_default_medium(self):
        Workstream.objects.create(
            code="TST-WS-SEARCH", name="Workstream pesquisável", category="TST_SEARCHABLE_CATEGORY", default_medium="FIBER"
        )

        response = self.client_api.get("/api/master-data/workstreams/", {"search": "TST_SEARCHABLE_CATEGORY"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-WS-SEARCH")

    def test_filter_by_category(self):
        Workstream.objects.create(code="TST-WS-CATA", name="A", category="TST_CAT_A")
        Workstream.objects.create(code="TST-WS-CATB", name="B", category="TST_CAT_B")

        response = self.client_api.get("/api/master-data/workstreams/", {"category": "TST_CAT_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-WS-CATA")

    def test_filter_by_default_medium(self):
        Workstream.objects.create(code="TST-WS-FIBER", name="A", category="TEST_CATEGORY", default_medium="TST_FIBER_MEDIUM")
        Workstream.objects.create(code="TST-WS-COPPER", name="B", category="TEST_CATEGORY", default_medium="TST_COPPER_MEDIUM")

        response = self.client_api.get("/api/master-data/workstreams/", {"default_medium": "TST_FIBER_MEDIUM"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-WS-FIBER")

    def test_filter_by_active(self):
        Workstream.objects.create(code="TST-WS-ACTIVE", name="Ativa", category="TEST_CATEGORY", active=True)
        Workstream.objects.create(code="TST-WS-INACTIVE", name="Inativa", category="TEST_CATEGORY", active=False)

        response = self.client_api.get("/api/master-data/workstreams/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-WS-INACTIVE", codes)
        self.assertNotIn("TST-WS-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        workstream = Workstream.objects.create(code="TST-WS-TOGGLE", name="Para inativar", category="TEST_CATEGORY", active=True)

        response = self.client_api.patch(f"/api/master-data/workstreams/{workstream.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Workstream.objects.filter(pk=workstream.pk).exists())
        workstream.refresh_from_db()
        self.assertFalse(workstream.active)

    def test_export_csv(self):
        Workstream.objects.create(code="TST-WS-EXPORT", name="Exportação de teste", category="TEST_CATEGORY")
        response = self.client_api.get("/api/master-data/workstreams/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-WS-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;categoria;meio padrão\n"
            "TST-WS-IMPORT1;Workstream Importada 1;TEST_CATEGORY;FIBER\n"
            "TST-WS-IMPORT2;Workstream Importada 2;TEST_CATEGORY;\n"
        )
        upload = SimpleUploadedFile("workstreams.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/workstreams/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = Workstream.objects.get(code="TST-WS-IMPORT1")
        self.assertEqual(imported.default_medium, "FIBER")

    def test_seed_matches_expected_nine_records(self):
        expected_codes = {
            "WS-MGMT-FIBER", "WS-CONSOLE", "WS-BFC-FIBER", "WS-EUCLID-FIBER", "WS-IDF-CABLING",
            "WS-HARDWARE", "WS-WAP", "WS-SMART-HAND", "WS-CLOSURE",
        }
        codes = set(Workstream.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0016_seed_workstreams")
        count_before = Workstream.objects.count()
        module.seed_workstreams(django_apps, None)
        module.seed_workstreams(django_apps, None)
        self.assertEqual(Workstream.objects.count(), count_before)
