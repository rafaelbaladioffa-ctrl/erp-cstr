from datetime import datetime

from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from core.models import Collaborator, Company, Task
from projects.models import Project, ProjectTask, RackPosition
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
        collaborator = Collaborator.objects.create(company=self.company, name="Técnico Um")
        other_collaborator = Collaborator.objects.create(company=self.company, name="Técnico Dois")
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
        collaborator = Collaborator.objects.create(company=self.company, name="Técnico Período")
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
