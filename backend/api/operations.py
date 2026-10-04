"""Endpoint agregado do módulo Central de Operações (MVP): o "board" de
despacho — técnicos do site com sua presença/atividade atual/fila, e o pool
de atividades pendentes do site. Somente leitura; despachar é uma action em
ProjectTaskViewSet (api/views.py), e presença tem seu próprio ViewSet
(TechnicianPresenceViewSet).
"""

from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Collaborator
from dispatch.models import CollaboratorPair, TechnicianAbsence, TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import ProjectTask, ProjectTaskAssignment

from .reports import MAX_PERIOD_DAYS, build_operations_reports
from core.collaborator_scope import scope_collaborators


class HasOperationsBoardPermission(IsAuthenticated):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        return request.user.has_perm("projects.view_projecttaskassignment")


def _current_tasks_by_collaborator(collaborator_ids):
    """Tarefas 'abertas' (em execução OU pausadas) de cada técnico, numa
    única consulta. Pode haver mais de uma por técnico: pausar uma e iniciar
    outra é permitido, então mostrar só a primeira esconderia a que está
    rodando de verdade."""
    assignments = (
        ProjectTaskAssignment.objects.filter(
            collaborator_id__in=collaborator_ids,
            project_task__status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED),
        )
        .select_related("project_task__project", "project_task__task")
        .order_by("project_task__status", "project_task__actual_start")
    )
    result = {}
    for a in assignments:
        result.setdefault(a.collaborator_id, []).append(
            {
                "id": a.project_task.id,
                "name": a.project_task.display_name,
                "project_name": a.project_task.project.name,
                "status": a.project_task.status,
                "actual_start": a.project_task.actual_start,
            }
        )
    return result


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


def _queue_by_collaborator(collaborator_ids):
    assignments = (
        ProjectTaskAssignment.objects.filter(
            collaborator_id__in=collaborator_ids, project_task__status=ProjectTask.STATUS_NOT_STARTED
        )
        .select_related("project_task__project", "project_task__task")
        .order_by("queue_order", "dispatched_at")
    )
    result = {}
    for a in assignments:
        result.setdefault(a.collaborator_id, []).append(
            {
                "task_id": a.project_task_id,
                "task_name": a.project_task.display_name,
                "project_name": a.project_task.project.name,
                "queue_order": a.queue_order,
            }
        )
    return result


