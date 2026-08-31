"""Endpoint agregado do módulo Central de Operações (MVP): o "board" de
despacho — técnicos do site com sua presença/atividade atual/fila, e o pool
de atividades pendentes do site. Somente leitura; despachar é uma action em
ProjectTaskViewSet (api/views.py), e presença tem seu próprio ViewSet
(TechnicianPresenceViewSet).
"""

from datetime import datetime, timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Collaborator
from dispatch.models import CollaboratorPair, TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import ProjectTask, ProjectTaskAssignment


class HasOperationsBoardPermission(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        return request.user.has_perm("projects.view_projecttaskassignment")


def _current_tasks_data(collaborator):
    """Todas as tarefas do técnico que estão 'abertas' agora (em execução OU
    pausada) — normalmente é só uma, mas nada impede o técnico de pausar uma
    e iniciar outra (a trava de 'uma execução por vez' só bloqueia duas
    simultâneas EM EXECUÇÃO, pausar é justamente a válvula de escape). Por
    isso isso retorna uma lista, não um único item — mostrar só a primeira
    escondia a que estava rodando de verdade."""
    assignments = (
        collaborator.task_assignments.select_related("project_task__project", "project_task__task")
        .filter(project_task__status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
        .order_by("project_task__status", "project_task__actual_start")
    )
    return [
        {
            "id": a.project_task.id,
            "name": a.project_task.display_name,
            "project_name": a.project_task.project.name,
            "status": a.project_task.status,
            "actual_start": a.project_task.actual_start,
        }
        for a in assignments
    ]


def _status_events_data(collaborator_ids, date):
    """Todas as trocas de status de presença do dia, por técnico — usado
    pra reconstruir a timeline mostrando cada mudança (não só a atual)."""
    events = TechnicianStatusEvent.objects.filter(
        collaborator_id__in=collaborator_ids, date=date
    ).order_by("changed_at")
    by_collaborator = {}
    for e in events:
        by_collaborator.setdefault(e.collaborator_id, []).append(
            {"status": e.status, "status_display": e.get_status_display(), "changed_at": e.changed_at}
        )
    return by_collaborator


def _pair_partner_map(collaborator_ids):
    """{collaborator_id: {"id": parceiro_id, "name": nome_parceiro}} pras
    duplas fixas ativas que têm os dois lados dentro do escopo pedido (site
    filtrado) — usado pro board/timeline agruparem a dupla visualmente."""
    pairs = CollaboratorPair.objects.filter(
        is_active=True, collaborator_a_id__in=collaborator_ids, collaborator_b_id__in=collaborator_ids
    ).select_related("collaborator_a__person", "collaborator_b__person")
    partner_map = {}
    for pair in pairs:
        partner_map[pair.collaborator_a_id] = {"id": pair.collaborator_b_id, "name": pair.collaborator_b.person.name}
        partner_map[pair.collaborator_b_id] = {"id": pair.collaborator_a_id, "name": pair.collaborator_a.person.name}
    return partner_map


def _site_label(collaborator):
    """Nome do(s) site(s) do técnico — um técnico pode estar vinculado a mais
    de um site (Collaborator.sites é M2M), então junta os nomes. Usado pra
    identificar de qual site é cada técnico quando o painel mostra 'Todos os
    sites' de uma vez."""
    names = [s.name for s in collaborator.sites.all()]
    return ", ".join(names) if names else "—"


def _queue_data(collaborator):
    assignments = (
        collaborator.task_assignments.select_related("project_task__project", "project_task__task")
        .filter(project_task__status=ProjectTask.STATUS_NOT_STARTED)
        .order_by("queue_order", "dispatched_at")
    )
    return [
        {
            "task_id": a.project_task_id,
            "task_name": a.project_task.display_name,
            "project_name": a.project_task.project.name,
            "queue_order": a.queue_order,
        }
        for a in assignments
    ]


def build_board_data(site_id):
    """Monta os mesmos dados de OperationsBoardView.get() — extraído à parte
    pra ser reaproveitado pela view de "print" (bot do WhatsApp), sem
    duplicar a lógica."""
    today = timezone.localdate()
    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    if site_id:
        collaborators_qs = collaborators_qs.filter(sites=site_id)

    presence_filter = {"date": today}
    if site_id:
        presence_filter["collaborator__sites"] = site_id
    presences = {p.collaborator_id: p for p in TechnicianDailyPresence.objects.filter(**presence_filter)}
    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, today)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)

    technicians = []
    for collaborator in collaborators_qs:
        presence = presences.get(collaborator.id)
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name if collaborator.person_id else str(collaborator),
                "site_name": _site_label(collaborator),
                "presence_status": presence.status if presence else TechnicianDailyPresence.STATUS_NOT_STARTED,
                "presence_status_display": (
                    presence.get_status_display() if presence else "Indisponível"
                ),
                "checked_in_at": presence.checked_in_at if presence else None,
                "checked_out_at": presence.checked_out_at if presence else None,
                "current_tasks": _current_tasks_data(collaborator),
                "queue": _queue_data(collaborator),
                "status_events": status_events_by_collaborator.get(collaborator.id, []),
                "pair_partner": pair_partner_by_collaborator.get(collaborator.id),
            }
        )

    # Só entra no pool do dia quem tem início AGENDADO pra hoje — sem
    # isso, todo o backlog não iniciado (mesmo tarefas agendadas pra
    # daqui semanas) aparecia junto, inflando a lista.
    pool_qs = ProjectTask.objects.filter(status=ProjectTask.STATUS_NOT_STARTED, planned_start__date=today)
    if site_id:
        pool_qs = pool_qs.filter(project__site_id=site_id)
    pool = (
        pool_qs.select_related("project", "project__site", "task")
        .prefetch_related("assignments__collaborator__person")
        .order_by("order", "id")
    )
    pool_data = [
        {
            "id": t.id,
            "name": t.display_name,
            "project_name": t.project.name,
            "project_code": t.project.code,
            "site_name": t.project.site.name if t.project.site_id else "—",
            "estimated_hours": t.estimated_hours,
            "assignees": [
                {"collaborator_id": a.collaborator_id, "name": a.collaborator.person.name, "queue_order": a.queue_order}
                for a in t.assignments.all()
            ],
        }
        for t in pool
    ]

    active_qs = ProjectTask.objects.filter(status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
    completed_qs = ProjectTask.objects.filter(status=ProjectTask.STATUS_COMPLETED, actual_end__date=today)
    if site_id:
        active_qs = active_qs.filter(project__site_id=site_id)
        completed_qs = completed_qs.filter(project__site_id=site_id)
    pending_count = len(pool_data)
    active_count = active_qs.count()
    completed_today_count = completed_qs.count()
    planned_count = pending_count + active_count + completed_today_count
    technicians_absent = sum(
        1 for t in technicians if t["presence_status"] == TechnicianDailyPresence.STATUS_NOT_STARTED
    )
    stats = {
        "planned": planned_count,
        "active": active_count,
        "completed": completed_today_count,
        "pending": pending_count,
        "technicians_on_site": len(technicians),
        "technicians_absent": technicians_absent,
        "progress_pct": round((completed_today_count / planned_count) * 100) if planned_count else 0,
    }

    return {"technicians": technicians, "pool": pool_data, "stats": stats}


class OperationsBoardView(APIView):
    """GET /api/operations/board/?site=<id> — omita `site` (ou use
    `site=all`) pra ver todos os sites de uma vez."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None
        return Response(build_board_data(site_id))


def build_timeline_data(site_id, date):
    """Monta os mesmos dados de OperationsTimelineView.get() — extraído à
    parte pra ser reaproveitado pela view de "print" (bot do WhatsApp)."""
    is_today = date == timezone.localdate()

    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    if site_id:
        collaborators_qs = collaborators_qs.filter(sites=site_id)

    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, date)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)

    technicians = []
    for collaborator in collaborators_qs:
        tasks = (
            ProjectTask.objects.filter(collaborators=collaborator)
            .filter(
                Q(actual_start__date=date)
                | Q(planned_start__date=date)
                | Q(status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
            )
            .select_related("project", "task")
            .distinct()
            .order_by("planned_start", "actual_start")
        )
        blocks = [
            {
                "id": t.id,
                "name": t.display_name,
                "project_name": t.project.name,
                "status": t.status,
                "planned_start": t.planned_start,
                "planned_end": t.planned_end,
                "actual_start": t.actual_start,
                "actual_end": t.actual_end,
                "estimated_hours": t.estimated_hours,
            }
            for t in tasks
        ]
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name,
                "site_name": _site_label(collaborator),
                "blocks": blocks,
                "queue": _queue_data(collaborator) if is_today else [],
                "status_events": status_events_by_collaborator.get(collaborator.id, []),
                "pair_partner": pair_partner_by_collaborator.get(collaborator.id),
            }
        )

    return {"date": date.isoformat(), "is_today": is_today, "technicians": technicians}


class OperationsTimelineView(APIView):
    """GET /api/operations/timeline/?site=<id>&date=<YYYY-MM-DD, opcional>

    Uma linha por técnico do site, com os blocos (ProjectTask) relevantes
    pro dia: tarefas com início real ou previsto naquele dia, mais qualquer
    tarefa que esteja em execução/pausada agora (mesmo se começou antes) —
    pra não "sumir" um bloco que ainda está rodando."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        date_param = request.query_params.get("date")
        date = parse_date(date_param) if date_param else timezone.localdate()
        if date is None:
            date = timezone.localdate()

        return Response(build_timeline_data(site_id, date))


def _presence_durations_by_collaborator(collaborator_ids, date_from, date_to, now):
    """Reconstrói, a partir do histórico de TechnicianStatusEvent, quantas
    horas cada técnico passou em cada status no intervalo — cada evento vale
    até o próximo (ou até `now`/fim do dia, se for o último do dia). Usado
    tanto pros indicadores de HOJE quanto pro gráfico mensal."""
    events = TechnicianStatusEvent.objects.filter(
        collaborator_id__in=collaborator_ids, date__gte=date_from, date__lte=date_to
    ).order_by("collaborator_id", "date", "changed_at")
    grouped = {}
    for e in events:
        grouped.setdefault((e.collaborator_id, e.date), []).append(e)

    today = timezone.localdate()
    totals = {}
    for (collaborator_id, date), evs in grouped.items():
        if date == today:
            day_end = now
        else:
            day_end = timezone.make_aware(datetime.combine(date, datetime.max.time()))
        per_status = totals.setdefault(collaborator_id, {})
        for i, ev in enumerate(evs):
            end = evs[i + 1].changed_at if i + 1 < len(evs) else day_end
            seconds = (end - ev.changed_at).total_seconds()
            if seconds <= 0:
                continue
            per_status[ev.status] = per_status.get(ev.status, 0.0) + seconds / 3600
    return totals


def _log_entries(collaborator_ids, date, limit=60):
    """Feed de eventos do dia pra exibição — combina despachos
    (ProjectTaskAssignment.dispatched_at), início/fim real de tarefa
    (ProjectTask.actual_start/actual_end) e trocas de status
    (TechnicianStatusEvent), numa lista só ordenada por horário. Evita
    duplicar sinal: "in_progress" no histórico de status é ignorado (já vira
    'iniciou atividade' via actual_start, com timestamp mais confiável), e
    'ficou disponível' logo após uma conclusão também é descartado (já virou
    'concluiu atividade')."""
    collaborator_ids = set(collaborator_ids)
    entries = []

    dispatches = ProjectTaskAssignment.objects.filter(
        collaborator_id__in=collaborator_ids, dispatched_at__date=date
    ).select_related("project_task__task", "collaborator__person")
    for a in dispatches:
        entries.append({"at": a.dispatched_at, "name": a.collaborator.person.name, "text": f"foi despachado → {a.project_task.display_name}"})

    tasks = (
        ProjectTask.objects.filter(assignments__collaborator_id__in=collaborator_ids)
        .filter(Q(actual_start__date=date) | Q(actual_end__date=date))
        .distinct()
        .prefetch_related("assignments__collaborator__person")
    )
    completion_marks = {}
    for t in tasks:
        for a in t.assignments.all():
            if a.collaborator_id not in collaborator_ids:
                continue
            name = a.collaborator.person.name
            if t.actual_start and t.actual_start.date() == date:
                entries.append({"at": t.actual_start, "name": name, "text": f"iniciou atividade → {t.display_name}"})
            if t.actual_end and t.actual_end.date() == date:
                entries.append({"at": t.actual_end, "name": name, "text": f"concluiu atividade → {t.display_name}"})
                completion_marks.setdefault(a.collaborator_id, []).append(t.actual_end)

    events = (
        TechnicianStatusEvent.objects.filter(collaborator_id__in=collaborator_ids, date=date)
        .select_related("collaborator__person")
        .order_by("collaborator_id", "changed_at")
    )
    by_collaborator = {}
    for e in events:
        by_collaborator.setdefault(e.collaborator_id, []).append(e)

    for collaborator_id, evs in by_collaborator.items():
        name = evs[0].collaborator.person.name
        for i, ev in enumerate(evs):
            if ev.status == TechnicianDailyPresence.STATUS_IN_PROGRESS:
                continue
            if i == 0:
                entries.append({"at": ev.changed_at, "name": name, "text": "realizou check-in"})
                continue
            if ev.status == TechnicianDailyPresence.STATUS_AVAILABLE:
                near_completion = any(
                    abs((ev.changed_at - t).total_seconds()) < 5 for t in completion_marks.get(collaborator_id, [])
                )
                if near_completion:
                    continue
                prev_status = evs[i - 1].status
                text = (
                    "pausou a atividade atual"
                    if prev_status == TechnicianDailyPresence.STATUS_IN_PROGRESS
                    else "ficou disponível"
                )
                entries.append({"at": ev.changed_at, "name": name, "text": text})
            else:
                entries.append({"at": ev.changed_at, "name": name, "text": f"ficou {ev.get_status_display()}"})

    entries.sort(key=lambda e: e["at"])
    if limit:
        entries = entries[-limit:]
    return entries


class OperationsReportsView(APIView):
    """GET /api/operations/reports/?site=<id|all>&date_from=&date_to=

    Indicadores agregados no período (padrão: últimos 30 dias): desempenho
    por técnico (horas trabalhadas, jornada via check-in/check-out,
    utilização) e tempo por tipo de atividade (execuções, tempo médio,
    melhor tempo) — calculado só a partir de ProjectTask concluída e
    TechnicianDailyPresence, sem depender de nenhuma tabela de log
    dedicada (não existe uma ainda)."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        today = timezone.localdate()
        date_from = parse_date(request.query_params.get("date_from") or "") or (today - timedelta(days=29))
        date_to = parse_date(request.query_params.get("date_to") or "") or today

        tasks_qs = ProjectTask.objects.filter(
            status=ProjectTask.STATUS_COMPLETED, actual_end__date__gte=date_from, actual_end__date__lte=date_to
        ).select_related("project", "task").prefetch_related("assignments__collaborator__person")
        if site_id:
            tasks_qs = tasks_qs.filter(project__site_id=site_id)

        tech_stats = {}
        activity_stats = {}

        for task in tasks_qs:
            hours = task.worked_hours
            key = task.task_id or f"custom:{task.custom_name}"
            activity = activity_stats.setdefault(key, {"name": task.display_name, "executions": 0, "hours": []})
            activity["executions"] += 1
            activity["hours"].append(hours)

            for assignment in task.assignments.all():
                collaborator = assignment.collaborator
                entry = tech_stats.setdefault(
                    collaborator.id,
                    {"name": collaborator.person.name, "site_name": _site_label(collaborator), "worked_hours": 0.0, "completed_count": 0},
                )
                entry["worked_hours"] += hours
                entry["completed_count"] += 1

        # Jornada é fixa (STANDARD_WORKDAY_HOURS por dia efetivamente
        # trabalhado), não a duração real entre check-in e check-out — o
        # técnico pode esquecer de marcar Fim de Expediente, ou sair e
        # voltar várias vezes, o que distorceria a duração real. "Dia
        # trabalhado" = teve check-in (checked_in_at preenchido) naquele dia.
        presence_qs = TechnicianDailyPresence.objects.filter(date__gte=date_from, date__lte=date_to, checked_in_at__isnull=False)
        if site_id:
            presence_qs = presence_qs.filter(collaborator__sites=site_id)
        days_worked = {}
        for row in presence_qs.values_list("collaborator_id", flat=True):
            days_worked[row] = days_worked.get(row, 0) + 1
        journey_hours = {
            collaborator_id: count * TechnicianDailyPresence.STANDARD_WORKDAY_HOURS
            for collaborator_id, count in days_worked.items()
        }

        technicians = []
        for collaborator_id, entry in tech_stats.items():
            journey = journey_hours.get(collaborator_id, 0.0)
            utilization_pct = round((entry["worked_hours"] / journey) * 100) if journey > 0 else None
            technicians.append(
                {
                    "id": collaborator_id,
                    "name": entry["name"],
                    "site_name": entry["site_name"],
                    "worked_hours": round(entry["worked_hours"], 2),
                    "completed_count": entry["completed_count"],
                    "journey_hours": round(journey, 2),
                    "utilization_pct": utilization_pct,
                }
            )
        technicians.sort(key=lambda t: -t["worked_hours"])

        activities = []
        for activity in activity_stats.values():
            hrs = activity["hours"]
            activities.append(
                {
                    "name": activity["name"],
                    "executions": activity["executions"],
                    "avg_hours": round(sum(hrs) / len(hrs), 2) if hrs else 0,
                    "best_hours": round(min(hrs), 2) if hrs else 0,
                }
            )
        activities.sort(key=lambda a: -a["executions"])

        total_worked = sum(t["worked_hours"] for t in technicians)
        total_journey = sum(t["journey_hours"] for t in technicians)
        stats = {
            "avg_utilization_pct": round((total_worked / total_journey) * 100) if total_journey > 0 else 0,
            "productive_hours": round(total_worked, 1),
            "completed_count": tasks_qs.count(),
        }

        # Indicadores de HOJE e do MÊS — independem do filtro de período
        # acima (esse é sobre "Desempenho por Técnico"/"Tempo por Atividade"
        # no range escolhido; estes são sempre hoje/mês corrente), calculados
        # a partir do histórico de TechnicianStatusEvent.
        now = timezone.now()
        month_start = today.replace(day=1)
        collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person")
        if site_id:
            collaborators_qs = collaborators_qs.filter(sites=site_id)
        collaborators_by_id = {c.id: c for c in collaborators_qs}
        collaborator_ids = list(collaborators_by_id.keys())

        today_totals = _presence_durations_by_collaborator(collaborator_ids, today, today, now)
        today_productive_hours = sum(d.get(TechnicianDailyPresence.STATUS_IN_PROGRESS, 0.0) for d in today_totals.values())
        unproductive_statuses = (
            TechnicianDailyPresence.STATUS_AVAILABLE,
            TechnicianDailyPresence.STATUS_SITE_BLOCKED,
            TechnicianDailyPresence.STATUS_AWAITING_RELEASE,
        )
        today_unproductive_hours = sum(
            d.get(s, 0.0) for d in today_totals.values() for s in unproductive_statuses
        )
        completed_month_qs = ProjectTask.objects.filter(
            status=ProjectTask.STATUS_COMPLETED, actual_end__date__gte=month_start, actual_end__date__lte=today
        )
        if site_id:
            completed_month_qs = completed_month_qs.filter(project__site_id=site_id)
        stats["today_productive_hours"] = round(today_productive_hours, 1)
        stats["today_unproductive_hours"] = round(today_unproductive_hours, 1)
        stats["completed_this_month"] = completed_month_qs.count()

        checked_in_today = set(
            TechnicianDailyPresence.objects.filter(
                date=today, checked_in_at__isnull=False, collaborator_id__in=collaborator_ids
            ).values_list("collaborator_id", flat=True)
        )
        today_technicians = []
        for collaborator_id, durations in today_totals.items():
            collaborator = collaborators_by_id.get(collaborator_id)
            if collaborator is None:
                continue
            journey = TechnicianDailyPresence.STANDARD_WORKDAY_HOURS if collaborator_id in checked_in_today else 0.0
            active = durations.get(TechnicianDailyPresence.STATUS_IN_PROGRESS, 0.0)
            available = durations.get(TechnicianDailyPresence.STATUS_AVAILABLE, 0.0)
            breaks = durations.get(TechnicianDailyPresence.STATUS_LUNCH, 0.0) + durations.get(
                TechnicianDailyPresence.STATUS_PERSONAL, 0.0
            )
            today_technicians.append(
                {
                    "id": collaborator_id,
                    "name": collaborator.person.name,
                    "site_name": _site_label(collaborator),
                    "journey_hours": round(journey, 2),
                    "active_hours": round(active, 2),
                    "available_hours": round(available, 2),
                    "break_hours": round(breaks, 2),
                    "utilization_pct": round((active / journey) * 100) if journey > 0 else None,
                }
            )
        today_technicians.sort(key=lambda t: -t["active_hours"])

        # "Horas Improdutivas por Motivo" usa os status REAIS do sistema
        # (Disponível/Sem Acesso ao Site/Aguardando Liberações — os
        # classificados como improdutivos em TechnicianDailyPresence.
        # PRESENCE_PRODUCTIVITY), não uma taxonomia separada de motivos de
        # bloqueio (material/acesso/cliente/EHS) — essa taxonomia não existe
        # no sistema ainda, ver nota em dispatch/models.py.
        month_totals = _presence_durations_by_collaborator(collaborator_ids, month_start, today, now)
        status_display_map = dict(TechnicianDailyPresence.STATUS_CHOICES)
        unproductive_hours_by_status = {}
        for durations in month_totals.values():
            for status in unproductive_statuses:
                if durations.get(status):
                    unproductive_hours_by_status[status] = unproductive_hours_by_status.get(status, 0.0) + durations[status]
        unproductive_by_reason = sorted(
            (
                {"status": status, "status_display": status_display_map[status], "hours": round(hours, 1)}
                for status, hours in unproductive_hours_by_status.items()
                if round(hours, 1) > 0
            ),
            key=lambda r: -r["hours"],
        )

        log_entries = [
            {"at": e["at"].isoformat(), "name": e["name"], "text": e["text"]}
            for e in _log_entries(collaborator_ids, today)
        ]

        return Response(
            {
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
                "stats": stats,
                "technicians": technicians,
                "activities": activities,
                "today_technicians": today_technicians,
                "unproductive_by_reason": unproductive_by_reason,
                "log_entries": log_entries,
            }
        )
