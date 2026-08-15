from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from audit.models import AuditLog
from core.models import Client, Collaborator, Company, Site
from projects.models import Project
from users.models import User
from .models import DailyUpdate, DailyUpdateAllocation


class DailyUpdateTests(TestCase):
    def setUp(self):
        self.supervisor = User.objects.create_superuser(
            username="daily_supervisor",
            email="daily@example.com",
            password="test-password",
        )
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_record = Client.objects.create(company=self.company, legal_name="Cliente Teste")
        self.site = Site.objects.create(client=self.client_record, name="GRU65", code="GRU65")
        self.project = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Alocação",
            po="PO-1001",
            status=Project.STATUS_IN_PROGRESS,
        )
        self.second_project = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Segundo Projeto",
            po="PO-1002",
            status=Project.STATUS_PLANNING,
        )
        self.technicians = [
            Collaborator.objects.create(company=self.company, name=f"Técnico {number}")
            for number in range(1, 3)
        ]
        AuditLog.objects.all().delete()
        self.client.force_login(self.supervisor)

    def test_default_allocation_date_is_tomorrow(self):
        update = DailyUpdate()
        self.assertEqual(update.allocation_date, timezone.localdate() + timedelta(days=1))

    def test_supervisor_creates_daily_allocation_with_multiple_technicians(self):
        allocation_date = timezone.localdate() + timedelta(days=1)
        response = self.client.post(
            "/admin/updates/dailyupdate/add/",
            {
                "allocation_date": allocation_date.isoformat(),
                "allocations-TOTAL_FORMS": "2",
                "allocations-INITIAL_FORMS": "0",
                "allocations-MIN_NUM_FORMS": "1",
                "allocations-MAX_NUM_FORMS": "1000",
                "allocations-0-project": str(self.project.pk),
                "allocations-0-collaborators": [str(self.technicians[0].pk)],
                "allocations-1-project": str(self.second_project.pk),
                "allocations-1-collaborators": [str(self.technicians[1].pk)],
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 302)
        update = DailyUpdate.objects.get()
        self.assertEqual(update.created_by, self.supervisor)
        self.assertQuerySetEqual(
            update.allocations.order_by("project_id").values_list("project_id", flat=True),
            [self.project.pk, self.second_project.pk],
        )
        self.assertEqual(list(update.sites), [self.site.name])
        self.assertQuerySetEqual(
            update.allocations.get(project=self.project).collaborators.all(),
            [self.technicians[0]],
        )
        self.assertQuerySetEqual(
            update.allocations.get(project=self.second_project).collaborators.all(),
            [self.technicians[1]],
        )
        self.assertIn("ATUALIZAÇÃO DIÁRIA", update.description)
        self.assertIn(allocation_date.strftime("%d/%m/%Y"), update.description)
        self.assertIn(self.project.name, update.description)
        self.assertIn(self.project.po, update.description)
        self.assertIn(self.second_project.name, update.description)
        self.assertIn(self.second_project.po, update.description)
        self.assertIn(self.site.name, update.description)
        for technician in self.technicians:
            self.assertIn(technician.name, update.description)
        self.assertTrue(
            AuditLog.objects.filter(
                app_label="updates",
                object_pk=str(update.pk),
                actor=self.supervisor,
                origin="Django Admin",
            ).exists()
        )

    def test_collaborator_from_another_company_is_rejected(self):
        another_company = Company.objects.create(legal_name="Outra Empresa")
        outsider = Collaborator.objects.create(company=another_company, name="Técnico Externo")
        response = self.client.post(
            "/admin/updates/dailyupdate/add/",
            {
                "allocation_date": (timezone.localdate() + timedelta(days=1)).isoformat(),
                "allocations-TOTAL_FORMS": "1",
                "allocations-INITIAL_FORMS": "0",
                "allocations-MIN_NUM_FORMS": "1",
                "allocations-MAX_NUM_FORMS": "1000",
                "allocations-0-project": str(self.project.pk),
                "allocations-0-collaborators": [str(outsider.pk)],
                "_save": "Salvar",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "mesma Empresa do Projeto selecionado")
        self.assertFalse(DailyUpdate.objects.exists())

    def test_completed_project_is_not_available_for_allocation(self):
        completed = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Concluído",
            status=Project.STATUS_COMPLETED,
        )
        paused = Project.objects.create(
            company=self.company,
            site=self.site,
            name="Projeto Pausado",
            status=Project.STATUS_PAUSED,
        )
        response = self.client.get("/admin/updates/dailyupdate/add/")

        self.assertEqual(response.status_code, 200)
        project_field = response.context["inline_admin_formsets"][0].formset.forms[0].fields["project"]
        self.assertIn(self.project, project_field.queryset)
        self.assertIn(self.second_project, project_field.queryset)
        self.assertNotIn(completed, project_field.queryset)
        self.assertNotIn(paused, project_field.queryset)

    def test_consolidated_pdf_is_generated_for_selected_date(self):
        allocation_date = timezone.localdate() + timedelta(days=1)
        update = DailyUpdate.objects.create(
            allocation_date=allocation_date,
            created_by=self.supervisor,
        )
        allocation = DailyUpdateAllocation.objects.create(
            daily_update=update,
            project=self.project,
        )
        allocation.collaborators.set(self.technicians)

        response = self.client.get(
            "/admin/updates/dailyupdate/pdf-consolidado/",
            {"date": allocation_date.isoformat()},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertTrue(b"".join(response.streaming_content).startswith(b"%PDF"))
