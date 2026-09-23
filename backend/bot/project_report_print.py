"""Página de impressão do resumo dinâmico enviado no relatório das 15h."""

from django.shortcuts import render
from rest_framework.views import APIView

from .permissions import BotSharedSecretPermission
from .views import _parse_target_date, build_daily_project_report_projects


class ProjectReportPrintView(APIView):
    """Renderiza um card por projeto ativo para o Puppeteer fotografar."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        projects = build_daily_project_report_projects(target_date)
        for project in projects:
            project["risks_label"] = "; ".join(project["occurrences"]) or "Nenhum bloqueio relevante identificado no período"
            project["delta_label"] = (
                "Primeiro registro"
                if project["daily_delta"] is None
                else f"{project['daily_delta']:+d}%"
            )
            project["is_certified"] = project["certification_label"] == "Concluída"

        count = len(projects)
        blocked = sum(bool(project["occurrences"]) for project in projects)
        average = round(sum(project["completion_percent"] for project in projects) / count) if count else 0
        return render(
            request,
            "bot/project_report_print.html",
            {
                "date_label": target_date.strftime("%d/%m/%Y"),
                "projects": projects,
                "project_count": count,
                "blocked_count": blocked,
                "average_progress": average,
            },
        )
