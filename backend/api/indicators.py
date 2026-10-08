"""Indicadores > Tendências (GET /api/indicators/trends/).

Série no tempo (dia/semana/mês) de três medidas:
- horas em execução (produtivas: execução + apoio a outro técnico);
- horas improdutivas (disponível sem tarefa + bloqueio externo);
- tarefas executadas (conclusões no período, por técnico).

As definições são as do relatório gerencial (api/management_report.py) e, portanto, as de
api/reports.py: os totais batem com Relatórios e Indicadores para o mesmo período e filtros.

Filtros (um ou vários ids separados por vírgula): site, client (cliente) e region (regional).
Os filtros se combinam (E): o painel considera os sites que atendem a todos os que foram
informados — mesma regra de site da Central de Operações (técnico lotado no site; tarefas
do projeto do site).
"""

from datetime import timedelta

from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Site

from .management_report import GROUPS, _bucket_starts, _collect, _series, auto_group
from .operations import HasOperationsBoardPermission
from .reports import parse_site_ids

MAX_TREND_DAYS = 366
DEFAULT_DAYS = 30


def resolve_site_ids(site, client, region):
    """Ids de site que atendem a todos os filtros informados. None = sem filtro (todos);
    lista vazia = os filtros não casam com nenhum site."""
    site_ids, client_ids, region_ids = parse_site_ids(site), parse_site_ids(client), parse_site_ids(region)
    if not (site_ids or client_ids or region_ids):
        return None
    sites = Site.objects.all()
    if site_ids:
        sites = sites.filter(id__in=site_ids)
    if client_ids:
        sites = sites.filter(client_id__in=client_ids)
    if region_ids:
        sites = sites.filter(region_id__in=region_ids)
    return list(sites.values_list("id", flat=True))


def build_trends(*, user, date_from, date_to, group, site_ids):
    starts = _bucket_starts(date_from, date_to, group)
    if site_ids is not None and not site_ids:
        series = [
            {"start": s.isoformat(), "productive_hours": 0.0, "external_block_hours": 0.0, "internal_idle_hours": 0.0, "completed_count": 0}
            for s in starts
        ]
    else:
        data = _collect(site_ids, date_from, date_to, user, timezone.now())
        series = _series(data["rows"], starts, group)

    points = [
        {
            "start": p["start"],
            "hours_execution": round(p["productive_hours"], 2),
            "hours_unproductive": round(p["external_block_hours"] + p["internal_idle_hours"], 2),
            "tasks_executed": p["completed_count"],
        }
        for p in series
    ]
    totals = {
        "hours_execution": round(sum(p["hours_execution"] for p in points), 2),
        "hours_unproductive": round(sum(p["hours_unproductive"] for p in points), 2),
        "tasks_executed": sum(p["tasks_executed"] for p in points),
    }
    return {
        "period": {
            "date_from": date_from.isoformat(),
            "date_to": date_to.isoformat(),
            "days": (date_to - date_from).days + 1,
            "group": group,
        },
        "points": points,
        "totals": totals,
        "max_period_days": MAX_TREND_DAYS,
    }


class IndicatorsTrendsView(APIView):
    """GET /api/indicators/trends/?date_from=&date_to=&group=day|week|month&site=&client=&region="""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        params = request.query_params
        today = timezone.localdate()
        date_from = parse_date(params.get("date_from") or "") or (today - timedelta(days=DEFAULT_DAYS - 1))
        date_to = parse_date(params.get("date_to") or "") or today
        if date_from > date_to:
            return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
        days = (date_to - date_from).days + 1
        if days > MAX_TREND_DAYS:
            return Response({"detail": f"O período máximo é de {MAX_TREND_DAYS} dias."}, status=400)
        group = params.get("group")
        group = group if group in GROUPS else auto_group(days)
        site_ids = resolve_site_ids(params.get("site"), params.get("client"), params.get("region"))
        return Response(build_trends(user=request.user, date_from=date_from, date_to=date_to, group=group, site_ids=site_ids))
