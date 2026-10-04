"""Regras de envio configuráveis pela web (horário, filtros de projeto,
destinatários e formato) para o relatório diário de projeto do bot."""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Category, Client, Site
from projects.models import Project

from .models import BotBroadcastRule, BotSubscriber
from .permissions import BotSharedSecretPermission
from .views import _active_subscribers, _parse_target_date, build_daily_project_report_projects

BOT_INTERNAL_URL = os.getenv("BOT_INTERNAL_URL", "http://whatsapp-bot:3001")


class BotBroadcastRuleSerializer(serializers.ModelSerializer):
    send_time = serializers.TimeField(format="%H:%M", input_formats=["%H:%M", "%H:%M:%S"])
    client_ids = serializers.PrimaryKeyRelatedField(source="clients", queryset=Client.objects.all(), many=True, required=False)
    category_ids = serializers.PrimaryKeyRelatedField(source="categories", queryset=Category.objects.all(), many=True, required=False)
    site_ids = serializers.PrimaryKeyRelatedField(source="sites", queryset=Site.objects.all(), many=True, required=False)
    recipient_ids = serializers.PrimaryKeyRelatedField(source="recipients", queryset=BotSubscriber.objects.all(), many=True, required=False)

    class Meta:
        model = BotBroadcastRule
        fields = (
            "id", "name", "is_active", "content_type", "send_time", "weekdays", "statuses",
            "client_ids", "category_ids", "site_ids", "recipient_ids", "image_caption",
        )

    def validate_weekdays(self, value):
        if not isinstance(value, list) or any(not isinstance(d, int) or not 0 <= d <= 6 for d in value):
            raise serializers.ValidationError("Use números de 0 (segunda) a 6 (domingo).")
        return sorted(set(value))

    def validate_statuses(self, value):
        valid = {key for key, _label in Project.STATUS_CHOICES}
        if not isinstance(value, list) or any(s not in valid for s in value):
            raise serializers.ValidationError("Status de projeto inválido.")
        return value


class BotBroadcastRuleViewSet(viewsets.ModelViewSet):
    queryset = BotBroadcastRule.objects.prefetch_related("clients", "categories", "sites", "recipients")
    serializer_class = BotBroadcastRuleSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        read_only = request.method in ("GET", "HEAD", "OPTIONS")
        perm = "bot.view_botmessagetemplate" if read_only else "bot.change_botmessagetemplate"
        if not request.user.has_perm(perm):
            raise PermissionDenied("Sem permissão.")

    @action(detail=False, methods=["get"])
    def options(self, request):
        """Listas usadas pelos filtros da tela."""
        return Response(
            {
                "clients": [
                    {"id": c.pk, "name": c.trade_name or c.legal_name or f"Cliente {c.pk}"}
                    for c in Client.objects.order_by("trade_name", "legal_name")
                ],
                "categories": [{"id": c.pk, "name": c.name} for c in Category.objects.exclude(name="").order_by("name")],
                "sites": [{"id": s.pk, "name": s.name} for s in Site.objects.order_by("name")],
                "statuses": [{"id": key, "name": label} for key, label in Project.STATUS_CHOICES],
                "subscribers": [
                    {"id": s.pk, "name": s.name, "target": s.group_jid or s.phone}
                    for s in BotSubscriber.objects.filter(is_active=True).order_by("name")
                ],
            }
        )

    @action(detail=True, methods=["post"])
    def test(self, request, pk=None):
        """Envio de teste: dispara a regra com os filtros ATUAIS, só para o
        telefone/grupo informado (não toca nos destinatários reais)."""
        rule = self.get_object()
        target = str(request.data.get("to", "")).strip()
        if not target:
            return Response({"detail": "Informe o telefone ou o ID do grupo (@g.us)."}, status=400)
        if not settings.WHATSAPP_BOT_SECRET:
            return Response({"detail": "Bot não configurado."}, status=503)
        query = urllib.parse.urlencode({"rule": rule.pk, "to": target})
        req = urllib.request.Request(
            f"{BOT_INTERNAL_URL}/trigger-rule?{query}",
            headers={"X-Bot-Token": settings.WHATSAPP_BOT_SECRET},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                payload = json.loads(resp.read().decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            if exc.code == 503:
                detail = "O bot ainda está inicializando, tente novamente."
            else:
                detail = f"O bot recusou o envio (HTTP {exc.code})."
            return Response({"detail": detail}, status=502)
        except (urllib.error.URLError, TimeoutError, ValueError):
            return Response({"detail": "Não foi possível falar com o bot."}, status=502)
        return Response({"detail": payload.get("message", "Envio de teste disparado.")})


class BotRulesScheduleView(APIView):
    """GET /api/bot/broadcasts/rules/ — regras ativas e seus horários, lido
    pelo agendador do bot a cada minuto."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        rules = BotBroadcastRule.objects.filter(is_active=True)
        return Response(
            [
                {
                    "id": r.pk,
                    "name": r.name,
                    "content_type": r.content_type,
                    "send_time": r.send_time.strftime("%H:%M"),
                    "weekdays": r.weekdays,
                }
                for r in rules
            ]
        )


class BotRuleBroadcastView(APIView):
    """GET /api/bot/broadcasts/rule/<id>/?date= — projetos e destinatários
    de uma regra, calculados na hora do envio."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request, pk):
        rule = get_object_or_404(BotBroadcastRule, pk=pk)
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error
        recipients = list(rule.recipients.filter(is_active=True).order_by("name").values("name", "phone", "group_jid"))
        if not recipients:
            recipients = _active_subscribers("receives_daily_project_report")
        return Response(
            {
                "rule": {"id": rule.pk, "name": rule.name, "content_type": rule.content_type, "image_caption": rule.image_caption},
                "date": target_date.isoformat(),
                "projects": build_daily_project_report_projects(target_date, rule=rule),
                "recipients": recipients,
            }
        )
