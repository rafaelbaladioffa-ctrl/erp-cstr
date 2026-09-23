from datetime import timedelta

from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from bot.models import BotSubscriber
from core.models import Company
from projects.models import (
    Project,
    ProjectAttachment,
    ProjectOccurrence,
    ProjectProgressSnapshot,
)


@override_settings(WHATSAPP_BOT_SECRET="test-bot-secret")
class BotDailyProjectReportBroadcastViewTests(TestCase):
    """GET /api/bot/broadcasts/daily-project-report/ — envio automático das
    15h. Cobre as regras que alimentam a mensagem: só projetos com
    status=in_progress entram; certificação é derivada da existência de
    anexo no projeto; Riscos/Bloqueios vêm das Ocorrências em aberto; e o
    "avanço no dia" compara com o retrato diário anterior."""

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

    def test_certification_derives_from_project_attachment(self):
        sem_anexo = Project.objects.create(
            company=self.company, name="Projeto Sem Anexo", status=Project.STATUS_IN_PROGRESS
        )
        com_anexo = Project.objects.create(
            company=self.company, name="Projeto Com Anexo", status=Project.STATUS_IN_PROGRESS
        )
        ProjectAttachment.objects.create(
            project=com_anexo, file=SimpleUploadedFile("certificacao.pdf", b"conteudo")
        )

        response = self.call()

        by_name = {p["project"]: p for p in response.data["projects"]}
        self.assertEqual(by_name[sem_anexo.name]["certification_label"], "Pendente")
        self.assertEqual(by_name[com_anexo.name]["certification_label"], "Concluída")

    def test_daily_delta_is_none_on_first_run_then_compares_to_snapshot(self):
        project = Project.objects.create(
            company=self.company, name="Projeto Delta", status=Project.STATUS_IN_PROGRESS
        )

        # 1º envio: não existe retrato anterior, então não há delta.
        first = self.call()
        self.assertIsNone(first.data["projects"][0]["daily_delta"])
        snapshot = ProjectProgressSnapshot.objects.get(project=project)
        self.assertEqual(snapshot.date, timezone.localdate())

        # Simula o retrato de ontem com 10% a menos do que o avanço de hoje.
        current = first.data["projects"][0]["completion_percent"]
        ProjectProgressSnapshot.objects.create(
            project=project, date=timezone.localdate() - timedelta(days=1), percent=max(current - 10, 0)
        )

        second = self.call()

        self.assertEqual(second.data["projects"][0]["daily_delta"], current - max(current - 10, 0))

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

    def test_group_and_phone_recipients_are_both_listed(self):
        Project.objects.create(company=self.company, name="Projeto", status=Project.STATUS_IN_PROGRESS)
        BotSubscriber.objects.create(name="Gestor", phone="11999998888", receives_daily_project_report=True)
        BotSubscriber.objects.create(
            name="Grupo Obra", group_jid="120363111111111111@g.us", receives_daily_project_report=True
        )
        BotSubscriber.objects.create(
            name="Não recebe", phone="11888887777", receives_daily_project_report=False
        )

        response = self.call()

        recipients = {r["name"]: r for r in response.data["recipients"]}
        self.assertEqual(set(recipients), {"Gestor", "Grupo Obra"})
        self.assertEqual(recipients["Grupo Obra"]["group_jid"], "120363111111111111@g.us")
        self.assertEqual(recipients["Gestor"]["group_jid"], "")


class BotSubscriberValidationTests(TestCase):
    """BotSubscriber.clean(): um destinatário é uma pessoa (telefone) OU um
    grupo do WhatsApp (group_jid terminado em @g.us)."""

    def test_requires_phone_or_group(self):
        with self.assertRaises(ValidationError):
            BotSubscriber(name="Sem destino").full_clean()

    def test_rejects_group_jid_without_g_us_suffix(self):
        with self.assertRaises(ValidationError):
            BotSubscriber(name="Grupo", group_jid="120363111111111111").full_clean()

    def test_accepts_group_without_phone(self):
        subscriber = BotSubscriber(name="Grupo Obra", group_jid="120363111111111111@g.us")
        subscriber.full_clean()  # não deve levantar
