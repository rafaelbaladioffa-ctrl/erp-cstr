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


@override_settings(WHATSAPP_BOT_SECRET="test-bot-secret")
class BotBroadcastRuleTests(TestCase):
    """Regras de envio configuráveis: filtros de projeto, destinatários,
    agendamento e envio de teste."""

    def setUp(self):
        from core.models import Category, Client

        self.api = APIClient()
        self.bot_headers = {"HTTP_X_BOT_SECRET": "test-bot-secret"}
        self.company = Company.objects.create(legal_name="CONSULTIMER BRASIL LTDA")
        self.client_a = Client.objects.create(company=self.company, legal_name="Cliente A")
        self.client_b = Client.objects.create(company=self.company, legal_name="Cliente B")
        self.cat_x = Category.objects.create(name="Categoria X")
        self.cat_y = Category.objects.create(name="Categoria Y")
        self.match = Project.objects.create(
            company=self.company, name="Casa", status=Project.STATUS_IN_PROGRESS, client=self.client_a, category=self.cat_x
        )
        Project.objects.create(
            company=self.company, name="Outro cliente", status=Project.STATUS_IN_PROGRESS, client=self.client_b, category=self.cat_x
        )
        Project.objects.create(
            company=self.company, name="Outra categoria", status=Project.STATUS_IN_PROGRESS, client=self.client_a, category=self.cat_y
        )
        Project.objects.create(
            company=self.company, name="Pausado", status=Project.STATUS_PAUSED, client=self.client_a, category=self.cat_x
        )

    def make_rule(self, **kwargs):
        from datetime import time

        from bot.models import BotBroadcastRule

        rule = BotBroadcastRule.objects.create(
            name=kwargs.pop("name", "Regra"), send_time=kwargs.pop("send_time", time(15, 0)),
            statuses=kwargs.pop("statuses", ["in_progress"]), **kwargs,
        )
        rule.clients.set([self.client_a])
        rule.categories.set([self.cat_x])
        return rule

    def test_rule_filters_projects_by_client_category_and_status(self):
        rule = self.make_rule()
        response = self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/", **self.bot_headers)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([p["project"] for p in response.data["projects"]], ["Casa"])

    def test_empty_filters_do_not_restrict(self):
        rule = self.make_rule()
        rule.clients.clear()
        rule.categories.clear()
        response = self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/", **self.bot_headers)
        self.assertEqual(len(response.data["projects"]), 3)  # só o pausado fica de fora

    def test_recipients_fall_back_to_report_subscribers_when_rule_has_none(self):
        BotSubscriber.objects.create(name="Gestor", phone="11999998888", receives_daily_project_report=True)
        specific = BotSubscriber.objects.create(name="Só esta regra", phone="11988887777", receives_daily_project_report=False)
        rule = self.make_rule()
        response = self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/", **self.bot_headers)
        self.assertEqual([r["name"] for r in response.data["recipients"]], ["Gestor"])
        rule.recipients.set([specific])
        response = self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/", **self.bot_headers)
        self.assertEqual([r["name"] for r in response.data["recipients"]], ["Só esta regra"])

    def test_schedule_lists_only_active_rules(self):
        self.make_rule(name="Ativa")
        self.make_rule(name="Inativa", is_active=False)
        response = self.api.get("/api/bot/broadcasts/rules/", **self.bot_headers)
        names = [r["name"] for r in response.data]
        self.assertIn("Ativa", names)
        self.assertNotIn("Inativa", names)
        self.assertEqual(next(r for r in response.data if r["name"] == "Ativa")["send_time"], "15:00")

    def test_runtime_endpoints_require_secret(self):
        rule = self.make_rule()
        self.assertEqual(self.api.get("/api/bot/broadcasts/rules/").status_code, 403)
        self.assertEqual(self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/").status_code, 403)

    def test_crud_requires_permission_and_validates(self):
        from django.contrib.auth import get_user_model

        User = get_user_model()
        user = User.objects.create_user(username="semperm", password="x")
        self.api.force_authenticate(user)
        self.assertEqual(self.api.get("/api/bot/broadcast-rules/").status_code, 403)

        admin = User.objects.create_superuser(username="admin", password="x", email="a@a.com")
        self.api.force_authenticate(admin)
        payload = {
            "name": "Nova", "content_type": "image", "send_time": "15:01", "weekdays": [0, 2],
            "statuses": ["in_progress"], "client_ids": [self.client_a.pk], "category_ids": [self.cat_x.pk],
        }
        created = self.api.post("/api/bot/broadcast-rules/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["send_time"], "15:01")
        bad = self.api.post("/api/bot/broadcast-rules/", {**payload, "weekdays": [9]}, format="json")
        self.assertEqual(bad.status_code, 400)
        options = self.api.get("/api/bot/broadcast-rules/options/")
        self.assertEqual(options.status_code, 200)
        self.assertIn("clients", options.data)

    def test_test_send_requires_target(self):
        from django.contrib.auth import get_user_model

        admin = get_user_model().objects.create_superuser(username="admin2", password="x", email="b@b.com")
        self.api.force_authenticate(admin)
        from bot.models import BotBroadcastRule

        rule = {"name": "Teste", "content_type": "text", "send_time": "15:00"}
        response = self.api.post("/api/bot/broadcast-rules/test/", {"rule": rule}, format="json")
        self.assertEqual(response.status_code, 400)
        # validação do rascunho e limpeza: regra temporária não pode sobrar
        before = BotBroadcastRule.objects.count()
        invalid = self.api.post("/api/bot/broadcast-rules/test/", {"to": "11999998888", "rule": {"name": "x"}}, format="json")
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(BotBroadcastRule.objects.count(), before)


@override_settings(WHATSAPP_BOT_SECRET="test-bot-secret")
class BotRulesAllTypesTests(TestCase):
    """Regras para todos os tipos de mensagem + CRUD de destinatários."""

    def setUp(self):
        from django.contrib.auth import get_user_model

        self.api = APIClient()
        self.bot_headers = {"HTTP_X_BOT_SECRET": "test-bot-secret"}
        self.admin = get_user_model().objects.create_superuser(username="admin3", password="x", email="c@c.com")

    def test_migration_seeds_rules_for_every_type(self):
        from bot.models import BotBroadcastRule

        types = set(BotBroadcastRule.objects.values_list("message_type", flat=True))
        self.assertTrue({"daily_tasks", "project_updates", "allocation", "operations_print"} <= types)
        allocation = BotBroadcastRule.objects.get(message_type="allocation")
        self.assertEqual(allocation.date_offset_days, 1)
        self.assertEqual(BotBroadcastRule.objects.filter(message_type="operations_print").count(), 6)

    def test_runtime_payload_per_type(self):
        from bot.models import BotBroadcastRule

        for message_type, key in (
            ("daily_tasks", "projects"),
            ("project_updates", "projects"),
            ("allocation", "technicians"),
            ("operations_print", "sites"),
        ):
            rule = BotBroadcastRule.objects.filter(message_type=message_type).first()
            response = self.api.get(f"/api/bot/broadcasts/rule/{rule.pk}/", **self.bot_headers)
            self.assertEqual(response.status_code, 200, response.data)
            self.assertIn(key, response.data)
            self.assertEqual(response.data["rule"]["message_type"], message_type)
        # alocação sem destinatários escolhidos = envio individual (lista vazia,
        # sem cair nos destinatários padrão); com destinatário, vai para ele
        allocation = BotBroadcastRule.objects.get(message_type="allocation")
        url = f"/api/bot/broadcasts/rule/{allocation.pk}/"
        self.assertEqual(self.api.get(url, **self.bot_headers).data["recipients"], [])
        group = BotSubscriber.objects.create(name="Grupo Alocação", group_jid="120363@g.us", receives_daily_tasks=False)
        allocation.recipients.set([group])
        recipients = self.api.get(url, **self.bot_headers).data["recipients"]
        self.assertEqual([r["name"] for r in recipients], ["Grupo Alocação"])

    def test_format_must_match_message_type(self):
        self.api.force_authenticate(self.admin)
        payload = {"name": "x", "message_type": "allocation", "content_type": "image", "send_time": "18:00"}
        self.assertEqual(self.api.post("/api/bot/broadcast-rules/", payload, format="json").status_code, 400)
        payload["content_type"] = "text"
        self.assertEqual(self.api.post("/api/bot/broadcast-rules/", payload, format="json").status_code, 201)

    def test_subscriber_crud_validation(self):
        self.api.force_authenticate(self.admin)
        bad = self.api.post("/api/bot/subscribers/", {"name": "Sem destino"}, format="json")
        self.assertEqual(bad.status_code, 400)
        bad_group = self.api.post("/api/bot/subscribers/", {"name": "G", "group_jid": "123"}, format="json")
        self.assertEqual(bad_group.status_code, 400)
        ok = self.api.post("/api/bot/subscribers/", {"name": "Grupo", "group_jid": "120363@g.us"}, format="json")
        self.assertEqual(ok.status_code, 201, ok.data)
        self.assertEqual(self.api.get("/api/bot/subscribers/").status_code, 200)

    def test_new_message_templates_available(self):
        self.api.force_authenticate(self.admin)
        data = self.api.get("/api/bot/message-templates/").data
        types = {t["message_type"] for t in data}
        self.assertTrue({"allocation", "interactive_menu"} <= types)
        runtime = self.api.get("/api/bot/message-template/?message_type=interactive_menu", **self.bot_headers)
        self.assertEqual(runtime.status_code, 200)
