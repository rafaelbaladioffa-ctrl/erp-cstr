from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from core.models import Company
from projects.models import Project, ProjectOccurrence


@override_settings(WHATSAPP_BOT_SECRET="test-bot-secret")
class BotDailyProjectReportBroadcastViewTests(TestCase):
    """GET /api/bot/broadcasts/daily-project-report/ — envio automático das
    15h. Cobre os 3 ajustes feitos nesta sessão sobre a implementação
    pré-existente (não commitada): (1) filtro por status=in_progress em vez
    de só is_active; (2) Project.certification_status real em vez da
    heurística por nome de tarefa; (3) Pendências/Bloqueios vindas de
    ProjectOccurrence em aberto, com fallback pro texto padrão."""

    def setUp(self):
        self.client_api = APIClient()
        self.headers = {"HTTP_X_BOT_SECRET": "test-bot-secret"}
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")

    def call(self):
        return self.client_api.get("/api/bot/broadcasts/daily-project-report/", **self.headers)

    def test_requires_shared_secret(self):
        response = self.client_api.get("/api/bot/broadcasts/daily-project-report/")
        self.assertEqual(response.status_code, 403)

    def test_only_in_progress_and_active_projects_included(self):
        active = Project.objects.create(
            company=self.company, name="Projeto Ativo", status=Project.STATUS_IN_PROGRESS, is_active=True
        )
        Project.objects.create(
            company=self.company, name="Projeto Pausado", status=Project.STATUS_PAUSED, is_active=True
        )
        Project.objects.create(
            company=self.company, name="Projeto Inativo", status=Project.STATUS_IN_PROGRESS, is_active=False
        )
        Project.objects.create(
            company=self.company, name="Projeto Concluído", status=Project.STATUS_COMPLETED, is_active=True
        )

        response = self.call()

        self.assertEqual(response.status_code, 200, response.data)
        names = [p["project"] for p in response.data["projects"]]
        self.assertEqual(names, [active.name])

    def test_certification_status_reflects_real_field_not_heuristic(self):
        pending = Project.objects.create(
            company=self.company,
            name="Projeto Certificação Pendente",
            status=Project.STATUS_IN_PROGRESS,
            certification_status=Project.CERTIFICATION_PENDING,
        )
        finished = Project.objects.create(
            company=self.company,
            name="Projeto Certificação Finalizada",
            status=Project.STATUS_IN_PROGRESS,
            certification_status=Project.CERTIFICATION_FINISHED,
        )

        response = self.call()

        by_name = {p["project"]: p for p in response.data["projects"]}
        self.assertFalse(by_name[pending.name]["certification_done"])
        self.assertTrue(by_name[finished.name]["certification_done"])

    def test_open_occurrences_used_as_pendencias(self):
        project = Project.objects.create(
            company=self.company, name="Projeto Com Ocorrência", status=Project.STATUS_IN_PROGRESS
        )
        ProjectOccurrence.objects.create(project=project, title="Falta de material", status=ProjectOccurrence.STATUS_OPEN)
        ProjectOccurrence.objects.create(
            project=project, title="Já resolvida", status=ProjectOccurrence.STATUS_RESOLVED
        )

        response = self.call()

        occurrences = response.data["projects"][0]["occurrences"]
        self.assertEqual(occurrences, ["Falta de material"])

    def test_no_occurrences_results_in_empty_list(self):
        Project.objects.create(company=self.company, name="Projeto Sem Ocorrência", status=Project.STATUS_IN_PROGRESS)

        response = self.call()

        self.assertEqual(response.data["projects"][0]["occurrences"], [])
