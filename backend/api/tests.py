import json
import os
from datetime import datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.contrib.auth.models import Permission
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import IntegrityError, transaction
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
from master_data.models import (
    Activity,
    CableAlias,
    CableFamily,
    CableSpec,
    CertificationType,
    DeviceType,
    GeneratedTask,
    GeneratedTaskDependency,
    Location,
    Network,
    Path,
    ScopeItem,
    ScopeItemPath,
    SowImport,
    SowParsedItem,
    TaskTemplate,
    TaskTemplateRule,
    TaskTemplateStep,
    Workstream,
)
from master_data.models import Site as MasterDataSite
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


class PathApiTests(TestCase):
    """Cadastros Mestres > Operação > Rotas/Caminhos — CRUD, obrigatoriedade,
    busca, filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="path_admin", email="path@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0018_seed_paths) roda também no banco de
        # testes (6 registros: PATH-A, PATH-B, INTER-RACK, CROSS-CONNECT,
        # DIRECT-DUCT, UNSPECIFIED).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"code": "TST-PATH-0001", "name": "Rota de teste", "path_group": "TEST_GROUP", "path_type": "TEST_TYPE"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        path = Path.objects.get(pk=response.data["id"])
        self.assertEqual(path.created_by, self.admin)
        self.assertEqual(path.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"name": "Sem código", "path_group": "TEST_GROUP", "path_type": "TEST_TYPE"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        Path.objects.create(code="TST-PATH-DUP", name="Original", path_group="TEST_GROUP", path_type="TEST_TYPE")
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"code": "TST-PATH-DUP", "name": "Duplicado", "path_group": "TEST_GROUP", "path_type": "TEST_TYPE"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(Path.objects.filter(code="TST-PATH-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"code": "TST-PATH-0002", "path_group": "TEST_GROUP", "path_type": "TEST_TYPE"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_path_group_is_required(self):
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"code": "TST-PATH-0003", "name": "Sem grupo", "path_type": "TEST_TYPE"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("path_group", response.data)

    def test_path_type_is_required(self):
        response = self.client_api.post(
            "/api/master-data/paths/",
            {"code": "TST-PATH-0004", "name": "Sem tipo", "path_group": "TEST_GROUP"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("path_type", response.data)

    def test_update_edits_fields(self):
        path = Path.objects.create(code="TST-PATH-EDIT", name="Original", path_group="TEST_GROUP", path_type="TEST_TYPE")

        response = self.client_api.patch(
            f"/api/master-data/paths/{path.pk}/",
            {"name": "Editada", "path_type": "OTHER_TYPE"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        path.refresh_from_db()
        self.assertEqual(path.name, "Editada")
        self.assertEqual(path.path_type, "OTHER_TYPE")

    def test_search_by_code_name_path_group_path_type(self):
        Path.objects.create(
            code="TST-PATH-SEARCH", name="Rota pesquisável", path_group="TST_SEARCHABLE_GROUP", path_type="TEST_TYPE"
        )

        response = self.client_api.get("/api/master-data/paths/", {"search": "TST_SEARCHABLE_GROUP"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-PATH-SEARCH")

    def test_filter_by_path_group(self):
        Path.objects.create(code="TST-PATH-GROUPA", name="A", path_group="TST_GROUP_A", path_type="TEST_TYPE")
        Path.objects.create(code="TST-PATH-GROUPB", name="B", path_group="TST_GROUP_B", path_type="TEST_TYPE")

        response = self.client_api.get("/api/master-data/paths/", {"path_group": "TST_GROUP_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-PATH-GROUPA")

    def test_filter_by_path_type(self):
        Path.objects.create(code="TST-PATH-TYPEA", name="A", path_group="TEST_GROUP", path_type="TST_TYPE_A")
        Path.objects.create(code="TST-PATH-TYPEB", name="B", path_group="TEST_GROUP", path_type="TST_TYPE_B")

        response = self.client_api.get("/api/master-data/paths/", {"path_type": "TST_TYPE_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-PATH-TYPEA")

    def test_filter_by_active(self):
        Path.objects.create(code="TST-PATH-ACTIVE", name="Ativa", path_group="TEST_GROUP", path_type="TEST_TYPE", active=True)
        Path.objects.create(code="TST-PATH-INACTIVE", name="Inativa", path_group="TEST_GROUP", path_type="TEST_TYPE", active=False)

        response = self.client_api.get("/api/master-data/paths/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-PATH-INACTIVE", codes)
        self.assertNotIn("TST-PATH-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        path = Path.objects.create(code="TST-PATH-TOGGLE", name="Para inativar", path_group="TEST_GROUP", path_type="TEST_TYPE", active=True)

        response = self.client_api.patch(f"/api/master-data/paths/{path.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Path.objects.filter(pk=path.pk).exists())
        path.refresh_from_db()
        self.assertFalse(path.active)

    def test_export_csv(self):
        Path.objects.create(code="TST-PATH-EXPORT", name="Exportação de teste", path_group="TEST_GROUP", path_type="TEST_TYPE")
        response = self.client_api.get("/api/master-data/paths/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-PATH-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;grupo;tipo\n"
            "TST-PATH-IMPORT1;Rota Importada 1;TEST_GROUP;A\n"
            "TST-PATH-IMPORT2;Rota Importada 2;TEST_GROUP;B\n"
        )
        upload = SimpleUploadedFile("paths.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/paths/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = Path.objects.get(code="TST-PATH-IMPORT1")
        self.assertEqual(imported.path_group, "TEST_GROUP")
        self.assertEqual(imported.path_type, "A")

    def test_seed_matches_expected_six_records(self):
        expected_codes = {"PATH-A", "PATH-B", "INTER-RACK", "CROSS-CONNECT", "DIRECT-DUCT", "UNSPECIFIED"}
        codes = set(Path.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0018_seed_paths")
        count_before = Path.objects.count()
        module.seed_paths(django_apps, None)
        module.seed_paths(django_apps, None)
        self.assertEqual(Path.objects.count(), count_before)


class MasterDataSiteApiTests(TestCase):
    """Cadastros Mestres > Infraestrutura > Sites — CRUD, obrigatoriedade,
    busca, filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="master_data_site_admin", email="master_data_site@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0020_seed_sites) roda também no banco de
        # testes (3 registros: GRU65, GRU60, VCP1).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/sites/",
            {"code": "TST-SITE-0001", "name": "Site de teste"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        site = MasterDataSite.objects.get(pk=response.data["id"])
        self.assertEqual(site.created_by, self.admin)
        self.assertEqual(site.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/sites/",
            {"name": "Sem código"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        MasterDataSite.objects.create(code="TST-SITE-DUP", name="Original")
        response = self.client_api.post(
            "/api/master-data/sites/",
            {"code": "TST-SITE-DUP", "name": "Duplicado"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(MasterDataSite.objects.filter(code="TST-SITE-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/sites/",
            {"code": "TST-SITE-0002"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_city_state_country_site_type_are_optional(self):
        response = self.client_api.post(
            "/api/master-data/sites/",
            {"code": "TST-SITE-0003", "name": "Sem detalhes"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["city"], "")
        self.assertEqual(response.data["state"], "")
        self.assertEqual(response.data["country"], "")
        self.assertEqual(response.data["site_type"], "")

    def test_update_edits_fields(self):
        site = MasterDataSite.objects.create(code="TST-SITE-EDIT", name="Original")

        response = self.client_api.patch(
            f"/api/master-data/sites/{site.pk}/",
            {"name": "Editado", "city": "São Paulo", "state": "SP", "country": "BRAZIL", "site_type": "DATACENTER"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        site.refresh_from_db()
        self.assertEqual(site.name, "Editado")
        self.assertEqual(site.city, "São Paulo")
        self.assertEqual(site.site_type, "DATACENTER")

    def test_search_by_code_name_city_state_country_site_type(self):
        MasterDataSite.objects.create(
            code="TST-SITE-SEARCH", name="Site pesquisável", city="Campinas", state="TST_SEARCHABLE_STATE", country="BRAZIL"
        )

        response = self.client_api.get("/api/master-data/sites/", {"search": "TST_SEARCHABLE_STATE"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-SITE-SEARCH")

    def test_filter_by_country(self):
        MasterDataSite.objects.create(code="TST-SITE-BR", name="A", country="TST_COUNTRY_A")
        MasterDataSite.objects.create(code="TST-SITE-US", name="B", country="TST_COUNTRY_B")

        response = self.client_api.get("/api/master-data/sites/", {"country": "TST_COUNTRY_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-SITE-BR")

    def test_filter_by_state(self):
        MasterDataSite.objects.create(code="TST-SITE-SPA", name="A", state="TST_STATE_A")
        MasterDataSite.objects.create(code="TST-SITE-SPB", name="B", state="TST_STATE_B")

        response = self.client_api.get("/api/master-data/sites/", {"state": "TST_STATE_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-SITE-SPA")

    def test_filter_by_site_type(self):
        MasterDataSite.objects.create(code="TST-SITE-DC", name="A", site_type="TST_TYPE_A")
        MasterDataSite.objects.create(code="TST-SITE-OTHER", name="B", site_type="TST_TYPE_B")

        response = self.client_api.get("/api/master-data/sites/", {"site_type": "TST_TYPE_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-SITE-DC")

    def test_filter_by_active(self):
        MasterDataSite.objects.create(code="TST-SITE-ACTIVE", name="Ativo", active=True)
        MasterDataSite.objects.create(code="TST-SITE-INACTIVE", name="Inativo", active=False)

        response = self.client_api.get("/api/master-data/sites/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-SITE-INACTIVE", codes)
        self.assertNotIn("TST-SITE-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        site = MasterDataSite.objects.create(code="TST-SITE-TOGGLE", name="Para inativar", active=True)

        response = self.client_api.patch(f"/api/master-data/sites/{site.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(MasterDataSite.objects.filter(pk=site.pk).exists())
        site.refresh_from_db()
        self.assertFalse(site.active)

    def test_export_csv(self):
        MasterDataSite.objects.create(code="TST-SITE-EXPORT", name="Exportação de teste")
        response = self.client_api.get("/api/master-data/sites/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-SITE-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;cidade;estado;país;tipo de site\n"
            "TST-SITE-IMPORT1;Site Importado 1;São Paulo;SP;BRAZIL;DATACENTER\n"
            "TST-SITE-IMPORT2;Site Importado 2;;;;\n"
        )
        upload = SimpleUploadedFile("sites.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/sites/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = MasterDataSite.objects.get(code="TST-SITE-IMPORT1")
        self.assertEqual(imported.city, "São Paulo")
        self.assertEqual(imported.site_type, "DATACENTER")

    def test_seed_matches_expected_three_records(self):
        expected_codes = {"GRU65", "GRU60", "VCP1"}
        codes = set(MasterDataSite.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0020_seed_sites")
        count_before = MasterDataSite.objects.count()
        module.seed_sites(django_apps, None)
        module.seed_sites(django_apps, None)
        self.assertEqual(MasterDataSite.objects.count(), count_before)


class LocationApiTests(TestCase):
    """Cadastros Mestres > Infraestrutura > Localizações — CRUD,
    obrigatoriedade, consistência site x endereço, busca, filtros, CSV,
    ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="location_admin", email="location@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0020_seed_sites/0022_seed_locations) roda
        # também no banco de testes (sites GRU65/GRU60/VCP1 já existem, e 7
        # locations).
        self.site = MasterDataSite.objects.create(code="TST-SITE", name="Site de teste")
        self.other_site = MasterDataSite.objects.create(code="TST-OTHER-SITE", name="Outro site de teste")

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"site": self.site.pk, "code": "LOC-TST-0001", "canonical_address": "TST-SITE.01-01-001-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        location = Location.objects.get(pk=response.data["id"])
        self.assertEqual(location.created_by, self.admin)
        self.assertEqual(location.updated_by, self.admin)
        self.assertEqual(response.data["site_code"], "TST-SITE")

    def test_site_is_required(self):
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"code": "LOC-TST-0002", "canonical_address": "TST-SITE.01-01-001-02"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("site", response.data)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"site": self.site.pk, "canonical_address": "TST-SITE.01-01-001-03"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        Location.objects.create(site=self.site, code="LOC-TST-DUP", canonical_address="TST-SITE.01-01-001-04")
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"site": self.site.pk, "code": "LOC-TST-DUP", "canonical_address": "TST-SITE.01-01-001-05"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(Location.objects.filter(code="LOC-TST-DUP").count(), 1)

    def test_canonical_address_is_required(self):
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"site": self.site.pk, "code": "LOC-TST-0003"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("canonical_address", response.data)

    def test_canonical_address_must_be_unique(self):
        Location.objects.create(site=self.site, code="LOC-TST-0004", canonical_address="TST-SITE.01-01-001-06")
        response = self.client_api.post(
            "/api/master-data/locations/",
            {"site": self.site.pk, "code": "LOC-TST-0005", "canonical_address": "TST-SITE.01-01-001-06"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("canonical_address", response.data)
        self.assertEqual(Location.objects.filter(canonical_address="TST-SITE.01-01-001-06").count(), 1)

    def test_site_foreign_key_is_protected(self):
        location = Location.objects.create(site=self.site, code="LOC-TST-FK", canonical_address="TST-SITE.01-01-001-07")
        with self.assertRaises(ProtectedError):
            self.site.delete()
        location.refresh_from_db()
        self.assertEqual(location.site_id, self.site.pk)

    def test_address_prefix_mismatched_site_rejected(self):
        # Endereço começa explicitamente com o código de OUTRO site
        # (self.other_site) diferente do site informado (self.site).
        response = self.client_api.post(
            "/api/master-data/locations/",
            {
                "site": self.site.pk,
                "code": "LOC-TST-MISMATCH",
                "canonical_address": "TST-OTHER-SITE.01-01-001-08",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("canonical_address", response.data)
        self.assertFalse(Location.objects.filter(code="LOC-TST-MISMATCH").exists())

    def test_address_prefix_matching_site_accepted(self):
        response = self.client_api.post(
            "/api/master-data/locations/",
            {
                "site": self.site.pk,
                "code": "LOC-TST-MATCH",
                "canonical_address": "TST-SITE.01-01-001-09",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_address_without_site_prefix_accepted(self):
        # Endereço sem o código de nenhum site conhecido no início (ex:
        # "MR01-01-018-99") — aceito sem checagem de consistência.
        response = self.client_api.post(
            "/api/master-data/locations/",
            {
                "site": self.site.pk,
                "code": "LOC-TST-NOPREFIX",
                "canonical_address": "MR01-01-018-99",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_update_edits_fields(self):
        location = Location.objects.create(site=self.site, code="LOC-TST-EDIT", canonical_address="TST-SITE.01-01-001-10")

        response = self.client_api.patch(
            f"/api/master-data/locations/{location.pk}/",
            {"location_type": "RACK_POSITION", "room": "01-01", "position": "10"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        location.refresh_from_db()
        self.assertEqual(location.location_type, "RACK_POSITION")
        self.assertEqual(location.room, "01-01")
        self.assertEqual(location.position, "10")

    def test_search_by_code_address_and_site(self):
        Location.objects.create(
            site=self.site, code="LOC-TST-SEARCH", canonical_address="TST-SITE.01-01-001-11", description="Achável"
        )
        Location.objects.create(
            site=self.other_site, code="LOC-TST-SEARCH-OTHER", canonical_address="XYZ.01-01-001-99"
        )

        by_address = self.client_api.get("/api/master-data/locations/", {"search": "TST-SITE.01-01-001-11"})
        self.assertEqual(by_address.data["count"], 1)
        self.assertEqual(by_address.data["results"][0]["code"], "LOC-TST-SEARCH")

        by_site_code = self.client_api.get("/api/master-data/locations/", {"search": "TST-OTHER-SITE"})
        self.assertEqual(by_site_code.data["count"], 1)
        self.assertEqual(by_site_code.data["results"][0]["code"], "LOC-TST-SEARCH-OTHER")

    def test_filter_by_site(self):
        Location.objects.create(site=self.site, code="LOC-TST-SITEA", canonical_address="TST-SITE.01-01-001-12")
        Location.objects.create(site=self.other_site, code="LOC-TST-SITEB", canonical_address="TST-OTHER-SITE.01-01-001-13")

        response = self.client_api.get("/api/master-data/locations/", {"site": self.site.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "LOC-TST-SITEA")

    def test_filter_by_location_type(self):
        Location.objects.create(
            site=self.site, code="LOC-TST-TYPEA", canonical_address="TST-SITE.01-01-001-14", location_type="TST_TYPE_A"
        )
        Location.objects.create(
            site=self.site, code="LOC-TST-TYPEB", canonical_address="TST-SITE.01-01-001-15", location_type="TST_TYPE_B"
        )

        response = self.client_api.get("/api/master-data/locations/", {"location_type": "TST_TYPE_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "LOC-TST-TYPEA")

    def test_filter_by_room(self):
        Location.objects.create(site=self.site, code="LOC-TST-ROOMA", canonical_address="TST-SITE.01-01-001-16", room="TST-ROOM-A")
        Location.objects.create(site=self.site, code="LOC-TST-ROOMB", canonical_address="TST-SITE.01-01-001-17", room="TST-ROOM-B")

        response = self.client_api.get("/api/master-data/locations/", {"room": "TST-ROOM-A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "LOC-TST-ROOMA")

    def test_filter_by_active(self):
        Location.objects.create(site=self.site, code="LOC-TST-ACTIVE", canonical_address="TST-SITE.01-01-001-18", active=True)
        Location.objects.create(site=self.site, code="LOC-TST-INACTIVE", canonical_address="TST-SITE.01-01-001-19", active=False)

        response = self.client_api.get("/api/master-data/locations/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("LOC-TST-INACTIVE", codes)
        self.assertNotIn("LOC-TST-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        location = Location.objects.create(
            site=self.site, code="LOC-TST-TOGGLE", canonical_address="TST-SITE.01-01-001-20", active=True
        )

        response = self.client_api.patch(f"/api/master-data/locations/{location.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Location.objects.filter(pk=location.pk).exists())
        location.refresh_from_db()
        self.assertFalse(location.active)

    def test_export_csv(self):
        Location.objects.create(site=self.site, code="LOC-TST-EXPORT", canonical_address="TST-SITE.01-01-001-21")
        response = self.client_api.get("/api/master-data/locations/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("LOC-TST-EXPORT", content)
        self.assertIn("TST-SITE", content)
        self.assertIn("código", content)

    def test_import_csv_identifies_site_by_code(self):
        csv_content = (
            "código;site;endereço canônico;tipo de localização\n"
            "LOC-TST-IMPORT1;TST-SITE;TST-SITE.01-01-001-22;RACK_POSITION\n"
        )
        upload = SimpleUploadedFile("locations.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/locations/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        imported = Location.objects.get(code="LOC-TST-IMPORT1")
        self.assertEqual(imported.site_id, self.site.pk)

    def test_seed_matches_expected_seven_records(self):
        expected_addresses = {
            "GRU65.01-01-002-53",
            "GRU65.01-01-002-44",
            "GRU65.01-01-002-50",
            "GRU65.01-01-001-19",
            "GRU65.01-01-001-83",
            "GRU65.01-01-010-55",
            "GRU65.01-01-010-61",
        }
        addresses = set(Location.objects.values_list("canonical_address", flat=True))
        self.assertEqual(expected_addresses & addresses, expected_addresses)

    def test_seed_location_resolves_site_and_type_without_parsing(self):
        location = Location.objects.get(canonical_address="GRU65.01-01-010-55")
        self.assertEqual(location.site.code, "GRU65")
        self.assertEqual(location.location_type, "RACK_POSITION")

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0022_seed_locations")
        count_before = Location.objects.count()
        module.seed_locations(django_apps, None)
        module.seed_locations(django_apps, None)
        self.assertEqual(Location.objects.count(), count_before)


class DeviceTypeApiTests(TestCase):
    """Cadastros Mestres > Infraestrutura > Tipos de Dispositivo — CRUD,
    obrigatoriedade, busca, filtros, CSV, ativação/inativação e seed
    idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="device_type_admin", email="device_type@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0024_seed_device_types) roda também no
        # banco de testes (15 registros).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"code": "TST-DEV-0001", "name": "Tipo de teste", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        device_type = DeviceType.objects.get(pk=response.data["id"])
        self.assertEqual(device_type.created_by, self.admin)
        self.assertEqual(device_type.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"name": "Sem código", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        DeviceType.objects.create(code="TST-DEV-DUP", name="Original", category="TEST_CATEGORY")
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"code": "TST-DEV-DUP", "name": "Duplicado", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(DeviceType.objects.filter(code="TST-DEV-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"code": "TST-DEV-0002", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_category_is_required(self):
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"code": "TST-DEV-0003", "name": "Sem categoria"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_default_medium_is_optional(self):
        response = self.client_api.post(
            "/api/master-data/device-types/",
            {"code": "TST-DEV-0004", "name": "Sem meio padrão", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["default_medium"], "")

    def test_update_edits_fields(self):
        device_type = DeviceType.objects.create(code="TST-DEV-EDIT", name="Original", category="TEST_CATEGORY")

        response = self.client_api.patch(
            f"/api/master-data/device-types/{device_type.pk}/",
            {"name": "Editado", "default_medium": "MIXED"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        device_type.refresh_from_db()
        self.assertEqual(device_type.name, "Editado")
        self.assertEqual(device_type.default_medium, "MIXED")

    def test_search_by_code_name_category_default_medium(self):
        DeviceType.objects.create(
            code="TST-DEV-SEARCH", name="Tipo pesquisável", category="TST_SEARCHABLE_CATEGORY", default_medium="FIBER"
        )

        response = self.client_api.get("/api/master-data/device-types/", {"search": "TST_SEARCHABLE_CATEGORY"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-DEV-SEARCH")

    def test_filter_by_category(self):
        DeviceType.objects.create(code="TST-DEV-CATA", name="A", category="TST_CAT_A")
        DeviceType.objects.create(code="TST-DEV-CATB", name="B", category="TST_CAT_B")

        response = self.client_api.get("/api/master-data/device-types/", {"category": "TST_CAT_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-DEV-CATA")

    def test_filter_by_default_medium(self):
        DeviceType.objects.create(code="TST-DEV-FIBER", name="A", category="TEST_CATEGORY", default_medium="TST_FIBER_MEDIUM")
        DeviceType.objects.create(code="TST-DEV-COPPER", name="B", category="TEST_CATEGORY", default_medium="TST_COPPER_MEDIUM")

        response = self.client_api.get("/api/master-data/device-types/", {"default_medium": "TST_FIBER_MEDIUM"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-DEV-FIBER")

    def test_filter_by_active(self):
        DeviceType.objects.create(code="TST-DEV-ACTIVE", name="Ativo", category="TEST_CATEGORY", active=True)
        DeviceType.objects.create(code="TST-DEV-INACTIVE", name="Inativo", category="TEST_CATEGORY", active=False)

        response = self.client_api.get("/api/master-data/device-types/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-DEV-INACTIVE", codes)
        self.assertNotIn("TST-DEV-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        device_type = DeviceType.objects.create(code="TST-DEV-TOGGLE", name="Para inativar", category="TEST_CATEGORY", active=True)

        response = self.client_api.patch(f"/api/master-data/device-types/{device_type.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(DeviceType.objects.filter(pk=device_type.pk).exists())
        device_type.refresh_from_db()
        self.assertFalse(device_type.active)

    def test_export_csv(self):
        DeviceType.objects.create(code="TST-DEV-EXPORT", name="Exportação de teste", category="TEST_CATEGORY")
        response = self.client_api.get("/api/master-data/device-types/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-DEV-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;categoria;meio padrão\n"
            "TST-DEV-IMPORT1;Tipo Importado 1;TEST_CATEGORY;FIBER\n"
            "TST-DEV-IMPORT2;Tipo Importado 2;TEST_CATEGORY;\n"
        )
        upload = SimpleUploadedFile("device_types.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/device-types/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = DeviceType.objects.get(code="TST-DEV-IMPORT1")
        self.assertEqual(imported.default_medium, "FIBER")

    def test_seed_matches_expected_fifteen_records(self):
        expected_codes = {
            "EUCLID_SPINE", "BFC_BRICK", "EUCLID_BRICK", "MGMT_RACK", "MGMT_SWITCH", "CONSOLE_SWITCH", "TOR",
            "PSC", "EBR", "IDF", "MR", "WAP", "PATCH_PANEL", "WDM", "OTHER",
        }
        codes = set(DeviceType.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0024_seed_device_types")
        count_before = DeviceType.objects.count()
        module.seed_device_types(django_apps, None)
        module.seed_device_types(django_apps, None)
        self.assertEqual(DeviceType.objects.count(), count_before)


class TaskTemplateApiTests(TestCase):
    """Cadastros Mestres > Operação > Templates de Tarefas — CRUD,
    obrigatoriedade, busca, filtros, CSV, ativação/inativação e seed
    idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="task_template_admin", email="task_template@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0026_seed_task_templates) roda também no
        # banco de testes (8 registros).

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"code": "TST-TPL-0001", "name": "Template de teste", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        task_template = TaskTemplate.objects.get(pk=response.data["id"])
        self.assertEqual(task_template.created_by, self.admin)
        self.assertEqual(task_template.updated_by, self.admin)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"name": "Sem código", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        TaskTemplate.objects.create(code="TST-TPL-DUP", name="Original", category="TEST_CATEGORY")
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"code": "TST-TPL-DUP", "name": "Duplicado", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)
        self.assertEqual(TaskTemplate.objects.filter(code="TST-TPL-DUP").count(), 1)

    def test_name_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"code": "TST-TPL-0002", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_category_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"code": "TST-TPL-0003", "name": "Sem categoria"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("category", response.data)

    def test_medium_is_optional(self):
        response = self.client_api.post(
            "/api/master-data/task-templates/",
            {"code": "TST-TPL-0004", "name": "Sem meio", "category": "TEST_CATEGORY"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["medium"], "")

    def test_update_edits_fields(self):
        task_template = TaskTemplate.objects.create(code="TST-TPL-EDIT", name="Original", category="TEST_CATEGORY")

        response = self.client_api.patch(
            f"/api/master-data/task-templates/{task_template.pk}/",
            {"name": "Editado", "medium": "MIXED"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        task_template.refresh_from_db()
        self.assertEqual(task_template.name, "Editado")
        self.assertEqual(task_template.medium, "MIXED")

    def test_search_by_code_name_category_medium(self):
        TaskTemplate.objects.create(
            code="TST-TPL-SEARCH", name="Template pesquisável", category="TST_SEARCHABLE_CATEGORY", medium="FIBER"
        )

        response = self.client_api.get("/api/master-data/task-templates/", {"search": "TST_SEARCHABLE_CATEGORY"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-TPL-SEARCH")

    def test_filter_by_category(self):
        TaskTemplate.objects.create(code="TST-TPL-CATA", name="A", category="TST_CAT_A")
        TaskTemplate.objects.create(code="TST-TPL-CATB", name="B", category="TST_CAT_B")

        response = self.client_api.get("/api/master-data/task-templates/", {"category": "TST_CAT_A"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-TPL-CATA")

    def test_filter_by_medium(self):
        TaskTemplate.objects.create(code="TST-TPL-FIBER", name="A", category="TEST_CATEGORY", medium="TST_FIBER_MEDIUM")
        TaskTemplate.objects.create(code="TST-TPL-COPPER", name="B", category="TEST_CATEGORY", medium="TST_COPPER_MEDIUM")

        response = self.client_api.get("/api/master-data/task-templates/", {"medium": "TST_FIBER_MEDIUM"})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-TPL-FIBER")

    def test_filter_by_active(self):
        TaskTemplate.objects.create(code="TST-TPL-ACTIVE", name="Ativo", category="TEST_CATEGORY", active=True)
        TaskTemplate.objects.create(code="TST-TPL-INACTIVE", name="Inativo", category="TEST_CATEGORY", active=False)

        response = self.client_api.get("/api/master-data/task-templates/", {"is_active": "false"})

        codes = [row["code"] for row in response.data["results"]]
        self.assertIn("TST-TPL-INACTIVE", codes)
        self.assertNotIn("TST-TPL-ACTIVE", codes)

    def test_deactivate_does_not_hard_delete(self):
        task_template = TaskTemplate.objects.create(code="TST-TPL-TOGGLE", name="Para inativar", category="TEST_CATEGORY", active=True)

        response = self.client_api.patch(f"/api/master-data/task-templates/{task_template.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(TaskTemplate.objects.filter(pk=task_template.pk).exists())
        task_template.refresh_from_db()
        self.assertFalse(task_template.active)

    def test_export_csv(self):
        TaskTemplate.objects.create(code="TST-TPL-EXPORT", name="Exportação de teste", category="TEST_CATEGORY")
        response = self.client_api.get("/api/master-data/task-templates/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-TPL-EXPORT", content)
        self.assertIn("código", content)

    def test_import_csv_creates_rows(self):
        csv_content = (
            "código;nome;categoria;meio\n"
            "TST-TPL-IMPORT1;Template Importado 1;TEST_CATEGORY;FIBER\n"
            "TST-TPL-IMPORT2;Template Importado 2;TEST_CATEGORY;\n"
        )
        upload = SimpleUploadedFile("task_templates.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/task-templates/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["errors"], [])
        imported = TaskTemplate.objects.get(code="TST-TPL-IMPORT1")
        self.assertEqual(imported.medium, "FIBER")

    def test_seed_matches_expected_eight_records(self):
        expected_codes = {
            "TPL-FIBER-PRETERMINATED", "TPL-FIBER-ROBUST", "TPL-FIBER-MPO", "TPL-COPPER-FIELD-TERMINATED",
            "TPL-COPPER-PRETERMINATED", "TPL-WAP-COPPER", "TPL-HARDWARE-INSTALL", "TPL-PROJECT-CLOSURE",
        }
        codes = set(TaskTemplate.objects.values_list("code", flat=True))
        self.assertEqual(expected_codes & codes, expected_codes)

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0026_seed_task_templates")
        count_before = TaskTemplate.objects.count()
        module.seed_task_templates(django_apps, None)
        module.seed_task_templates(django_apps, None)
        self.assertEqual(TaskTemplate.objects.count(), count_before)


class TaskTemplateStepApiTests(TestCase):
    """Cadastros Mestres > Operação > Etapas dos Templates — CRUD,
    obrigatoriedade, unicidade de ordem, FK protegida, effective_name,
    busca, filtros, CSV, ativação/inativação e seed idempotente."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="task_template_step_admin", email="task_template_step@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0028_seed_task_template_steps) roda também
        # no banco de testes (63 registros, distribuídos pelos 8
        # templates).
        self.template = TaskTemplate.objects.create(code="TST-TPL", name="Template de teste", category="TEST_CATEGORY")
        self.other_template = TaskTemplate.objects.create(code="TST-TPL-OTHER", name="Outro template", category="TEST_CATEGORY")
        self.activity = Activity.objects.create(code="TST-ACT", name="Atividade de teste", category="TEST_CATEGORY")

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.template.pk, "activity": self.activity.pk, "step_order": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        step = TaskTemplateStep.objects.get(pk=response.data["id"])
        self.assertEqual(step.created_by, self.admin)
        self.assertEqual(step.updated_by, self.admin)
        self.assertEqual(response.data["task_template_code"], "TST-TPL")
        self.assertEqual(response.data["activity_code"], "TST-ACT")

    def test_task_template_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"activity": self.activity.pk, "step_order": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("task_template", response.data)

    def test_activity_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.template.pk, "step_order": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("activity", response.data)

    def test_step_order_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.template.pk, "activity": self.activity.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("step_order", response.data)

    def test_step_order_must_be_positive(self):
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.template.pk, "activity": self.activity.pk, "step_order": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("step_order", response.data)

    def test_unique_step_order_per_template(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.template.pk, "activity": self.activity.pk, "step_order": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(TaskTemplateStep.objects.filter(task_template=self.template, step_order=10).count(), 1)

    def test_same_step_order_allowed_in_different_template(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        response = self.client_api.post(
            "/api/master-data/task-template-steps/",
            {"task_template": self.other_template.pk, "activity": self.activity.pk, "step_order": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_required_defaults_true(self):
        step = TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        self.assertTrue(step.required)

    def test_repeatable_defaults_false(self):
        step = TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        self.assertFalse(step.repeatable)

    def test_task_template_foreign_key_is_protected(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        with self.assertRaises(ProtectedError):
            self.template.delete()

    def test_activity_foreign_key_is_protected(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        with self.assertRaises(ProtectedError):
            self.activity.delete()

    def test_update_edits_fields(self):
        step = TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)

        response = self.client_api.patch(
            f"/api/master-data/task-template-steps/{step.pk}/",
            {"step_order": 20, "required": False, "repeatable": True, "quantity_source": "CABLE_COUNT"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        step.refresh_from_db()
        self.assertEqual(step.step_order, 20)
        self.assertFalse(step.required)
        self.assertTrue(step.repeatable)
        self.assertEqual(step.quantity_source, "CABLE_COUNT")

    def test_effective_name_without_override(self):
        step = TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        self.assertEqual(step.effective_name, self.activity.name)

        response = self.client_api.get(f"/api/master-data/task-template-steps/{step.pk}/")
        self.assertEqual(response.data["effective_name"], self.activity.name)

    def test_effective_name_with_override(self):
        step = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.activity, step_order=10, name_override="Nome customizado"
        )
        self.assertEqual(step.effective_name, "Nome customizado")

        response = self.client_api.get(f"/api/master-data/task-template-steps/{step.pk}/")
        self.assertEqual(response.data["effective_name"], "Nome customizado")

    def test_search_by_activity_and_template(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)

        by_activity = self.client_api.get("/api/master-data/task-template-steps/", {"search": "TST-ACT"})
        self.assertEqual(by_activity.data["count"], 1)

        by_template = self.client_api.get("/api/master-data/task-template-steps/", {"search": "TST-TPL-OTHER"})
        self.assertEqual(by_template.data["count"], 0)

    def test_filter_by_task_template(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        TaskTemplateStep.objects.create(task_template=self.other_template, activity=self.activity, step_order=10)

        response = self.client_api.get("/api/master-data/task-template-steps/", {"task_template": self.template.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["task_template_code"], "TST-TPL")

    def test_filter_by_activity(self):
        other_activity = Activity.objects.create(code="TST-ACT-OTHER", name="Outra atividade", category="TEST_CATEGORY")
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        TaskTemplateStep.objects.create(task_template=self.template, activity=other_activity, step_order=20)

        response = self.client_api.get("/api/master-data/task-template-steps/", {"activity": self.activity.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["activity_code"], "TST-ACT")

    def test_filter_by_required_and_repeatable(self):
        # Combinado com o filtro por template para não depender da posição
        # na paginação — o seed real já tem muitas etapas repeatable=True/
        # required=True espalhadas por 8 templates.
        TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.activity, step_order=10, required=True, repeatable=True
        )
        TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.activity, step_order=20, required=False, repeatable=False
        )

        by_required = self.client_api.get(
            "/api/master-data/task-template-steps/", {"task_template": self.template.pk, "required": "false"}
        )
        self.assertEqual(by_required.data["count"], 1)
        self.assertEqual(by_required.data["results"][0]["step_order"], 20)

        by_repeatable = self.client_api.get(
            "/api/master-data/task-template-steps/", {"task_template": self.template.pk, "repeatable": "true"}
        )
        self.assertEqual(by_repeatable.data["count"], 1)
        self.assertEqual(by_repeatable.data["results"][0]["step_order"], 10)

    def test_deactivate_does_not_hard_delete(self):
        step = TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10, active=True)

        response = self.client_api.patch(f"/api/master-data/task-template-steps/{step.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(TaskTemplateStep.objects.filter(pk=step.pk).exists())
        step.refresh_from_db()
        self.assertFalse(step.active)

    def test_export_csv(self):
        TaskTemplateStep.objects.create(task_template=self.template, activity=self.activity, step_order=10)
        response = self.client_api.get("/api/master-data/task-template-steps/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-TPL", content)
        self.assertIn("TST-ACT", content)

    def test_import_csv_resolves_template_and_activity_by_code(self):
        # Inclui todas as colunas booleanas explicitamente — o importador
        # genérico (core.csv_io) monta o objeto a partir de TODAS as
        # colunas de get_csv_fields(), então uma coluna booleana ausente
        # do CSV é interpretada como "não" (não herda o default do
        # model); por isso "obrigatória"/"repetível" vão explícitas aqui.
        csv_content = "template;atividade;ordem;obrigatória;repetível\nTST-TPL;TST-ACT;30;Sim;Não\n"
        upload = SimpleUploadedFile("task_template_steps.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/task-template-steps/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        imported = TaskTemplateStep.objects.get(task_template=self.template, step_order=30)
        self.assertEqual(imported.activity_id, self.activity.pk)
        self.assertTrue(imported.required)
        self.assertFalse(imported.repeatable)

    def test_seed_counts_per_template(self):
        counts = {
            "TPL-FIBER-PRETERMINATED": 9,
            "TPL-FIBER-ROBUST": 9,
            "TPL-FIBER-MPO": 9,
            "TPL-COPPER-FIELD-TERMINATED": 12,
            "TPL-COPPER-PRETERMINATED": 9,
            "TPL-WAP-COPPER": 12,
            "TPL-HARDWARE-INSTALL": 0,
            "TPL-PROJECT-CLOSURE": 3,
        }
        for template_code, expected_count in counts.items():
            actual = TaskTemplateStep.objects.filter(task_template__code=template_code).count()
            self.assertEqual(actual, expected_count, f"{template_code}: esperado {expected_count}, obtido {actual}")

    def test_seed_total_matches_sixty_three(self):
        self.assertEqual(TaskTemplateStep.objects.count(), 63)

    def test_seed_acceptance_criteria_copper_field_terminated(self):
        template = TaskTemplate.objects.get(code="TPL-COPPER-FIELD-TERMINATED")
        steps = list(
            TaskTemplateStep.objects.filter(task_template=template).select_related("activity").order_by("step_order")
        )
        names = [(s.step_order, s.effective_name) for s in steps]
        self.assertEqual(
            names,
            [
                (10, "Separar materiais"),
                (20, "Conferir materiais"),
                (30, "Medir cabeamento"),
                (40, "Cortar cabeamento"),
                (50, "Aplicar labels"),
                (60, "Lançar cabeamento"),
                (70, "Organizar cabeamento"),
                (80, "Crimpar RJ45"),
                (90, "Certificar cabeamento"),
                (100, "Realizar patching"),
                (110, "Realizar QA/QC"),
                (120, "Registrar evidências"),
            ],
        )

    def test_seed_acceptance_criteria_fiber_mpo(self):
        template = TaskTemplate.objects.get(code="TPL-FIBER-MPO")
        steps = list(
            TaskTemplateStep.objects.filter(task_template=template).select_related("activity").order_by("step_order")
        )
        names = [(s.step_order, s.effective_name) for s in steps]
        self.assertEqual(
            names,
            [
                (10, "Separar materiais"),
                (20, "Conferir materiais"),
                (30, "Aplicar labels"),
                (40, "Lançar cabeamento"),
                (50, "Organizar cabeamento"),
                (60, "Realizar patching"),
                (70, "Certificar cabeamento"),
                (80, "Realizar QA/QC"),
                (90, "Registrar evidências"),
            ],
        )

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0028_seed_task_template_steps")
        count_before = TaskTemplateStep.objects.count()
        module.seed_task_template_steps(django_apps, None)
        module.seed_task_template_steps(django_apps, None)
        self.assertEqual(TaskTemplateStep.objects.count(), count_before)


class TaskTemplateRuleApiTests(TestCase):
    """Cadastros Mestres > Operação > Regras de Templates — CRUD,
    obrigatoriedade, unicidade de código, critérios opcionais,
    specificity_score, consistência spec x family, duplicidade lógica,
    busca, filtros, CSV, ativação/inativação, seed idempotente e FK
    PROTECT."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="task_template_rule_admin", email="task_template_rule@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de Cadastros
        # Mestres: o seed real (0030_seed_task_template_rules) roda também
        # no banco de testes (17 regras).
        self.template = TaskTemplate.objects.create(code="TST-TPL", name="Template de teste", category="TEST_CATEGORY")
        self.other_template = TaskTemplate.objects.create(code="TST-TPL-OTHER", name="Outro template", category="TEST_CATEGORY")
        self.family = CableFamily.objects.create(code="TST-FAM", name="Família de teste", medium="FIBER")
        self.other_family = CableFamily.objects.create(code="TST-FAM-OTHER", name="Outra família", medium="FIBER")
        self.spec = CableSpec.objects.create(code="TST-SPEC", name="Spec de teste", cable_family=self.family)
        self.other_family_spec = CableSpec.objects.create(
            code="TST-SPEC-OTHER-FAM", name="Spec de outra família", cable_family=self.other_family
        )
        self.network = Network.objects.create(code="TST-NET", name="Rede de teste", domain="MANAGEMENT", medium="FIBER")
        self.workstream = Workstream.objects.create(code="TST-WS", name="Workstream de teste", category="CABLING")

    def test_create_sets_created_by_and_updated_by(self):
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {"code": "TST-RULE-1", "name": "Regra de teste", "task_template": self.template.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        rule = TaskTemplateRule.objects.get(pk=response.data["id"])
        self.assertEqual(rule.created_by, self.admin)
        self.assertEqual(rule.updated_by, self.admin)
        self.assertEqual(response.data["task_template_code"], "TST-TPL")

    def test_task_template_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {"code": "TST-RULE-2", "name": "Regra sem template"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("task_template", response.data)

    def test_code_is_required(self):
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {"name": "Regra sem código", "task_template": self.template.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_code_must_be_unique(self):
        TaskTemplateRule.objects.create(code="TST-RULE-DUP", name="Original", task_template=self.template)
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {"code": "TST-RULE-DUP", "name": "Duplicada", "task_template": self.other_template.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.data)

    def test_priority_defaults_to_100(self):
        rule = TaskTemplateRule.objects.create(code="TST-RULE-PRIO", name="Regra", task_template=self.template)
        self.assertEqual(rule.priority, 100)

    def test_optional_criteria_can_be_left_blank(self):
        rule = TaskTemplateRule.objects.create(code="TST-RULE-BLANK", name="Regra genérica", task_template=self.template)
        self.assertIsNone(rule.cable_family_id)
        self.assertIsNone(rule.cable_spec_id)
        self.assertIsNone(rule.network_id)
        self.assertIsNone(rule.workstream_id)
        self.assertEqual(rule.medium, "")
        self.assertIsNone(rule.preterminated)

    def test_preterminated_accepts_true_false_and_null(self):
        rule_true = TaskTemplateRule.objects.create(
            code="TST-RULE-PT-TRUE", name="Pré-terminado true", task_template=self.template, preterminated=True
        )
        rule_false = TaskTemplateRule.objects.create(
            code="TST-RULE-PT-FALSE", name="Pré-terminado false", task_template=self.template, preterminated=False
        )
        rule_null = TaskTemplateRule.objects.create(
            code="TST-RULE-PT-NULL", name="Pré-terminado null", task_template=self.template
        )
        self.assertTrue(rule_true.preterminated)
        self.assertFalse(rule_false.preterminated)
        self.assertIsNone(rule_null.preterminated)

    def test_specificity_score_counts_filled_optional_criteria(self):
        rule = TaskTemplateRule.objects.create(
            code="TST-RULE-SCORE",
            name="Regra específica",
            task_template=self.template,
            cable_family=self.family,
            network=self.network,
        )
        self.assertEqual(rule.specificity_score, 2)

        response = self.client_api.get(f"/api/master-data/task-template-rules/{rule.pk}/")
        self.assertEqual(response.data["specificity_score"], 2)

    def test_specificity_score_zero_when_fully_generic(self):
        rule = TaskTemplateRule.objects.create(code="TST-RULE-GENERIC", name="Fallback", task_template=self.template)
        self.assertEqual(rule.specificity_score, 0)

    def test_specificity_score_counts_all_six_criteria(self):
        rule = TaskTemplateRule.objects.create(
            code="TST-RULE-FULL",
            name="Regra totalmente específica",
            task_template=self.template,
            cable_family=self.family,
            cable_spec=self.spec,
            network=self.network,
            workstream=self.workstream,
            medium="FIBER",
            preterminated=False,
        )
        self.assertEqual(rule.specificity_score, 6)

    def test_spec_compatible_with_family_is_accepted(self):
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {
                "code": "TST-RULE-COMPAT",
                "name": "Spec compatível",
                "task_template": self.template.pk,
                "cable_family": self.family.pk,
                "cable_spec": self.spec.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_spec_incompatible_with_family_is_rejected(self):
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {
                "code": "TST-RULE-INCOMPAT",
                "name": "Spec incompatível",
                "task_template": self.template.pk,
                "cable_family": self.family.pk,
                "cable_spec": self.other_family_spec.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cable_spec", response.data)
        self.assertFalse(TaskTemplateRule.objects.filter(code="TST-RULE-INCOMPAT").exists())

    def test_logical_duplicate_is_rejected(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-ORIG",
            name="Original",
            task_template=self.template,
            cable_family=self.family,
            priority=10,
        )
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {
                "code": "TST-RULE-COPY",
                "name": "Cópia idêntica nos critérios",
                "task_template": self.template.pk,
                "cable_family": self.family.pk,
                "priority": 10,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(TaskTemplateRule.objects.filter(code="TST-RULE-COPY").exists())

    def test_same_criteria_with_different_priority_is_not_duplicate(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-P10", name="Prioridade 10", task_template=self.template, cable_family=self.family, priority=10
        )
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {
                "code": "TST-RULE-P20",
                "name": "Prioridade 20",
                "task_template": self.template.pk,
                "cable_family": self.family.pk,
                "priority": 20,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_inactive_duplicate_does_not_block_new_active_rule(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-INACTIVE",
            name="Inativa",
            task_template=self.template,
            cable_family=self.family,
            priority=10,
            active=False,
        )
        response = self.client_api.post(
            "/api/master-data/task-template-rules/",
            {
                "code": "TST-RULE-REACTIVATED",
                "name": "Nova ativa, mesmos critérios",
                "task_template": self.template.pk,
                "cable_family": self.family.pk,
                "priority": 10,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_task_template_foreign_key_is_protected(self):
        TaskTemplateRule.objects.create(code="TST-RULE-PROTECT", name="Regra", task_template=self.template)
        with self.assertRaises(ProtectedError):
            self.template.delete()

    def test_cable_family_foreign_key_is_protected(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-PROTECT-FAM", name="Regra", task_template=self.template, cable_family=self.family
        )
        with self.assertRaises(ProtectedError):
            self.family.delete()

    def test_update_edits_fields(self):
        rule = TaskTemplateRule.objects.create(code="TST-RULE-EDIT", name="Original", task_template=self.template)

        response = self.client_api.patch(
            f"/api/master-data/task-template-rules/{rule.pk}/",
            {"name": "Editada", "priority": 250, "medium": "COPPER"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        rule.refresh_from_db()
        self.assertEqual(rule.name, "Editada")
        self.assertEqual(rule.priority, 250)
        self.assertEqual(rule.medium, "COPPER")

    def test_search_by_code_and_name(self):
        TaskTemplateRule.objects.create(code="TST-RULE-SEARCH", name="Regra pesquisável", task_template=self.template)

        by_code = self.client_api.get("/api/master-data/task-template-rules/", {"search": "TST-RULE-SEARCH"})
        self.assertEqual(by_code.data["count"], 1)

        by_name = self.client_api.get("/api/master-data/task-template-rules/", {"search": "pesquisável"})
        self.assertEqual(by_name.data["count"], 1)

        by_template = self.client_api.get("/api/master-data/task-template-rules/", {"search": "TST-TPL-OTHER"})
        self.assertEqual(by_template.data["count"], 0)

    def test_filter_by_task_template(self):
        TaskTemplateRule.objects.create(code="TST-RULE-F1", name="Regra 1", task_template=self.template)
        TaskTemplateRule.objects.create(code="TST-RULE-F2", name="Regra 2", task_template=self.other_template)

        response = self.client_api.get("/api/master-data/task-template-rules/", {"task_template": self.template.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-RULE-F1")

    def test_filter_by_cable_family(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-FAM1", name="Regra família 1", task_template=self.template, cable_family=self.family
        )
        TaskTemplateRule.objects.create(
            code="TST-RULE-FAM2", name="Regra família 2", task_template=self.template, cable_family=self.other_family
        )

        response = self.client_api.get("/api/master-data/task-template-rules/", {"cable_family": self.family.pk})

        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], "TST-RULE-FAM1")

    def test_filter_by_medium_and_preterminated(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-MED1", name="Fibra", task_template=self.template, medium="FIBER", preterminated=True
        )
        TaskTemplateRule.objects.create(
            code="TST-RULE-MED2", name="Cobre", task_template=self.template, medium="COPPER", preterminated=False
        )

        by_medium = self.client_api.get(
            "/api/master-data/task-template-rules/", {"task_template": self.template.pk, "medium": "FIBER"}
        )
        self.assertEqual(by_medium.data["count"], 1)
        self.assertEqual(by_medium.data["results"][0]["code"], "TST-RULE-MED1")

        by_preterminated = self.client_api.get(
            "/api/master-data/task-template-rules/", {"task_template": self.template.pk, "preterminated": "false"}
        )
        self.assertEqual(by_preterminated.data["count"], 1)
        self.assertEqual(by_preterminated.data["results"][0]["code"], "TST-RULE-MED2")

    def test_deactivate_does_not_hard_delete(self):
        rule = TaskTemplateRule.objects.create(code="TST-RULE-DEACT", name="Regra", task_template=self.template, active=True)

        response = self.client_api.patch(f"/api/master-data/task-template-rules/{rule.pk}/", {"active": False}, format="json")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(TaskTemplateRule.objects.filter(pk=rule.pk).exists())
        rule.refresh_from_db()
        self.assertFalse(rule.active)

    def test_export_csv(self):
        TaskTemplateRule.objects.create(
            code="TST-RULE-EXPORT", name="Regra exportável", task_template=self.template, cable_family=self.family
        )
        response = self.client_api.get("/api/master-data/task-template-rules/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-RULE-EXPORT", content)
        self.assertIn("TST-TPL", content)

    def test_import_csv_resolves_task_template_by_code(self):
        csv_content = "código;nome;template;prioridade\nTST-RULE-IMPORT;Regra importada;TST-TPL;150\n"
        upload = SimpleUploadedFile("task_template_rules.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/task-template-rules/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        imported = TaskTemplateRule.objects.get(code="TST-RULE-IMPORT")
        self.assertEqual(imported.task_template_id, self.template.pk)
        self.assertEqual(imported.priority, 150)

    def test_import_csv_resolves_optional_relations_by_str(self):
        # cable_family/network/workstream resolvem pelo __str__ padrão
        # ("código — nome"), mesmo mecanismo genérico de core.csv_io usado
        # por CableAlias/CableSpec.
        csv_content = (
            "código;nome;template;família de cabo;rede;workstream;prioridade\n"
            f"TST-RULE-IMPORT-REL;Regra com relações;TST-TPL;{self.family};{self.network};{self.workstream};10\n"
        )
        upload = SimpleUploadedFile("task_template_rules.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/task-template-rules/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        imported = TaskTemplateRule.objects.get(code="TST-RULE-IMPORT-REL")
        self.assertEqual(imported.cable_family_id, self.family.pk)
        self.assertEqual(imported.network_id, self.network.pk)
        self.assertEqual(imported.workstream_id, self.workstream.pk)

    def test_seed_total_matches_seventeen(self):
        self.assertEqual(TaskTemplateRule.objects.count(), 17)

    def test_seed_acceptance_criteria_fib_72f_mpob(self):
        rule = TaskTemplateRule.objects.get(code="RULE-FIB-72F-MPOB")
        self.assertEqual(rule.cable_family.code, "FIB-72F-MPOB")
        self.assertEqual(rule.task_template.code, "TPL-FIBER-MPO")

    def test_seed_fallback_fiber_generic(self):
        rule = TaskTemplateRule.objects.get(code="RULE-FIBER-GENERIC")
        self.assertEqual(rule.medium, "FIBER")
        self.assertIsNone(rule.cable_family_id)
        self.assertEqual(rule.task_template.code, "TPL-FIBER-PRETERMINATED")
        self.assertEqual(rule.priority, 500)

    def test_seed_cat6_rules_use_preterminated_attribute(self):
        field_rule = TaskTemplateRule.objects.get(code="RULE-CAT6-FIELD")
        preterm_rule = TaskTemplateRule.objects.get(code="RULE-CAT6-PRETERM")
        self.assertFalse(field_rule.preterminated)
        self.assertTrue(preterm_rule.preterminated)
        self.assertEqual(field_rule.cable_family.code, "COP-CAT6")
        self.assertEqual(preterm_rule.cable_family.code, "COP-CAT6")

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0030_seed_task_template_rules")
        count_before = TaskTemplateRule.objects.count()
        module.seed_task_template_rules(django_apps, None)
        module.seed_task_template_rules(django_apps, None)
        self.assertEqual(TaskTemplateRule.objects.count(), count_before)


class TaskTemplateRuleSimulatorTests(TestCase):
    """Cadastros Mestres > Operação > Simulador de Regras — endpoint
    POST /api/master-data/task-template-rules/simulate/. Testa o motor de
    match (master_data.services.task_rule_resolver) através da API real,
    contra o seed real de TaskTemplateRule/TaskTemplate/TaskTemplateStep
    (17 regras, 63 etapas) — não recria esses dados aqui, exceto quando o
    cenário exige regras/famílias dedicadas (prefixo "TST-", mesmo motivo
    das outras suítes deste módulo: não colidir com o seed real)."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="task_rule_simulator_admin", email="task_rule_simulator@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

    def simulate(self, payload):
        return self.client_api.post("/api/master-data/task-template-rules/simulate/", payload, format="json")

    def test_fib_72f_mpob_selects_specific_rule_and_mpo_template(self):
        family = CableFamily.objects.get(code="FIB-72F-MPOB")
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-72F-MPOB")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-MPO")
        self.assertEqual(len(response.data["steps"]), 9)
        self.assertEqual(response.data["steps"][0]["step_order"], 10)
        self.assertEqual(response.data["steps"][0]["activity_code"], "MAT-SEP")
        # RULE-FIBER-GENERIC também é compatível (medium derivado de FIBER),
        # com prioridade pior — deve aparecer como match secundário, não
        # como o selecionado.
        codes = [m["rule"]["code"] for m in response.data["matches"]]
        self.assertEqual(codes[0], "RULE-FIB-72F-MPOB")
        self.assertIn("RULE-FIBER-GENERIC", codes)

    def test_fib_8f_lclc_selects_fiber_preterminated_template(self):
        family = CableFamily.objects.get(code="FIB-8F-LCLC")
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-8F-LCLC")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-PRETERMINATED")

    def test_fib_2f_robust_selects_fiber_robust_template(self):
        family = CableFamily.objects.get(code="FIB-2F-ROBUST")
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-2F-ROBUST")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-ROBUST")

    def test_cat6_preterminated_false_selects_field_terminated_template(self):
        family = CableFamily.objects.get(code="COP-CAT6")
        response = self.simulate({"cable_family": family.pk, "preterminated": False})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-CAT6-FIELD")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-COPPER-FIELD-TERMINATED")
        self.assertEqual(len(response.data["steps"]), 12)

    def test_cat6_preterminated_true_selects_preterminated_template(self):
        family = CableFamily.objects.get(code="COP-CAT6")
        response = self.simulate({"cable_family": family.pk, "preterminated": True})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-CAT6-PRETERM")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-COPPER-PRETERMINATED")
        self.assertEqual(len(response.data["steps"]), 9)

    def test_fiber_family_without_specific_rule_falls_back_to_generic(self):
        # Família nova, sem nenhuma TaskTemplateRule específica — só o
        # fallback genérico (medium=FIBER) deve casar.
        family = CableFamily.objects.create(code="TST-FIB-NO-RULE", name="Fibra sem regra", medium="FIBER")
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIBER-GENERIC")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-PRETERMINATED")
        self.assertTrue(any("fallback" in w.lower() for w in response.data["warnings"]))

    def test_more_specific_rule_wins_when_priority_is_equal(self):
        family = CableFamily.objects.create(code="TST-TIE-FAM", name="Família de teste", medium="FIBER")
        template = TaskTemplate.objects.create(code="TST-TIE-TPL", name="Template de teste", category="TEST_CATEGORY")
        TaskTemplateRule.objects.create(
            code="TST-TIE-LOW-SCORE", name="Score baixo", task_template=template, cable_family=family, priority=10
        )
        TaskTemplateRule.objects.create(
            code="TST-TIE-HIGH-SCORE",
            name="Score alto",
            task_template=template,
            cable_family=family,
            medium="FIBER",
            priority=10,
        )
        response = self.simulate({"cable_family": family.pk, "medium": "FIBER"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "TST-TIE-HIGH-SCORE")

    def test_lower_priority_wins_over_higher_specificity(self):
        family = CableFamily.objects.create(code="TST-PRIO-FAM", name="Família de teste", medium="FIBER")
        network = Network.objects.create(code="TST-PRIO-NET", name="Rede de teste", domain="MANAGEMENT", medium="FIBER")
        template = TaskTemplate.objects.create(code="TST-PRIO-TPL", name="Template de teste", category="TEST_CATEGORY")
        TaskTemplateRule.objects.create(
            code="TST-PRIO-LOW-PRIORITY-LOW-SCORE",
            name="Prioridade baixa (número), score baixo",
            task_template=template,
            cable_family=family,
            priority=5,
        )
        TaskTemplateRule.objects.create(
            code="TST-PRIO-HIGH-PRIORITY-HIGH-SCORE",
            name="Prioridade alta (número), score alto",
            task_template=template,
            cable_family=family,
            network=network,
            medium="FIBER",
            priority=10,
        )
        response = self.simulate({"cable_family": family.pk, "network": network.pk, "medium": "FIBER"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_rule"]["code"], "TST-PRIO-LOW-PRIORITY-LOW-SCORE")

    def test_cable_spec_derives_cable_family(self):
        spec = CableSpec.objects.get(code="SPEC-72F-MPOB-0072X6P64")
        response = self.simulate({"cable_spec": spec.pk})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["derived_fields"]["cable_family"]["value"], "FIB-72F-MPOB")
        self.assertEqual(response.data["derived_fields"]["cable_family"]["source"], "cable_spec")
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-72F-MPOB")

    def test_incompatible_cable_spec_and_cable_family_returns_error(self):
        spec = CableSpec.objects.get(code="SPEC-72F-MPOB-0072X6P64")
        other_family = CableFamily.objects.get(code="FIB-8F-LCLC")
        response = self.simulate({"cable_spec": spec.pk, "cable_family": other_family.pk})
        self.assertEqual(response.status_code, 400)

    def test_no_match_returns_empty_controlled_result(self):
        response = self.simulate({"medium": "MIXED"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["matches"], [])
        self.assertIsNone(response.data["selected_rule"])
        self.assertIsNone(response.data["selected_template"])
        self.assertEqual(response.data["steps"], [])

    def test_only_active_rules_are_considered(self):
        # medium="" (não FIBER/COPPER) de propósito: evita que o medium seja
        # derivado da família e o fallback genérico (RULE-FIBER-GENERIC)
        # acabe casando por outro caminho, o que mascararia o teste.
        family = CableFamily.objects.create(code="TST-INACTIVE-FAM", name="Família de teste", medium="")
        template = TaskTemplate.objects.create(code="TST-INACTIVE-TPL", name="Template de teste", category="TEST_CATEGORY")
        TaskTemplateRule.objects.create(
            code="TST-INACTIVE-RULE",
            name="Regra inativa",
            task_template=template,
            cable_family=family,
            priority=1,
            active=False,
        )
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        codes = [m["rule"]["code"] for m in response.data["matches"]]
        self.assertNotIn("TST-INACTIVE-RULE", codes)
        self.assertEqual(response.data["matches"], [])

    def test_at_least_one_criterion_required(self):
        response = self.simulate({})
        self.assertEqual(response.status_code, 400)

    def test_match_explanation_included_for_each_compatible_rule(self):
        family = CableFamily.objects.get(code="FIB-72F-MPOB")
        response = self.simulate({"cable_family": family.pk})
        self.assertEqual(response.status_code, 200, response.data)
        selected_match = response.data["matches"][0]
        criteria_names = {check["criterion"] for check in selected_match["checks"]}
        self.assertEqual(criteria_names, {"cable_family", "cable_spec", "network", "workstream", "medium", "preterminated"})
        family_check = next(c for c in selected_match["checks"] if c["criterion"] == "cable_family")
        self.assertEqual(family_check["result"], "MATCH")


class ScopeItemApiTests(TestCase):
    """Planejamento > Itens de Escopo — CRUD, derivações (normalizer),
    resolução via Rule Resolver (resolve-template/resolve-all), busca,
    filtros, ativação/inativação, CSV e os 3 seeds de teste (0032_seed_
    scope_items) que exercitam o fluxo completo até TaskTemplateStep."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="scope_item_admin", email="scope_item@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Prefixo "TST-" pelo mesmo motivo das outras entidades de
        # Cadastros Mestres: o seed real (0032_seed_scope_items) roda
        # também no banco de testes (3 itens).
        self.family = CableFamily.objects.create(code="TST-SI-FAM", name="Família de teste", medium="FIBER")
        self.other_family = CableFamily.objects.create(code="TST-SI-FAM-OTHER", name="Outra família", medium="FIBER")
        self.spec = CableSpec.objects.create(code="TST-SI-SPEC", name="Spec de teste", cable_family=self.family)
        self.other_family_spec = CableSpec.objects.create(
            code="TST-SI-SPEC-OTHER", name="Spec de outra família", cable_family=self.other_family
        )
        self.template = TaskTemplate.objects.create(code="TST-SI-TPL", name="Template de teste", category="TEST_CATEGORY")
        self.rule = TaskTemplateRule.objects.create(
            code="TST-SI-RULE", name="Regra de teste", task_template=self.template, cable_family=self.family, priority=10
        )

    def test_raw_text_is_required(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/", {"item_type": "CABLE"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("raw_text", response.data)

    def test_item_type_is_required(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/", {"raw_text": "algum texto"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("item_type", response.data)

    def test_quantity_must_be_positive(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "quantity": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("quantity", response.data)

    def test_quantity_defaults_to_one(self):
        item = ScopeItem.objects.create(raw_text="texto", item_type="CABLE")
        self.assertEqual(item.quantity, 1)

    def test_length_m_must_be_non_negative(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "length_m": "-5"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("length_m", response.data)

    def test_confidence_score_must_be_between_zero_and_one(self):
        too_high = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "confidence_score": "1.50"},
            format="json",
        )
        self.assertEqual(too_high.status_code, 400)
        self.assertIn("confidence_score", too_high.data)

        too_low = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "confidence_score": "-0.10"},
            format="json",
        )
        self.assertEqual(too_low.status_code, 400)
        self.assertIn("confidence_score", too_low.data)

        valid = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "confidence_score": "0.97"},
            format="json",
        )
        self.assertEqual(valid.status_code, 201, valid.data)

    def test_code_is_auto_generated_and_unique(self):
        first = ScopeItem.objects.create(raw_text="texto 1", item_type="CABLE")
        second = ScopeItem.objects.create(raw_text="texto 2", item_type="CABLE")
        self.assertTrue(first.code.startswith("SCOPE-ITEM-"))
        self.assertNotEqual(first.code, second.code)

    def test_spec_compatible_with_family_is_accepted(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {
                "raw_text": "texto",
                "item_type": "CABLE",
                "cable_family": self.family.pk,
                "cable_spec": self.spec.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)

    def test_spec_incompatible_with_family_is_rejected(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {
                "raw_text": "texto",
                "item_type": "CABLE",
                "cable_family": self.family.pk,
                "cable_spec": self.other_family_spec.pk,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("cable_spec", response.data)

    def test_cable_family_derived_from_cable_spec(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "cable_spec": self.spec.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        item = ScopeItem.objects.get(pk=response.data["id"])
        self.assertEqual(item.cable_family_id, self.family.pk)
        self.assertEqual(item.normalization_metadata.get("cable_family"), {"source": "cable_spec", "derived": True})

    def test_medium_derived_from_cable_family(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "cable_family": self.family.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        item = ScopeItem.objects.get(pk=response.data["id"])
        self.assertEqual(item.medium, "FIBER")
        self.assertEqual(item.normalization_metadata.get("medium"), {"source": "cable_family", "derived": True})

    def test_medium_not_derived_when_already_informed(self):
        response = self.client_api.post(
            "/api/master-data/scope-items/",
            {"raw_text": "texto", "item_type": "CABLE", "cable_family": self.family.pk, "medium": "MIXED"},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        item = ScopeItem.objects.get(pk=response.data["id"])
        self.assertEqual(item.medium, "MIXED")
        self.assertNotIn("medium", item.normalization_metadata)

    def test_cable_family_foreign_key_is_protected(self):
        ScopeItem.objects.create(raw_text="texto", item_type="CABLE", cable_family=self.family)
        with self.assertRaises(ProtectedError):
            self.family.delete()

    def test_resolve_template_sets_resolved_and_status(self):
        item = ScopeItem.objects.create(raw_text="texto", item_type="CABLE", cable_family=self.family)
        response = self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rule_resolution_status"], "RESOLVED")
        self.assertEqual(response.data["selected_rule"]["code"], "TST-SI-RULE")
        self.assertEqual(response.data["selected_template"]["code"], "TST-SI-TPL")
        item.refresh_from_db()
        self.assertEqual(item.resolved_rule_id, self.rule.pk)
        self.assertEqual(item.resolved_template_id, self.template.pk)
        self.assertEqual(item.rule_resolution_status, "RESOLVED")

    def test_resolve_template_no_match(self):
        item = ScopeItem.objects.create(raw_text="texto", item_type="CABLE", medium="MIXED")
        response = self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rule_resolution_status"], "NO_MATCH")
        self.assertIsNone(response.data["selected_rule"])
        self.assertIsNone(response.data["selected_template"])
        item.refresh_from_db()
        self.assertIsNone(item.resolved_rule)
        self.assertIsNone(item.resolved_template)
        self.assertEqual(item.rule_resolution_status, "NO_MATCH")

    def test_resolve_all_resolves_pending_active_items(self):
        ScopeItem.objects.create(raw_text="texto 1", item_type="CABLE", cable_family=self.family)
        ScopeItem.objects.create(raw_text="texto 2", item_type="CABLE", medium="MIXED")
        ScopeItem.objects.create(raw_text="texto 3", item_type="CABLE", cable_family=self.family, active=False)

        response = self.client_api.post("/api/master-data/scope-items/resolve-all/")

        self.assertEqual(response.status_code, 200, response.data)
        # +3 pelo seed real (0032_seed_scope_items), que também roda no
        # banco de testes e começa NOT_RESOLVED (os 3 itens seedados têm
        # cable_family/medium que casam com regras reais, então resolvem).
        self.assertEqual(response.data["resolved"], 1 + 3)
        self.assertEqual(response.data["no_match"], 1)
        self.assertEqual(response.data["total"], 2 + 3)

    def test_deactivate_does_not_hard_delete(self):
        item = ScopeItem.objects.create(raw_text="texto", item_type="CABLE", active=True)
        response = self.client_api.patch(f"/api/master-data/scope-items/{item.pk}/", {"active": False}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(ScopeItem.objects.filter(pk=item.pk).exists())
        item.refresh_from_db()
        self.assertFalse(item.active)

    def test_search_by_raw_text(self):
        ScopeItem.objects.create(raw_text="texto muito específico de busca", item_type="CABLE")
        response = self.client_api.get("/api/master-data/scope-items/", {"search": "muito específico"})
        self.assertEqual(response.data["count"], 1)

    def test_filter_by_item_type(self):
        ScopeItem.objects.create(raw_text="texto cabo", item_type="CABLE")
        ScopeItem.objects.create(raw_text="texto hardware", item_type="HARDWARE")
        response = self.client_api.get("/api/master-data/scope-items/", {"item_type": "HARDWARE"})
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["item_type"], "HARDWARE")

    def test_filter_by_cable_family(self):
        ScopeItem.objects.create(raw_text="texto 1", item_type="CABLE", cable_family=self.family)
        ScopeItem.objects.create(raw_text="texto 2", item_type="CABLE", cable_family=self.other_family)
        response = self.client_api.get("/api/master-data/scope-items/", {"cable_family": self.family.pk})
        self.assertEqual(response.data["count"], 1)

    def test_filter_by_rule_resolution_status(self):
        item = ScopeItem.objects.create(raw_text="texto", item_type="CABLE", cable_family=self.family)
        self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        response = self.client_api.get("/api/master-data/scope-items/", {"rule_resolution_status": "RESOLVED"})
        self.assertEqual(response.data["count"], 1)
        self.assertEqual(response.data["results"][0]["code"], item.code)

    def test_export_csv(self):
        ScopeItem.objects.create(raw_text="texto exportável TST-SI-EXPORT", item_type="CABLE")
        response = self.client_api.get("/api/master-data/scope-items/export-csv/")
        self.assertEqual(response.status_code, 200)
        content = response.content.decode("utf-8-sig")
        self.assertIn("TST-SI-EXPORT", content)

    def test_import_csv_creates_item_with_auto_generated_code(self):
        # "quantidade" incluída explicitamente: o importador genérico
        # (core.csv_io) monta o objeto a partir de TODAS as colunas de
        # get_csv_fields(), então uma coluna numérica ausente vira None
        # (não o default do model) — quantity é NOT NULL, então
        # full_clean() rejeitaria None se a coluna fosse omitida.
        csv_content = "tipo;texto original;quantidade\nCABLE;TST-SI-IMPORTED raw text;3\n"
        upload = SimpleUploadedFile("scope_items.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post("/api/master-data/scope-items/import-csv/", {"csv_file": upload}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["errors"], [])
        imported = ScopeItem.objects.get(raw_text__icontains="TST-SI-IMPORTED")
        self.assertTrue(imported.code.startswith("SCOPE-ITEM-"))
        self.assertEqual(imported.quantity, 3)

    # --- Seeds (0032_seed_scope_items) e critérios de aceite ---

    def test_seed_scope_items_have_expected_fields(self):
        item1 = ScopeItem.objects.get(code="SCOPE-ITEM-000001")
        self.assertEqual(item1.cable_family.code, "FIB-72F-MPOB")
        self.assertEqual(item1.cable_spec.code, "SPEC-72F-MPOB-0072X6P64")
        self.assertEqual(item1.quantity, 2)
        self.assertEqual(item1.length_m, 50)
        self.assertEqual(item1.medium, "FIBER")

        item2 = ScopeItem.objects.get(code="SCOPE-ITEM-000002")
        self.assertEqual(item2.cable_family.code, "COP-CAT6")
        self.assertEqual(item2.quantity, 10)
        self.assertEqual(item2.length_m, 60)
        self.assertFalse(item2.preterminated)

        item3 = ScopeItem.objects.get(code="SCOPE-ITEM-000003")
        self.assertEqual(item3.cable_family.code, "FIB-2F-ROBUST")
        self.assertEqual(item3.quantity, 4)

    def test_resolve_seed_item_fiber_mpo(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000001")
        response = self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rule_resolution_status"], "RESOLVED")
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-72F-MPOB")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-MPO")
        self.assertEqual(len(response.data["steps"]), 9)

    def test_resolve_seed_item_cat6_field(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000002")
        response = self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rule_resolution_status"], "RESOLVED")
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-CAT6-FIELD")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-COPPER-FIELD-TERMINATED")
        self.assertEqual(len(response.data["steps"]), 12)

    def test_resolve_seed_item_robust(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000003")
        response = self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["rule_resolution_status"], "RESOLVED")
        self.assertEqual(response.data["selected_rule"]["code"], "RULE-FIB-2F-ROBUST")
        self.assertEqual(response.data["selected_template"]["code"], "TPL-FIBER-ROBUST")

    def test_seed_is_idempotent(self):
        import importlib

        from django.apps import apps as django_apps

        module = importlib.import_module("master_data.migrations.0032_seed_scope_items")
        count_before = ScopeItem.objects.count()
        module.seed_scope_items(django_apps, None)
        module.seed_scope_items(django_apps, None)
        self.assertEqual(ScopeItem.objects.count(), count_before)


class GeneratedTaskApiTests(TestCase):
    """Planejamento > Tarefas Geradas — master_data.services.task_generator
    (ScopeItem RESOLVED -> TaskTemplateSteps ativos -> GeneratedTask),
    regra de quantidade/unit, snapshot, idempotência, FK PROTECT, busca,
    filtros, criação manual bloqueada, e os 3 templates reais (Fiber
    MPO=9, Copper Field=12, Fiber Robust=9) com as quantidades exatas do
    critério de aceite."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="generated_task_admin", email="generated_task@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

        self.family = CableFamily.objects.create(code="TST-GT-FAM", name="Família de teste", medium="FIBER")
        self.template = TaskTemplate.objects.create(code="TST-GT-TPL", name="Template de teste", category="TEST_CATEGORY")
        self.rule = TaskTemplateRule.objects.create(
            code="TST-GT-RULE", name="Regra de teste", task_template=self.template, cable_family=self.family, priority=10
        )

        # Atividades/steps com quantity_source e unit variados, para
        # testar cada regra de cálculo isoladamente.
        self.act_scope_item = Activity.objects.create(code="TST-GT-ACT-SCOPE", name="Atividade scope_item", category="TEST_CATEGORY")
        self.act_cable_count = Activity.objects.create(
            code="TST-GT-ACT-CABLE", name="Atividade cable_count", category="TEST_CATEGORY", default_unit="ACTIVITY_UNIT"
        )
        self.act_link_count = Activity.objects.create(
            code="TST-GT-ACT-LINK", name="Atividade link_count", category="TEST_CATEGORY", default_unit="LINK_UNIT"
        )
        self.act_conn_count = Activity.objects.create(code="TST-GT-ACT-CONN", name="Atividade connection_count", category="TEST_CATEGORY")
        self.act_meterage = Activity.objects.create(code="TST-GT-ACT-METER", name="Atividade meterage", category="TEST_CATEGORY")
        self.act_project = Activity.objects.create(code="TST-GT-ACT-PROJECT", name="Atividade project", category="TEST_CATEGORY")
        self.act_manual = Activity.objects.create(code="TST-GT-ACT-MANUAL", name="Atividade manual", category="TEST_CATEGORY")
        self.act_unknown = Activity.objects.create(code="TST-GT-ACT-UNKNOWN", name="Atividade unknown source", category="TEST_CATEGORY")
        self.act_inactive_step = Activity.objects.create(code="TST-GT-ACT-INACTIVE", name="Atividade de step inativo", category="TEST_CATEGORY")

        self.step_scope_item = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_scope_item, step_order=10, quantity_source="SCOPE_ITEM"
        )
        self.step_cable_count = TaskTemplateStep.objects.create(
            task_template=self.template,
            activity=self.act_cable_count,
            step_order=20,
            quantity_source="CABLE_COUNT",
            unit_override="OVERRIDE_UNIT",
        )
        self.step_link_count = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_link_count, step_order=30, quantity_source="LINK_COUNT"
        )
        self.step_conn_count = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_conn_count, step_order=40, quantity_source="CONNECTION_COUNT"
        )
        self.step_meterage = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_meterage, step_order=50, quantity_source="METERAGE"
        )
        self.step_project = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_project, step_order=60, quantity_source="PROJECT"
        )
        self.step_manual = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_manual, step_order=70, quantity_source="MANUAL"
        )
        self.step_unknown = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_unknown, step_order=80, quantity_source="WEIRD_SOURCE"
        )
        self.step_inactive = TaskTemplateStep.objects.create(
            task_template=self.template,
            activity=self.act_inactive_step,
            step_order=90,
            quantity_source="SCOPE_ITEM",
            active=False,
        )

        self.scope_item = ScopeItem.objects.create(
            raw_text="texto de teste",
            item_type="CABLE",
            cable_family=self.family,
            quantity=5,
            unit="SCOPE_UNIT",
            length_m=Decimal("42.50"),
        )
        self.scope_item.resolved_rule = self.rule
        self.scope_item.resolved_template = self.template
        self.scope_item.rule_resolution_status = "RESOLVED"
        self.scope_item.save()

    def generate(self, item_pk=None):
        return self.client_api.post(f"/api/master-data/scope-items/{item_pk or self.scope_item.pk}/generate-tasks/")

    def test_generate_tasks_requires_resolved_status(self):
        unresolved = ScopeItem.objects.create(raw_text="não resolvido", item_type="CABLE")
        response = self.generate(unresolved.pk)
        self.assertEqual(response.status_code, 400)

    def test_generate_tasks_requires_resolved_template(self):
        item = ScopeItem.objects.create(raw_text="status inconsistente", item_type="CABLE")
        item.rule_resolution_status = "RESOLVED"
        item.save()
        response = self.generate(item.pk)
        self.assertEqual(response.status_code, 400)

    def test_generate_tasks_only_active_steps(self):
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 8)
        activity_codes = [t["activity_code"] for t in response.data["tasks"]]
        self.assertNotIn("TST-GT-ACT-INACTIVE", activity_codes)

    def test_generate_tasks_correct_order(self):
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        orders = [t["step_order"] for t in response.data["tasks"]]
        self.assertEqual(orders, [10, 20, 30, 40, 50, 60, 70, 80])

    def test_quantity_scope_item_cable_link_connection_count(self):
        self.generate()
        for code in ("TST-GT-ACT-SCOPE", "TST-GT-ACT-CABLE", "TST-GT-ACT-LINK", "TST-GT-ACT-CONN"):
            task = GeneratedTask.objects.get(scope_item=self.scope_item, activity__code=code)
            self.assertEqual(task.quantity, Decimal("5"), code)

    def test_quantity_meterage(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_meterage)
        self.assertEqual(task.quantity, Decimal("42.50"))

    def test_quantity_project(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_project)
        self.assertEqual(task.quantity, Decimal("1"))

    def test_quantity_manual_is_null(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_manual)
        self.assertIsNone(task.quantity)

    def test_unrecognized_quantity_source_is_null_with_warning(self):
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_unknown)
        self.assertIsNone(task.quantity)
        self.assertTrue(any("WEIRD_SOURCE" in w for w in response.data["warnings"]))

    def test_unit_resolution_priority(self):
        self.generate()
        override_task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_cable_count)
        self.assertEqual(override_task.unit, "OVERRIDE_UNIT")
        activity_default_task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_link_count)
        self.assertEqual(activity_default_task.unit, "LINK_UNIT")
        scope_fallback_task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_scope_item)
        self.assertEqual(scope_fallback_task.unit, "SCOPE_UNIT")

    def test_snapshot_name_and_step_order(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_scope_item)
        self.assertEqual(task.name, self.step_scope_item.effective_name)
        self.assertEqual(task.step_order, 10)

    def test_required_and_repeatable_snapshot(self):
        activity = Activity.objects.create(code="TST-GT-ACT-REQREP", name="Atividade req/rep", category="TEST_CATEGORY")
        step = TaskTemplateStep.objects.create(
            task_template=self.template,
            activity=activity,
            step_order=15,
            required=False,
            repeatable=True,
            quantity_source="SCOPE_ITEM",
        )
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=step)
        self.assertFalse(task.required)
        self.assertTrue(task.repeatable)

    def test_status_and_generation_source_defaults(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_scope_item)
        self.assertEqual(task.status, "PENDING")
        self.assertEqual(task.generation_source, "TEMPLATE")

    def test_idempotent_second_generation_creates_nothing_new(self):
        first = self.generate()
        self.assertEqual(first.data["created_count"], 8)
        self.assertEqual(first.data["existing_count"], 0)
        second = self.generate()
        self.assertEqual(second.data["created_count"], 0)
        self.assertEqual(second.data["existing_count"], 8)
        self.assertEqual(GeneratedTask.objects.filter(scope_item=self.scope_item).count(), 8)

    def test_unique_constraint_scope_item_and_template_step(self):
        self.generate()
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GeneratedTask.objects.create(
                    scope_item=self.scope_item,
                    task_template=self.template,
                    task_template_step=self.step_scope_item,
                    activity=self.act_scope_item,
                    step_order=10,
                    name="Duplicada",
                )

    def test_scope_item_foreign_key_is_protected(self):
        self.generate()
        with self.assertRaises(ProtectedError):
            self.scope_item.delete()

    def test_activity_foreign_key_is_protected(self):
        self.generate()
        with self.assertRaises(ProtectedError):
            self.act_scope_item.delete()

    def test_manual_create_is_blocked(self):
        response = self.client_api.post(
            "/api/master-data/generated-tasks/", {"name": "Manual", "status": "PENDING"}, format="json"
        )
        self.assertEqual(response.status_code, 405)

    def test_csv_import_is_blocked(self):
        csv_content = "código;nome\nTASK-GEN-FAKE;Falsa\n"
        upload = SimpleUploadedFile("generated_tasks.csv", csv_content.encode("utf-8"), content_type="text/csv")
        response = self.client_api.post(
            "/api/master-data/generated-tasks/import-csv/", {"csv_file": upload}, format="multipart"
        )
        self.assertEqual(response.status_code, 405)

    def test_update_allows_editable_fields_only(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, activity=self.act_scope_item)
        response = self.client_api.patch(
            f"/api/master-data/generated-tasks/{task.pk}/", {"status": "READY", "quantity": "9.00"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        task.refresh_from_db()
        self.assertEqual(task.status, "READY")
        self.assertEqual(task.quantity, Decimal("9.00"))

    def test_search_by_scope_item_code(self):
        self.generate()
        response = self.client_api.get("/api/master-data/generated-tasks/", {"search": self.scope_item.code})
        self.assertEqual(response.data["count"], 8)

    def test_filter_by_scope_item(self):
        self.generate()
        response = self.client_api.get("/api/master-data/generated-tasks/", {"scope_item": self.scope_item.pk})
        self.assertEqual(response.data["count"], 8)

    def test_filter_by_status(self):
        self.generate()
        response = self.client_api.get("/api/master-data/generated-tasks/", {"status": "PENDING"})
        self.assertGreaterEqual(response.data["count"], 8)

    # --- Os 3 templates reais (seed 0032) ---

    def test_fiber_mpo_generates_nine_tasks_matching_example(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000001")
        self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        response = self.generate(item.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 9)
        self.assertEqual(response.data["resolved_template_code"], "TPL-FIBER-MPO")
        quantities = {
            t.activity.code: t.quantity for t in GeneratedTask.objects.filter(scope_item=item).select_related("activity")
        }
        self.assertEqual(quantities["MAT-SEP"], Decimal("2"))
        self.assertEqual(quantities["MAT-CHECK"], Decimal("2"))
        self.assertEqual(quantities["CAB-LABEL"], Decimal("2"))
        self.assertEqual(quantities["CAB-RUN"], Decimal("2"))
        self.assertEqual(quantities["CAB-DRESS"], Decimal("2"))
        self.assertEqual(quantities["CAB-PATCH"], Decimal("2"))
        self.assertEqual(quantities["CERTIFY"], Decimal("2"))
        self.assertEqual(quantities["QAQC"], Decimal("1"))
        self.assertEqual(quantities["EVIDENCE"], Decimal("1"))

    def test_copper_field_generates_twelve_tasks_matching_example(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000002")
        self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        response = self.generate(item.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 12)
        quantities = {
            t.activity.code: t.quantity for t in GeneratedTask.objects.filter(scope_item=item).select_related("activity")
        }
        self.assertEqual(quantities["CAB-MEASURE"], Decimal("10"))
        self.assertEqual(quantities["CAB-CUT"], Decimal("10"))
        self.assertEqual(quantities["CAB-CRIMP"], Decimal("10"))
        self.assertEqual(quantities["CERTIFY"], Decimal("10"))
        self.assertEqual(quantities["QAQC"], Decimal("1"))
        self.assertEqual(quantities["EVIDENCE"], Decimal("1"))

    def test_robust_generates_nine_tasks(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000003")
        self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        response = self.generate(item.pk)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 9)

    def test_second_generation_on_seed_item_has_zero_created(self):
        item = ScopeItem.objects.get(code="SCOPE-ITEM-000001")
        self.client_api.post(f"/api/master-data/scope-items/{item.pk}/resolve-template/")
        self.generate(item.pk)
        second = self.generate(item.pk)
        self.assertEqual(second.data["created_count"], 0)
        self.assertEqual(second.data["existing_count"], 9)


class PathExpansionAndDependencyTests(TestCase):
    """Expansão de GeneratedTask por Path (ScopeItem.expansion_mode=PATH +
    ScopeItemPath) e geração automática de GeneratedTaskDependency
    (master_data.services.task_dependency_generator) a partir da ordem dos
    TaskTemplateSteps. Fixture dedicado: A (não repetível) -> B (repetível)
    -> D (repetível) -> C (não repetível) cobre, num só template, os 4
    casos de conexão entre steps adjacentes (não-expandido -> não-
    expandido; não-expandido -> expandido; expandido -> expandido — só
    pela mesma expansion_key; expandido -> não-expandido)."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="path_expansion_admin", email="path_expansion@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

        self.family = CableFamily.objects.create(code="TST-PE-FAM", name="Família de teste", medium="FIBER")
        self.template = TaskTemplate.objects.create(code="TST-PE-TPL", name="Template de teste", category="TEST_CATEGORY")
        self.rule = TaskTemplateRule.objects.create(
            code="TST-PE-RULE", name="Regra de teste", task_template=self.template, cable_family=self.family, priority=10
        )

        self.act_a = Activity.objects.create(code="TST-PE-ACT-A", name="Atividade A", category="TEST_CATEGORY")
        self.act_b = Activity.objects.create(code="TST-PE-ACT-B", name="Atividade B", category="TEST_CATEGORY")
        self.act_d = Activity.objects.create(code="TST-PE-ACT-D", name="Atividade D", category="TEST_CATEGORY")
        self.act_c = Activity.objects.create(code="TST-PE-ACT-C", name="Atividade C", category="TEST_CATEGORY")

        self.step_a = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_a, step_order=10, quantity_source="SCOPE_ITEM", repeatable=False
        )
        self.step_b = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_b, step_order=20, quantity_source="SCOPE_ITEM", repeatable=True
        )
        self.step_d = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_d, step_order=30, quantity_source="SCOPE_ITEM", repeatable=True
        )
        self.step_c = TaskTemplateStep.objects.create(
            task_template=self.template, activity=self.act_c, step_order=40, quantity_source="SCOPE_ITEM", repeatable=False
        )

        self.path_a = Path.objects.create(code="TST-PE-PATH-A", name="Path A de teste", path_group="TEST", path_type="TEST")
        self.path_b = Path.objects.create(code="TST-PE-PATH-B", name="Path B de teste", path_group="TEST", path_type="TEST")
        self.path_c = Path.objects.create(code="TST-PE-PATH-C", name="Path C de teste", path_group="TEST", path_type="TEST")

        self.scope_item = ScopeItem.objects.create(
            raw_text="texto de teste", item_type="CABLE", cable_family=self.family, quantity=16
        )
        self.scope_item.resolved_rule = self.rule
        self.scope_item.resolved_template = self.template
        self.scope_item.rule_resolution_status = "RESOLVED"
        self.scope_item.save()

    def generate(self, item_pk=None):
        return self.client_api.post(f"/api/master-data/scope-items/{item_pk or self.scope_item.pk}/generate-tasks/")

    def add_paths(self, *paths):
        for i, path in enumerate(paths):
            ScopeItemPath.objects.create(scope_item=self.scope_item, path=path, sequence=i)

    # --- expansion_mode / quantidade de paths ---

    def test_expansion_mode_none_generates_single_task_per_step(self):
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 4)
        for t in response.data["tasks"]:
            self.assertEqual(t["expansion_key"], "DEFAULT")
            self.assertIsNone(t["path_code"])

    def test_expansion_mode_path_without_active_paths_falls_back_to_default(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["created_count"], 4)
        self.assertTrue(any("Rota/Path ativa" in w for w in response.data["warnings"]))

    def test_expansion_mode_path_two_paths(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b)
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        # A(1) + B(2) + D(2) + C(1) = 6
        self.assertEqual(response.data["created_count"], 6)

        b_tasks = GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_b).order_by("expansion_key")
        self.assertEqual(b_tasks.count(), 2)
        self.assertEqual([t.expansion_key for t in b_tasks], ["TST-PE-PATH-A", "TST-PE-PATH-B"])
        self.assertEqual(b_tasks[0].path_id, self.path_a.pk)
        self.assertEqual(b_tasks[0].name, f"{self.step_b.effective_name} — {self.path_a.name}")

        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        self.assertEqual(a_task.expansion_key, "DEFAULT")
        self.assertIsNone(a_task.path_id)

    def test_expansion_mode_path_three_paths(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b, self.path_c)
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        # A(1) + B(3) + D(3) + C(1) = 8
        self.assertEqual(response.data["created_count"], 8)
        self.assertEqual(
            GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_b).count(), 3
        )

    def test_non_repeatable_step_never_expands(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b)
        self.generate()
        self.assertEqual(
            GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_a).count(), 1
        )
        self.assertEqual(
            GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_c).count(), 1
        )

    def test_new_unique_constraint_allows_same_step_different_expansion_key(self):
        GeneratedTask.objects.create(
            scope_item=self.scope_item,
            task_template=self.template,
            task_template_step=self.step_b,
            activity=self.act_b,
            path=self.path_a,
            expansion_key=self.path_a.code,
            step_order=20,
            name="B - Path A",
        )
        GeneratedTask.objects.create(
            scope_item=self.scope_item,
            task_template=self.template,
            task_template_step=self.step_b,
            activity=self.act_b,
            path=self.path_b,
            expansion_key=self.path_b.code,
            step_order=20,
            name="B - Path B",
        )
        self.assertEqual(
            GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_b).count(), 2
        )

    def test_new_unique_constraint_rejects_same_expansion_key_twice(self):
        GeneratedTask.objects.create(
            scope_item=self.scope_item,
            task_template=self.template,
            task_template_step=self.step_b,
            activity=self.act_b,
            expansion_key="DEFAULT",
            step_order=20,
            name="B",
        )
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GeneratedTask.objects.create(
                    scope_item=self.scope_item,
                    task_template=self.template,
                    task_template_step=self.step_b,
                    activity=self.act_b,
                    expansion_key="DEFAULT",
                    step_order=20,
                    name="B duplicada",
                )

    def test_idempotent_generation_with_paths(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b)
        first = self.generate()
        self.assertEqual(first.data["created_count"], 6)
        second = self.generate()
        self.assertEqual(second.data["created_count"], 0)
        self.assertEqual(second.data["existing_count"], 6)
        self.assertEqual(GeneratedTask.objects.filter(scope_item=self.scope_item).count(), 6)

    # --- dependências ---

    def test_dependency_generation_all_four_cases(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b)
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)

        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        b_tasks = {t.expansion_key: t for t in GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_b)}
        d_tasks = {t.expansion_key: t for t in GeneratedTask.objects.filter(scope_item=self.scope_item, task_template_step=self.step_d)}
        c_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_c)

        deps = set(
            GeneratedTaskDependency.objects.filter(predecessor_task__scope_item=self.scope_item).values_list(
                "predecessor_task_id", "successor_task_id"
            )
        )

        # Caso 2: não-expandido -> expandido (A conecta com AMBOS os B).
        self.assertIn((a_task.pk, b_tasks["TST-PE-PATH-A"].pk), deps)
        self.assertIn((a_task.pk, b_tasks["TST-PE-PATH-B"].pk), deps)

        # Caso 3: expandido -> expandido, só pela MESMA expansion_key.
        self.assertIn((b_tasks["TST-PE-PATH-A"].pk, d_tasks["TST-PE-PATH-A"].pk), deps)
        self.assertIn((b_tasks["TST-PE-PATH-B"].pk, d_tasks["TST-PE-PATH-B"].pk), deps)
        self.assertNotIn((b_tasks["TST-PE-PATH-A"].pk, d_tasks["TST-PE-PATH-B"].pk), deps)
        self.assertNotIn((b_tasks["TST-PE-PATH-B"].pk, d_tasks["TST-PE-PATH-A"].pk), deps)

        # Caso 4: expandido -> não-expandido (AMBOS os D conectam com C).
        self.assertIn((d_tasks["TST-PE-PATH-A"].pk, c_task.pk), deps)
        self.assertIn((d_tasks["TST-PE-PATH-B"].pk, c_task.pk), deps)

        # Total: A->B(2) + B->D(2) + D->C(2) = 6.
        self.assertEqual(len(deps), 6)

    def test_dependency_generation_unexpanded_to_unexpanded(self):
        # Caso 1, isolado: expansion_mode=NONE -> tudo 1x1.
        response = self.generate()
        self.assertEqual(response.status_code, 200, response.data)
        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        b_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_b)
        self.assertTrue(
            GeneratedTaskDependency.objects.filter(predecessor_task=a_task, successor_task=b_task).exists()
        )

    def test_dependency_idempotent_second_generation(self):
        self.scope_item.expansion_mode = "PATH"
        self.scope_item.save()
        self.add_paths(self.path_a, self.path_b)
        first = self.generate()
        self.assertEqual(len(first.data["created_dependencies"]), 6)
        self.assertEqual(len(first.data["existing_dependencies"]), 0)
        second = self.generate()
        self.assertEqual(len(second.data["created_dependencies"]), 0)
        self.assertEqual(len(second.data["existing_dependencies"]), 6)
        self.assertEqual(GeneratedTaskDependency.objects.filter(predecessor_task__scope_item=self.scope_item).count(), 6)

    def test_self_dependency_blocked(self):
        self.generate()
        task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        dependency = GeneratedTaskDependency(predecessor_task=task, successor_task=task, dependency_type="FS")
        with self.assertRaises(DjangoValidationError):
            dependency.clean()

    def test_duplicate_dependency_blocked(self):
        self.generate()
        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        b_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_b)
        GeneratedTaskDependency.objects.filter(predecessor_task=a_task, successor_task=b_task).delete()
        GeneratedTaskDependency.objects.create(predecessor_task=a_task, successor_task=b_task, dependency_type="FS")
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                GeneratedTaskDependency.objects.create(
                    predecessor_task=a_task, successor_task=b_task, dependency_type="FS"
                )

    def test_cycle_detection_blocks_reverse_dependency(self):
        self.generate()
        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        b_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_b)
        # A -> B já existe (gerada automaticamente); B -> A fecharia um ciclo.
        self.assertTrue(
            GeneratedTaskDependency.objects.filter(predecessor_task=a_task, successor_task=b_task).exists()
        )
        reverse_dependency = GeneratedTaskDependency(predecessor_task=b_task, successor_task=a_task, dependency_type="FS")
        with self.assertRaises(DjangoValidationError):
            reverse_dependency.clean()

    def test_cycle_detection_blocks_transitive_cycle(self):
        self.generate()
        a_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_a)
        d_task = GeneratedTask.objects.get(scope_item=self.scope_item, task_template_step=self.step_d)
        # A -> ... -> D já existe transitivamente (A->B->D); D -> A fecharia
        # um ciclo maior.
        cyclic_dependency = GeneratedTaskDependency(predecessor_task=d_task, successor_task=a_task, dependency_type="FS")
        with self.assertRaises(DjangoValidationError):
            cyclic_dependency.clean()

    # --- tasks_outdated ---

    def test_tasks_outdated_when_expansion_mode_changes_after_generation(self):
        self.generate()
        self.assertFalse(ScopeItem.objects.get(pk=self.scope_item.pk).tasks_outdated)
        response = self.client_api.patch(
            f"/api/master-data/scope-items/{self.scope_item.pk}/", {"expansion_mode": "PATH"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(ScopeItem.objects.get(pk=self.scope_item.pk).tasks_outdated)

    def test_tasks_outdated_not_set_before_generation(self):
        response = self.client_api.patch(
            f"/api/master-data/scope-items/{self.scope_item.pk}/", {"expansion_mode": "PATH"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(ScopeItem.objects.get(pk=self.scope_item.pk).tasks_outdated)

    def test_tasks_outdated_when_paths_change_after_generation(self):
        self.generate()
        self.assertFalse(ScopeItem.objects.get(pk=self.scope_item.pk).tasks_outdated)
        response = self.client_api.patch(
            f"/api/master-data/scope-items/{self.scope_item.pk}/",
            {"paths": [self.path_a.pk]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(ScopeItem.objects.get(pk=self.scope_item.pk).tasks_outdated)
        self.assertEqual(
            ScopeItemPath.objects.filter(scope_item=self.scope_item, path=self.path_a, active=True).count(), 1
        )

    def test_tasks_outdated_when_resolved_template_changes_via_resolve_again(self):
        self.generate()
        other_template = TaskTemplate.objects.create(
            code="TST-PE-TPL-2", name="Outro template", category="TEST_CATEGORY"
        )
        TaskTemplateRule.objects.create(
            code="TST-PE-RULE-2",
            name="Regra mais específica",
            task_template=other_template,
            cable_family=self.family,
            priority=1,
        )
        response = self.client_api.post(f"/api/master-data/scope-items/{self.scope_item.pk}/resolve-template/")
        self.assertEqual(response.status_code, 200, response.data)
        self.scope_item.refresh_from_db()
        self.assertEqual(self.scope_item.resolved_template_id, other_template.pk)
        self.assertTrue(self.scope_item.tasks_outdated)

    def test_paths_field_reflects_active_scope_item_paths(self):
        self.add_paths(self.path_a, self.path_b)
        response = self.client_api.get(f"/api/master-data/scope-items/{self.scope_item.pk}/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(set(response.data["paths"]), {self.path_a.pk, self.path_b.pk})

    # --- critério de aceite (dados reais) ---

    def test_acceptance_criteria_fiber_preterminated_two_paths_generates_fourteen_tasks(self):
        family = CableFamily.objects.get(code="FIB-8F-LCLC")
        path_a = Path.objects.get(code="PATH-A")
        path_b = Path.objects.get(code="PATH-B")

        scope_item = ScopeItem.objects.create(
            raw_text="16x 8F LC-LC", item_type="CABLE", cable_family=family, quantity=16, expansion_mode="PATH"
        )
        ScopeItemPath.objects.create(scope_item=scope_item, path=path_a, sequence=0)
        ScopeItemPath.objects.create(scope_item=scope_item, path=path_b, sequence=1)

        resolve_response = self.client_api.post(f"/api/master-data/scope-items/{scope_item.pk}/resolve-template/")
        self.assertEqual(resolve_response.status_code, 200, resolve_response.data)
        self.assertEqual(resolve_response.data["selected_template"]["code"], "TPL-FIBER-PRETERMINATED")

        first = self.generate(scope_item.pk)
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["created_count"], 14)
        self.assertEqual(first.data["existing_count"], 0)

        second = self.generate(scope_item.pk)
        self.assertEqual(second.data["created_count"], 0)
        self.assertEqual(second.data["existing_count"], 14)
        self.assertEqual(len(second.data["created_dependencies"]), 0)
        self.assertEqual(len(second.data["existing_dependencies"]), 14)

        self.assertEqual(GeneratedTask.objects.filter(scope_item=scope_item).count(), 14)


class SowImportTests(TestCase):
    """Planejamento > Importar SOW — parser determinístico + IA opcional +
    normalização contra Master Data + preview (SowParsedItem) + revisão
    humana + aprovação -> ScopeItem definitivo (NUNCA GeneratedTask, ver
    docstring de SowImport em master_data/models.py). Os testes usam os
    dados REAIS já seedados por migration (CableFamily/CableAlias/
    CableSpec/Path) — os mesmos do critério de aceite do pedido original
    — em vez de um fixture dedicado, para provar o parser contra o
    cadastro de verdade."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="sow_import_admin", email="sow_import_admin@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)
        # Estes testes exercitam o parser em modo determinístico "puro" (a
        # não ser quando mockam a IA explicitamente) — forçar AI_API_KEY
        # vazia aqui garante que a suíte nunca depende (nem gasta request
        # real) do provider de IA, mesmo que o .env real do servidor onde
        # os testes rodam tenha uma chave configurada (ver AiParserTests
        # para os testes que exercitam a integração de IA, sempre
        # mockados).
        env_patcher = patch.dict(os.environ, {"AI_API_KEY": ""})
        env_patcher.start()
        self.addCleanup(env_patcher.stop)

    def create_import(self, text, title="Teste de SOW"):
        response = self.client_api.post(
            "/api/planning/sow-imports/",
            {"title": title, "source_type": "TEXT", "source_text": text},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def process(self, sow_import_id):
        response = self.client_api.post(f"/api/planning/sow-imports/{sow_import_id}/process/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    def get_items(self, sow_import_id):
        response = self.client_api.get(f"/api/planning/sow-imports/{sow_import_id}/items/")
        self.assertEqual(response.status_code, 200, response.data)
        return response.data

    # --- TESTE 1 ---
    def test_deterministic_parser_resolves_mpo_family_via_part_number(self):
        data = self.create_import("2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_family_code"], "FIB-72F-MPOB")
        self.assertEqual(item["suggested_cable_spec_code"], "SPEC-72F-MPOB-0072X6P64")
        self.assertEqual(item["quantity"], 2)
        self.assertEqual(item["length_type"], "EXACT")
        self.assertEqual(float(item["length_m"]), 50.0)
        self.assertEqual(item["medium"], "FIBER")

    # --- TESTE 2 ---
    def test_deterministic_parser_resolves_robust_fiber_with_maximum_length(self):
        data = self.create_import("4x 2F robust fibers up to 60m")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_family_code"], "FIB-2F-ROBUST")
        self.assertEqual(item["quantity"], 4)
        self.assertEqual(item["length_type"], "MAXIMUM")
        self.assertEqual(float(item["length_m"]), 60.0)

    # --- TESTE 3 ---
    def test_deterministic_parser_resolves_cat6_utp_as_copper(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_family_code"], "COP-CAT6")
        self.assertEqual(item["quantity"], 10)
        self.assertEqual(item["length_type"], "MAXIMUM")
        self.assertEqual(float(item["length_m"]), 60.0)
        self.assertEqual(item["medium"], "COPPER")

    # --- TESTE 4 ---
    def test_deterministic_parser_resolves_path_reference(self):
        data = self.create_import("1x 18F LC-LC (45m) from A to B (Path A)")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_family_code"], "FIB-18F-LCLC")
        self.assertEqual(item["quantity"], 1)
        self.assertEqual(float(item["length_m"]), 45.0)
        self.assertEqual(item["suggested_path_codes"], ["PATH-A"])

    # --- TESTE 5 ---
    def test_part_number_alone_resolves_cable_spec_and_family(self):
        data = self.create_import("2x 0072X6P64 with 50m")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_spec_code"], "SPEC-72F-MPOB-0072X6P64")
        self.assertEqual(item["suggested_cable_family_code"], "FIB-72F-MPOB")

    # --- TESTE 6 ---
    def test_ai_invented_code_is_rejected_by_backend(self):
        with patch("master_data.services.sow_parser.service.get_ai_sow_parser") as mock_get_parser:
            mock_get_parser.return_value.parse.return_value = (
                [
                    {
                        "cable_family_code": "FIB-DOES-NOT-EXIST",
                        "quantity": 5,
                        "paths": [],
                        "warnings": [],
                        "confidence_score": 0.99,
                    }
                ],
                {"resolved_model": "mock/model", "latency_ms": 0, "retries": 0, "usage": {}},
            )
            data = self.create_import("5x algum cabo nao catalogado")
            self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertIsNone(item["suggested_cable_family"])
        self.assertTrue(any(w["code"] == "UNKNOWN_CABLE_FAMILY" for w in item["warnings"]))
        self.assertTrue(item["requires_review"])

    # --- TESTE 7 ---
    def test_parser_ai_quantity_conflict_generates_warning_and_keeps_deterministic_value(self):
        with patch("master_data.services.sow_parser.service.get_ai_sow_parser") as mock_get_parser:
            mock_get_parser.return_value.parse.return_value = (
                [{"quantity": 12, "paths": [], "warnings": [], "confidence_score": 0.9}],
                {"resolved_model": "mock/model", "latency_ms": 0, "retries": 0, "usage": {}},
            )
            data = self.create_import("10x CAT6 UTP up to 60m")
            self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["quantity"], 10)
        conflict_warnings = [w for w in item["warnings"] if w["code"] == "PARSER_AI_CONFLICT"]
        self.assertEqual(len(conflict_warnings), 1)
        self.assertEqual(conflict_warnings[0]["field"], "quantity")

    # --- TESTE 8 ---
    def test_low_confidence_item_requires_review(self):
        data = self.create_import("2x algum cabo totalmente desconhecido XYZ123")
        self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertLess(float(item["confidence_score"]), 0.80)
        self.assertTrue(item["requires_review"])
        self.assertEqual(item["confidence_band"], "LOW")

    # --- TESTE 9 ---
    def test_approving_item_creates_exactly_one_scope_item(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        before = ScopeItem.objects.count()
        response = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/approve/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(ScopeItem.objects.count(), before + 1)
        scope_item = ScopeItem.objects.get(pk=response.data["scope_item_id"])
        self.assertEqual(scope_item.cable_family.code, "COP-CAT6")
        self.assertEqual(scope_item.quantity, 10)
        self.assertEqual(scope_item.source_type, "SOW")
        self.assertEqual(scope_item.source_reference, data["code"])
        self.assertFalse(scope_item.requires_review)

    # --- TESTE 10 ---
    def test_approving_again_does_not_duplicate_scope_item(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        first = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/approve/")
        self.assertEqual(first.status_code, 200, first.data)
        before = ScopeItem.objects.count()
        second = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/approve/")
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(ScopeItem.objects.count(), before)
        self.assertEqual(first.data["scope_item_id"], second.data["scope_item_id"])

    # --- TESTE 11 ---
    def test_rejecting_item_does_not_create_scope_item(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        before = ScopeItem.objects.count()
        response = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/reject/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(ScopeItem.objects.count(), before)
        self.assertEqual(response.data["review_status"], "REJECTED")

    # --- TESTE 12 ---
    def test_finalize_blocked_with_pending_item(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        response = self.client_api.post(f"/api/planning/sow-imports/{data['id']}/finalize/")
        self.assertEqual(response.status_code, 400)

    # --- TESTE 13 ---
    def test_finalize_succeeds_when_all_items_approved_or_rejected(self):
        data = self.create_import("10x CAT6 UTP up to 60m\n4x 2F robust fibers up to 60m")
        self.process(data["id"])
        items = self.get_items(data["id"])
        self.client_api.post(f"/api/planning/sow-parsed-items/{items[0]['id']}/approve/")
        self.client_api.post(f"/api/planning/sow-parsed-items/{items[1]['id']}/reject/")
        response = self.client_api.post(f"/api/planning/sow-imports/{data['id']}/finalize/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "APPROVED")
        self.assertEqual(response.data["total_items_approved"], 1)
        self.assertEqual(response.data["total_items_rejected"], 1)

    # --- TESTE 14 ---
    def test_multiple_selected_paths_create_scope_item_paths(self):
        data = self.create_import("1x 18F LC-LC (45m)")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        path_a = Path.objects.get(code="PATH-A")
        path_b = Path.objects.get(code="PATH-B")
        patch_response = self.client_api.patch(
            f"/api/planning/sow-parsed-items/{item_id}/",
            {"suggested_paths": [path_a.pk, path_b.pk]},
            format="json",
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.data)
        approve_response = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/approve/")
        self.assertEqual(approve_response.status_code, 200, approve_response.data)
        scope_item = ScopeItem.objects.get(pk=approve_response.data["scope_item_id"])
        self.assertEqual(scope_item.scope_item_paths.count(), 2)
        self.assertEqual({p.code for p in scope_item.paths}, {"PATH-A", "PATH-B"})

    # --- TESTE 15 ---
    def test_works_without_ai_api_key_deterministic_only(self):
        with patch.dict(os.environ, {"AI_API_KEY": ""}, clear=False):
            data = self.create_import("10x CAT6 UTP up to 60m")
            self.process(data["id"])
        item = self.get_items(data["id"])[0]
        self.assertEqual(item["suggested_cable_family_code"], "COP-CAT6")
        sow_import = SowImport.objects.get(pk=data["id"])
        self.assertEqual(sow_import.status, "READY_FOR_REVIEW")
        self.assertEqual(sow_import.ai_provider, "")

    # --- extras: upload de arquivo (Bloco 1) ---
    def test_text_file_upload_extracts_source_text(self):
        upload = SimpleUploadedFile("escopo.txt", b"10x CAT6 UTP up to 60m", content_type="text/plain")
        response = self.client_api.post(
            "/api/planning/sow-imports/",
            {"title": "Upload de teste", "source_type": "TEXT", "source_file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        sow_import = SowImport.objects.get(pk=response.data["id"])
        self.assertIn("CAT6", sow_import.source_text)
        self.assertEqual(sow_import.original_filename, "escopo.txt")

    def test_binary_file_upload_returns_clear_unsupported_message_without_crashing(self):
        upload = SimpleUploadedFile("escopo.pdf", b"\x25\x50\x44\x46\xff\xfe\x00\x01", content_type="application/pdf")
        response = self.client_api.post(
            "/api/planning/sow-imports/",
            {"title": "PDF de teste", "source_type": "PDF", "source_file": upload},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        sow_import = SowImport.objects.get(pk=response.data["id"])
        self.assertEqual(sow_import.status, "FAILED")
        self.assertTrue(sow_import.error_message)
        self.assertTrue(sow_import.source_file)

    # --- idempotência de processamento / bloqueio de reprocessamento ---
    def test_process_twice_is_blocked_use_reprocess_instead(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        response = self.client_api.post(f"/api/planning/sow-imports/{data['id']}/process/")
        self.assertEqual(response.status_code, 400)

    def test_reprocess_blocked_after_item_approved(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/approve/")
        response = self.client_api.post(f"/api/planning/sow-imports/{data['id']}/reprocess/")
        self.assertEqual(response.status_code, 400)

    def test_reprocess_item_updates_fields_when_not_approved(self):
        data = self.create_import("10x CAT6 UTP up to 60m")
        self.process(data["id"])
        item_id = self.get_items(data["id"])[0]["id"]
        response = self.client_api.post(f"/api/planning/sow-parsed-items/{item_id}/reprocess/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["suggested_cable_family_code"], "COP-CAT6")
        history = response.data["normalization_metadata"].get("reprocess_history")
        self.assertTrue(history)

    def test_end_to_end_three_line_acceptance_scenario(self):
        """Critério de aceite end-to-end do pedido original: colar 3 linhas,
        processar, revisar, aprovar selecionados -> 3 ScopeItems, 0
        GeneratedTask."""
        text = (
            "2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n"
            "4x 2F robust fibers up to 60m\n"
            "10x CAT6 UTP up to 60m"
        )
        data = self.create_import(text)
        process_result = self.process(data["id"])
        self.assertEqual(process_result["total_items_detected"], 3)
        items = self.get_items(data["id"])
        self.assertEqual(len(items), 3)

        item_ids = [item["id"] for item in items]
        response = self.client_api.post(
            f"/api/planning/sow-imports/{data['id']}/approve-selected/",
            {"item_ids": item_ids},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data["approved"]), 3)
        self.assertEqual(response.data["sow_import"]["total_items_approved"], 3)
        self.assertEqual(ScopeItem.objects.filter(source_reference=data["code"]).count(), 3)
        self.assertEqual(GeneratedTask.objects.filter(scope_item__source_reference=data["code"]).count(), 0)


def _mock_openrouter_response(status_code=200, model="mistralai/test-model:free", content='{"items": []}', error_message=None):
    """Constrói um objeto que imita requests.Response o suficiente para os
    testes de OpenRouterAiSowParser — nunca bate na rede de verdade."""
    response = MagicMock()
    response.status_code = status_code
    response.ok = 200 <= status_code < 300
    if error_message is not None:
        response.json.return_value = {"error": {"message": error_message}}
        response.text = error_message
    else:
        response.json.return_value = {
            "model": model,
            "choices": [{"message": {"content": content}}],
            "usage": {"total_tokens": 42},
        }
        response.text = content
    return response


class AiParserTests(TestCase):
    """Integração com o OpenRouter do parser de SOW (timeout, retry,
    mapeamento de erros, resolved_model, endpoints técnicos, fallback do
    pipeline) — SEMPRE com requests.post mockado; a suíte automática nunca
    gasta uma chamada real de IA (ver pedido original, bloco 16)."""

    def setUp(self):
        self.client_api = APIClient()
        self.admin = User.objects.create_superuser(
            username="ai_parser_admin", email="ai_parser_admin@example.com", password="test-password"
        )
        self.client_api.force_authenticate(user=self.admin)

    def _parser(self, **overrides):
        from master_data.services.sow_parser.ai_parser import OpenRouterAiSowParser

        kwargs = dict(api_key="test-secret-key-should-never-leak", model="openrouter/free", timeout=5, max_retries=2)
        kwargs.update(overrides)
        return OpenRouterAiSowParser(**kwargs)

    # --- timeout / retry ---

    def test_timeout_is_passed_to_requests_post(self):
        parser = self._parser(timeout=7)
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
            mock_post.return_value = _mock_openrouter_response()
            parser.test_connection()
        self.assertEqual(mock_post.call_args.kwargs["timeout"], 7)

    def test_retries_on_429_then_succeeds(self):
        parser = self._parser()
        responses = [
            _mock_openrouter_response(status_code=429, error_message="rate limited"),
            _mock_openrouter_response(status_code=429, error_message="rate limited"),
            _mock_openrouter_response(status_code=200),
        ]
        with patch("master_data.services.sow_parser.ai_parser.requests.post", side_effect=responses) as mock_post, patch(
            "master_data.services.sow_parser.ai_parser.time.sleep"
        ):
            result = parser.test_connection()
        self.assertEqual(mock_post.call_count, 3)
        self.assertEqual(result["retries"], 2)

    def test_retries_on_500_then_succeeds(self):
        parser = self._parser()
        responses = [
            _mock_openrouter_response(status_code=500, error_message="server error"),
            _mock_openrouter_response(status_code=200),
        ]
        with patch("master_data.services.sow_parser.ai_parser.requests.post", side_effect=responses) as mock_post, patch(
            "master_data.services.sow_parser.ai_parser.time.sleep"
        ):
            result = parser.test_connection()
        self.assertEqual(mock_post.call_count, 2)
        self.assertEqual(result["retries"], 1)

    def test_no_retry_on_401(self):
        from master_data.services.sow_parser.ai_parser import AiSowParserError

        parser = self._parser()
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post, patch(
            "master_data.services.sow_parser.ai_parser.time.sleep"
        ) as mock_sleep:
            mock_post.return_value = _mock_openrouter_response(status_code=401, error_message="invalid key")
            with self.assertRaises(AiSowParserError) as ctx:
                parser.test_connection()
        self.assertEqual(mock_post.call_count, 1)
        mock_sleep.assert_not_called()
        self.assertEqual(ctx.exception.code, "OPENROUTER_AUTH_ERROR")

    def test_no_retry_on_403(self):
        from master_data.services.sow_parser.ai_parser import AiSowParserError

        parser = self._parser()
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
            mock_post.return_value = _mock_openrouter_response(status_code=403, error_message="forbidden")
            with self.assertRaises(AiSowParserError) as ctx:
                parser.test_connection()
        self.assertEqual(mock_post.call_count, 1)
        self.assertEqual(ctx.exception.code, "OPENROUTER_PERMISSION_ERROR")

    def test_max_retries_respected_then_raises_rate_limit(self):
        from master_data.services.sow_parser.ai_parser import AiSowParserError

        parser = self._parser(max_retries=2)
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post, patch(
            "master_data.services.sow_parser.ai_parser.time.sleep"
        ):
            mock_post.return_value = _mock_openrouter_response(status_code=429, error_message="rate limited")
            with self.assertRaises(AiSowParserError) as ctx:
                parser.test_connection()
        self.assertEqual(mock_post.call_count, 3)  # 1 inicial + 2 retries
        self.assertEqual(ctx.exception.code, "OPENROUTER_RATE_LIMIT")

    def test_structured_output_falls_back_when_unsupported(self):
        parser = self._parser()
        responses = [
            _mock_openrouter_response(status_code=400, error_message="response_format is not supported for this model"),
            _mock_openrouter_response(status_code=200, content='{"ok": true}'),
        ]
        with patch("master_data.services.sow_parser.ai_parser.requests.post", side_effect=responses) as mock_post:
            result = parser.test_connection()
        self.assertEqual(mock_post.call_count, 2)
        self.assertTrue(result["success"])
        second_call_body = mock_post.call_args_list[1].kwargs["json"]
        self.assertNotIn("response_format", second_call_body)

    def test_resolved_model_captured_from_response(self):
        parser = self._parser(model="openrouter/free")
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
            mock_post.return_value = _mock_openrouter_response(model="mistralai/mistral-7b-instruct:free")
            result = parser.test_connection()
        self.assertEqual(result["configured_model"], "openrouter/free")
        self.assertEqual(result["resolved_model"], "mistralai/mistral-7b-instruct:free")

    def test_api_key_never_appears_in_exception_message(self):
        from master_data.services.sow_parser.ai_parser import AiSowParserError

        secret = "sk-or-v1-super-secret-should-never-leak"
        parser = self._parser(api_key=secret)
        with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
            mock_post.return_value = _mock_openrouter_response(status_code=401, error_message="invalid key")
            with self.assertRaises(AiSowParserError) as ctx:
                parser.test_connection()
        self.assertNotIn(secret, str(ctx.exception))

    # --- endpoints técnicos ---

    def test_ai_status_endpoint_never_calls_openrouter(self):
        with patch.dict(os.environ, {"AI_API_KEY": "", "AI_MODEL": ""}, clear=False):
            with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
                response = self.client_api.get("/api/planning/ai/status/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["configured"])
        mock_post.assert_not_called()

    def test_ai_status_endpoint_reports_configured(self):
        with patch.dict(
            os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "openrouter/free", "AI_PROVIDER": "openrouter"}, clear=False
        ):
            response = self.client_api.get("/api/planning/ai/status/")
        self.assertTrue(response.data["configured"])
        self.assertEqual(response.data["configured_model"], "openrouter/free")
        self.assertNotIn("test-key", str(response.data))

    def test_ai_test_endpoint_success_with_mock(self):
        with patch.dict(
            os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "openrouter/free", "AI_PROVIDER": "openrouter"}, clear=False
        ):
            with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
                mock_post.return_value = _mock_openrouter_response(model="resolved/model")
                response = self.client_api.post("/api/planning/ai/test/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data["success"])
        self.assertEqual(response.data["resolved_model"], "resolved/model")
        self.assertNotIn("test-key", str(response.data))

    def test_ai_test_endpoint_failure_returns_503(self):
        with patch.dict(
            os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "openrouter/free", "AI_PROVIDER": "openrouter"}, clear=False
        ):
            with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
                mock_post.return_value = _mock_openrouter_response(status_code=401, error_message="invalid key")
                response = self.client_api.post("/api/planning/ai/test/")
        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.data["success"])
        self.assertEqual(response.data["error_code"], "OPENROUTER_AUTH_ERROR")

    def test_ai_test_endpoint_not_configured(self):
        with patch.dict(os.environ, {"AI_API_KEY": ""}, clear=False):
            response = self.client_api.post("/api/planning/ai/test/")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.data["error_code"], "OPENROUTER_NOT_CONFIGURED")

    # --- pipeline hybrid / fallback ---

    def test_sow_import_pipeline_hybrid_ai_mode_with_mock(self):
        ai_payload = json.dumps({"items": [{"quantity": 10, "confidence_score": 0.9, "paths": [], "warnings": []}]})
        with patch.dict(
            os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "openrouter/free", "AI_PROVIDER": "openrouter"}, clear=False
        ):
            with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
                mock_post.return_value = _mock_openrouter_response(model="resolved/model-x", content=ai_payload)
                create_response = self.client_api.post(
                    "/api/planning/sow-imports/",
                    {"title": "Teste IA", "source_type": "TEXT", "source_text": "10x CAT6 UTP up to 60m"},
                    format="json",
                )
                sow_import_id = create_response.data["id"]
                process_response = self.client_api.post(f"/api/planning/sow-imports/{sow_import_id}/process/")
        self.assertEqual(process_response.status_code, 200, process_response.data)
        self.assertEqual(process_response.data["ai_mode"], "HYBRID_AI")
        self.assertEqual(process_response.data["ai_model"], "resolved/model-x")

    def test_sow_import_pipeline_falls_back_to_deterministic_on_ai_failure(self):
        with patch.dict(
            os.environ, {"AI_API_KEY": "test-key", "AI_MODEL": "openrouter/free", "AI_PROVIDER": "openrouter"}, clear=False
        ):
            with patch("master_data.services.sow_parser.ai_parser.requests.post") as mock_post:
                mock_post.return_value = _mock_openrouter_response(status_code=500, error_message="upstream down")
                create_response = self.client_api.post(
                    "/api/planning/sow-imports/",
                    {"title": "Teste IA falha", "source_type": "TEXT", "source_text": "10x CAT6 UTP up to 60m"},
                    format="json",
                )
                sow_import_id = create_response.data["id"]
                process_response = self.client_api.post(f"/api/planning/sow-imports/{sow_import_id}/process/")
        self.assertEqual(process_response.status_code, 200, process_response.data)
        self.assertEqual(process_response.data["ai_mode"], "DETERMINISTIC_ONLY")
        items_response = self.client_api.get(f"/api/planning/sow-imports/{sow_import_id}/items/")
        warning_codes = [w["code"] for w in items_response.data[0]["warnings"]]
        self.assertIn("AI_UNAVAILABLE", warning_codes)