def build_board_data(site_id, date=None, user=None):
    """Monta os mesmos dados de OperationsBoardView.get() — extraído à parte
    pra ser reaproveitado pela view de "print" (bot do WhatsApp), sem
    duplicar a lógica."""
    today = date or timezone.localdate()
    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    collaborators_qs = scope_collaborators(collaborators_qs, user)
    if site_id:
        collaborators_qs = collaborators_qs.filter(sites=site_id)

    presence_filter = {"date": today}
    if site_id:
        presence_filter["collaborator__sites"] = site_id
    presences = {p.collaborator_id: p for p in TechnicianDailyPresence.objects.filter(**presence_filter)}
    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, today)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)
    current_tasks_by_collaborator = _current_tasks_by_collaborator(collaborator_ids)
    queue_by_collaborator = _queue_by_collaborator(collaborator_ids)
    absences_today = {
        a.collaborator_id: a
        for a in TechnicianAbsence.objects.filter(
            collaborator_id__in=collaborator_ids, date_from__lte=today, date_to__gte=today
        )
    }

    technicians = []
    for collaborator in collaborators_qs:
        presence = presences.get(collaborator.id)
        absence = absences_today.get(collaborator.id)
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name if collaborator.person_id else str(collaborator),
                "site_name": _site_label(collaborator),
                "presence_status": "on_leave" if absence else (presence.status if presence else TechnicianDailyPresence.STATUS_NOT_STARTED),
                "presence_status_display": (
                    (absence.reason or "Férias / Ausência") if absence
                    else presence.get_status_display() if presence else "Indisponível"
                ),
                "on_leave": absence is not None,
                "leave_until": absence.date_to if absence else None,
                "checked_in_at": presence.checked_in_at if presence else None,
                "checked_out_at": presence.checked_out_at if presence else None,
                "current_tasks": current_tasks_by_collaborator.get(collaborator.id, []),
                "queue": queue_by_collaborator.get(collaborator.id, []),
                "status_events": status_events_by_collaborator.get(collaborator.id, []),
                "pair_partner": pair_partner_by_collaborator.get(collaborator.id),
            }
        )

    # Só entra no pool do dia quem tem início AGENDADO pra data — sem
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
    technicians_on_site = sum(
        1 for t in technicians
        if t["presence_status"] != TechnicianDailyPresence.STATUS_NOT_STARTED
        and not t["on_leave"]
    )
    technicians_absent = sum(
        1 for t in technicians
        if t["presence_status"] == TechnicianDailyPresence.STATUS_NOT_STARTED
        and not t["on_leave"]
    )
    stats = {
        "planned": planned_count,
        "active": active_count,
        "completed": completed_today_count,
        "pending": pending_count,
        "technicians_on_site": technicians_on_site,
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
        date_str = request.query_params.get("date")
        date = parse_date(date_str) if date_str else None
        return Response(build_board_data(site_id, date=date, user=request.user))


def build_timeline_data(site_id, date, user=None):
    """Monta os mesmos dados de OperationsTimelineView.get() — extraído à
    parte pra ser reaproveitado pela view de "print" (bot do WhatsApp)."""
    is_today = date == timezone.localdate()

    collaborators_qs = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    collaborators_qs = scope_collaborators(collaborators_qs, user)
    if site_id:
        collaborators_qs = collaborators_qs.filter(sites=site_id)

    collaborator_ids = [c.id for c in collaborators_qs]
    status_events_by_collaborator = _status_events_data(collaborator_ids, date)
    pair_partner_by_collaborator = _pair_partner_map(collaborator_ids)

    queue_by_collaborator = _queue_by_collaborator(collaborator_ids) if is_today else {}
    # Timestamps do PRÓPRIO técnico (assignment_start/assignment_end) quando
    # disponíveis, para não mostrar barras no período em que outro técnico
    # executava a tarefa e este não.
    assignments_by_collaborator = {}
    all_assignments = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=collaborator_ids)
        .select_related("project_task", "project_task__project", "project_task__task")
        .prefetch_related("project_task__assignments")
        .filter(
            Q(assignment_start__date=date)
            | Q(project_task__actual_start__date=date)
            | Q(project_task__planned_start__date=date)
            | Q(project_task__status__in=(ProjectTask.STATUS_IN_PROGRESS, ProjectTask.STATUS_PAUSED))
        )
        .order_by("project_task__planned_start", "project_task__actual_start")
    )
    for a in all_assignments:
        assignments_by_collaborator.setdefault(a.collaborator_id, []).append(a)

    technicians = []
    for collaborator in collaborators_qs:
        assignments = assignments_by_collaborator.get(collaborator.id, [])
        seen_task_ids = set()
        blocks = []
        for a in assignments:
            t = a.project_task
            if t.id in seen_task_ids:
                continue
            seen_task_ids.add(t.id)
            # Quando o assignment tem timestamps próprios, usa eles (rastreamento individual).
            # Fallback para task-level APENAS quando o técnico é o único designado —
            # se há múltiplos designados sem rastreamento por assignment, não usar os
            # timestamps da tarefa (que representam o intervalo total, não o deste técnico).
            is_sole_assignee = t.assignments.count() <= 1
            actual_start = a.assignment_start or (t.actual_start if is_sole_assignee else None)
            actual_end = a.assignment_end or (t.actual_end if is_sole_assignee else None)
            blocks.append({
                "id": t.id,
                "name": t.display_name,
                "project_name": t.project.name,
                "status": t.status,
                "planned_start": t.planned_start,
                "planned_end": t.planned_end,
                "actual_start": actual_start,
                "actual_end": actual_end,
                "estimated_hours": t.estimated_hours,
            })
        technicians.append(
            {
                "id": collaborator.id,
                "name": collaborator.person.name,
                "site_name": _site_label(collaborator),
                "blocks": blocks,
                "queue": queue_by_collaborator.get(collaborator.id, []),
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

        return Response(build_timeline_data(site_id, date, user=request.user))


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
        entries.append({"at": a.dispatched_at, "name": a.collaborator.person.name, "type": "dispatch", "text": f"foi despachado → {a.project_task.display_name}"})

    # Usa timestamps do assignment individual (assignment_start/assignment_end)
    # quando disponíveis, para refletir quando ESTE técnico iniciou/concluiu —
    # não quando qualquer outro técnico da mesma tarefa agiu.
    log_assignments = (
        ProjectTaskAssignment.objects.filter(collaborator_id__in=collaborator_ids)
        .filter(
            Q(assignment_start__date=date)
            | Q(assignment_end__date=date)
            | Q(project_task__actual_start__date=date)
            | Q(project_task__actual_end__date=date)
        )
        .select_related("project_task__task", "project_task__project", "collaborator__person")
        .distinct()
    )
    completion_marks = {}
    for a in log_assignments:
        t = a.project_task
        name = a.collaborator.person.name
        start_ts = a.assignment_start or t.actual_start
        end_ts = a.assignment_end or t.actual_end
        if start_ts and start_ts.date() == date:
            entries.append({"at": start_ts, "name": name, "type": "start", "text": f"iniciou atividade → {t.display_name}"})
        if end_ts and end_ts.date() == date:
            entries.append({"at": end_ts, "name": name, "type": "complete", "text": f"concluiu atividade → {t.display_name}"})
            completion_marks.setdefault(a.collaborator_id, []).append(end_ts)

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
                entries.append({"at": ev.changed_at, "name": name, "type": "checkin", "text": "realizou check-in"})
                continue
            if ev.status == TechnicianDailyPresence.STATUS_AVAILABLE:
                near_completion = any(
                    abs((ev.changed_at - t).total_seconds()) < 5 for t in completion_marks.get(collaborator_id, [])
                )
                if near_completion:
                    continue
                prev_status = evs[i - 1].status
                if prev_status == TechnicianDailyPresence.STATUS_IN_PROGRESS:
                    entry_type, text = "pause", "pausou a atividade atual"
                else:
                    entry_type, text = "available", "ficou disponível"
                entries.append({"at": ev.changed_at, "name": name, "type": entry_type, "text": text})
            else:
                entries.append({"at": ev.changed_at, "name": name, "type": "status", "text": f"ficou {ev.get_status_display()}"})

    entries.sort(key=lambda e: e["at"])
    if limit:
        entries = entries[-limit:]
    return entries


class OperationsReportsView(APIView):
    """GET /api/operations/reports/?site=<id|all>&date_from=&date_to=

    Relatórios e Indicadores (padrão: últimos 30 dias, máximo 180). Regras
    de negócio em docs/features/relatorios-v2.md; agregação em
    api/reports.py."""

    permission_classes = [HasOperationsBoardPermission]

    def get(self, request):
        site_id = request.query_params.get("site")
        if site_id == "all":
            site_id = None

        today = timezone.localdate()
        date_from = parse_date(request.query_params.get("date_from") or "") or (today - timedelta(days=29))
        date_to = parse_date(request.query_params.get("date_to") or "") or today
        if date_from > date_to:
            return Response({"detail": "A data inicial não pode ser posterior à data final."}, status=400)
        if (date_to - date_from).days + 1 > MAX_PERIOD_DAYS:
            return Response({"detail": f"O período máximo é de {MAX_PERIOD_DAYS} dias."}, status=400)

        return Response(
            build_operations_reports(
                site_id=site_id, date_from=date_from, date_to=date_to, log_entries_fn=_log_entries, user=request.user
            )
        )
