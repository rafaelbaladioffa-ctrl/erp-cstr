"""Agregações do módulo Relatórios e Indicadores (GET /api/operations/reports/).

Regras de negócio documentadas em docs/features/relatorios-v2.md (RN-xx
citadas abaixo). Resumo das definições:

- HH (homem-hora) = soma das horas reais de cada técnico, descontando
  pausas (ProjectTaskAssignment.actual_hours / ProjectTask.real_man_hours).
  Nunca "duração da tarefa × nº de técnicos" (RN-01).
- Duração = ProjectTask.actual_hours (relógio, sem pausas da tarefa) (RN-02).
- Horas produtivas do técnico = tempo em status de presença "Em Execução"
  (TechnicianStatusEvent), contado uma única vez mesmo com tarefas
  paralelas; fallback por assignment em dias sem esse status (RN-04).
- Improdutivo em duas categorias: bloqueio externo (site/cliente) e ocioso
  interno (disponível sem tarefa) (RN-11).
- Base de estimativa por Atividade do catálogo × família de cabo, com
  mediana de HH por unidade e amostra mínima (RN-16 a RN-21).
"""

import statistics
from datetime import datetime, time, timedelta

from django.utils import timezone

from core.models import Collaborator

from core.collaborator_scope import managed_collaborator_ids, scope_collaborators, supervisor_project_ids
from dispatch.models import TechnicianDailyPresence, TechnicianStatusEvent
from projects.models import ProjectTask, ProjectTaskAssignment

MAX_PERIOD_DAYS = 180
# Jornada + almoço: corte do último status de um dia sem "Fim de Expediente" (RN-09).
INCOMPLETE_DAY_CUTOFF_HOURS = TechnicianDailyPresence.STANDARD_WORKDAY_HOURS + 1
MIN_SAMPLE_SIZE = 5  # RN-21
TODAY_PRODUCTIVE_TARGET_HOURS = 6  # meta diária por técnico (RN-13)
INTERNAL_IDLE_LIMIT_HOURS = 0.5  # limite de ocioso interno por técnico por dia (RN-26)

EXTERNAL_BLOCK_STATUSES = (
    TechnicianDailyPresence.STATUS_SITE_BLOCKED,
    TechnicianDailyPresence.STATUS_AWAITING_RELEASE,
)
INTERNAL_IDLE_STATUSES = (TechnicianDailyPresence.STATUS_AVAILABLE,)
# Tempo produtivo: execução de tarefa + apoio a outro técnico.
PRODUCTIVE_STATUSES = (
    TechnicianDailyPresence.STATUS_IN_PROGRESS,
    TechnicianDailyPresence.STATUS_SUPPORT,
)
METER_UNITS = {"m", "M", "METER", "METERS", "METRO", "METROS", "MT", "MTS"}


def utilization_band(pct):
    """Faixas de utilização (RN-08). Acima de 100% é dado suspeito, não sobrecarga."""
    if pct is None:
        return None
    if pct > 100:
        return "suspect"
    if pct >= 70:
        return "normal"
    if pct >= 50:
        return "attention"
    return "low"


def _pct(numerator, denominator):
    return round((numerator / denominator) * 100) if denominator else None


def _local_date(value):
    return timezone.localtime(value).date() if timezone.is_aware(value) else value.date()


def presence_durations(collaborator_ids, date_from, date_to, now):
    """Reconstrói, a partir de TechnicianStatusEvent, as horas por status de
    cada técnico em cada dia — cada evento vale até o próximo.

    Último evento do dia (RN-09):
    - dia corrente: vai até `now`;
    - "Fim de Expediente": irrelevante (não entra em nenhum indicador);
    - "Em Execução" (execução de fato — pausar volta a presença para
      "Disponível"): sem corte, vai até a meia-noite;
    - qualquer outro status: corta em check-in + 9h (ou meia-noite, o que
      vier primeiro) e o dia é marcado como incompleto.

    Retorna ({(collaborator_id, date): {status: horas}}, {collaborator_id: dias_incompletos}).
    """
    events = TechnicianStatusEvent.objects.filter(
        collaborator_id__in=collaborator_ids, date__gte=date_from, date__lte=date_to
    ).order_by("collaborator_id", "date", "changed_at")
    grouped = {}
    for e in events:
        grouped.setdefault((e.collaborator_id, e.date), []).append(e)

    checked_in = dict(
        (
            (collaborator_id, day),
            checked_in_at,
        )
        for collaborator_id, day, checked_in_at in TechnicianDailyPresence.objects.filter(
            collaborator_id__in=collaborator_ids, date__gte=date_from, date__lte=date_to, checked_in_at__isnull=False
        ).values_list("collaborator_id", "date", "checked_in_at")
    )

    today = timezone.localdate()
    per_day = {}
    incomplete_days = {}
    for (collaborator_id, day), evs in grouped.items():
        last = evs[-1]
        if day == today:
            day_end = now
        else:
            day_end = timezone.make_aware(datetime.combine(day + timedelta(days=1), time.min))
            if last.status not in (TechnicianDailyPresence.STATUS_OFF_DUTY, TechnicianDailyPresence.STATUS_IN_PROGRESS):
                start_of_day = checked_in.get((collaborator_id, day)) or evs[0].changed_at
                day_end = min(day_end, start_of_day + timedelta(hours=INCOMPLETE_DAY_CUTOFF_HOURS))
                incomplete_days[collaborator_id] = incomplete_days.get(collaborator_id, 0) + 1
        per_status = per_day.setdefault((collaborator_id, day), {})
        for i, ev in enumerate(evs):
            end = evs[i + 1].changed_at if i + 1 < len(evs) else day_end
            seconds = (end - ev.changed_at).total_seconds()
            if seconds <= 0:
                continue
            per_status[ev.status] = per_status.get(ev.status, 0.0) + seconds / 3600
    return per_day, incomplete_days


def _sum_statuses(durations, statuses):
    return sum(durations.get(s, 0.0) for s in statuses)


def _activity_quantity(task, generated):
    for value in (task.quantity_planned, generated.quantity, generated.scope_item.quantity):
        if value is not None and float(value) > 0:
            return float(value)
    return None


def _activity_unit(generated):
    return generated.activity.default_unit or generated.unit or generated.scope_item.unit or ""


def _distribution(values):
    if not values:
        return None
    if len(values) == 1:
        q1 = q3 = values[0]
    else:
        q1, _, q3 = statistics.quantiles(values, n=4, method="inclusive")
    mean = statistics.fmean(values)
    # Desvio padrão AMOSTRAL (n−1): as execuções são uma amostra do que a atividade
    # costuma gastar. Com uma só execução não há dispersão (0).
    std_dev = statistics.stdev(values) if len(values) > 1 else 0.0
    return {
        "median": round(statistics.median(values), 4),
        "p25": round(q1, 4),
        "p75": round(q3, 4),
        "mean": round(mean, 4),
        "std_dev": round(std_dev, 4),
        # Coeficiente de variação = desvio ÷ média: compara variabilidade entre atividades de escalas diferentes.
        "cv_pct": round(std_dev / mean * 100, 1) if mean else None,
    }


def build_operations_reports(*, site_id, date_from, date_to, log_entries_fn, user=None):
    now = timezone.now()
    today = timezone.localdate()
    # Supervisor: só tarefas dos projetos em que é Responsável CSTR (técnicos já são limitados à sua equipe).
    project_ids = supervisor_project_ids(user)

    # Conclusões do período são POR TÉCNICO (cada um conclui a própria parte,
    # mesmo que a tarefa só feche depois). Ajuste do admin, sem fim registrado
    # pelo técnico, não entra nos indicadores de técnico.
    completed_qs = ProjectTaskAssignment.objects.filter(
        status=ProjectTask.STATUS_COMPLETED, assignment_end__date__gte=date_from, assignment_end__date__lte=date_to
    ).select_related("collaborator__person", "project_task__project")
    if project_ids is not None:
        completed_qs = completed_qs.filter(project_task__project_id__in=project_ids)
    if site_id:
        completed_qs = completed_qs.filter(project_task__project__site_id=site_id)
    completed_assignments = list(completed_qs)

    # Tarefas fechadas no período (todos os técnicos concluíram): base da
    # estimativa por atividade (RN-16..21), uma execução completa por tarefa.
    tasks_qs = (
        ProjectTask.objects.filter(
            status=ProjectTask.STATUS_COMPLETED, actual_end__date__gte=date_from, actual_end__date__lte=date_to
        )
        .select_related(
            "project",
            "task",
            "generated_task__activity",
            "generated_task__scope_item__cable_family",
        )
        .prefetch_related("assignments__collaborator__person", "assignments__collaborator__sites")
    )
    if project_ids is not None:
        tasks_qs = tasks_qs.filter(project_id__in=project_ids)
    if site_id:
        tasks_qs = tasks_qs.filter(project__site_id=site_id)
    tasks = list(tasks_qs)

    # --- HH por técnico (RN-01, RN-03, RN-05) -----------------------------
    tech = {}
    # Horas por assignment indexadas por (técnico, dia do término) — usadas
    # como fallback de horas produtivas em dias sem status "Em Execução".
    assignment_hours_by_day = {}
    activity_groups = {}
    excluded_no_catalog = 0
    tracked_completed = 0

    def tech_entry(collaborator):
        return tech.setdefault(
            collaborator.id,
            {"collaborator": collaborator, "man_hours": 0.0, "completed_count": 0, "untracked_count": 0},
        )

    for assignment in completed_assignments:
        entry = tech_entry(assignment.collaborator)
        entry["completed_count"] += 1
        task = assignment.project_task
        if assignment.actual_hours is not None:
            hours = float(assignment.actual_hours)
        elif assignment.assignment_start is None and task.has_real_time_tracking:
            # Dado histórico (anterior ao rastreamento por técnico): duração da tarefa.
            hours = task.worked_hours
        else:
            hours = None
        if hours is None:
            entry["untracked_count"] += 1
            continue
        tracked_completed += 1
        entry["man_hours"] += hours
        if hours > 0:
            key = (assignment.collaborator_id, _local_date(assignment.assignment_end))
            assignment_hours_by_day[key] = assignment_hours_by_day.get(key, 0.0) + hours

    for task in tasks:
        assignments = list(task.assignments.all())
        has_assignment_hours = any(a.actual_hours is not None for a in assignments)
        if has_assignment_hours:
            task_man_hours = sum(float(a.actual_hours) for a in assignments if a.actual_hours is not None)
            crew = sum(1 for a in assignments if a.actual_hours is not None and float(a.actual_hours) > 0)
        elif task.has_real_time_tracking:
            # Dado histórico sem rastreamento por assignment: duração × equipe.
            crew = len(assignments)
            task_man_hours = task.worked_hours * crew
        else:
            crew = 0
            task_man_hours = 0.0

        # --- Base de estimativa por atividade × família de cabo (RN-16..21)
        generated = task.generated_task
        if generated is None:
            excluded_no_catalog += 1
            continue
        family = generated.scope_item.cable_family
        group_key = (generated.activity_id, family.pk if family else None)
        group = activity_groups.setdefault(
            group_key,
            {
                "activity": generated.activity,
                "family": family,
                "unit": _activity_unit(generated),
                "executions_total": 0,
                "excluded": {"untracked": 0, "partial_or_blocked": 0, "no_quantity": 0},
                "man_hours": [],
                "durations": [],
                "crews": [],
                "hh_per_unit": [],
                "hh_per_meter": [],
                "total_quantity": 0.0,
                "total_meters": 0.0,
            },
        )
        group["executions_total"] += 1
        if task.completion_outcome not in ("", ProjectTask.COMPLETION_OUTCOME_COMPLETED):
            group["excluded"]["partial_or_blocked"] += 1
            continue
        if not task.has_real_time_tracking or task_man_hours <= 0:
            group["excluded"]["untracked"] += 1
            continue
        quantity = _activity_quantity(task, generated)
        if not quantity:
            group["excluded"]["no_quantity"] += 1
            continue
        group["man_hours"].append(task_man_hours)
        group["durations"].append(task.worked_hours)
        group["crews"].append(crew)
        group["hh_per_unit"].append(task_man_hours / quantity)
        group["total_quantity"] += quantity
        length_m = generated.scope_item.length_m
        if length_m and float(length_m) > 0 and group["unit"].strip() not in METER_UNITS:
            meters = quantity * float(length_m)
            group["hh_per_meter"].append(task_man_hours / meters)
            group["total_meters"] += meters

    # Supervisor só enxerga os colaboradores sob a sua gestão.
    allowed_ids = managed_collaborator_ids(user)
    if allowed_ids is not None:
        tech = {k: v for k, v in tech.items() if k in allowed_ids}

    # --- Técnicos do período: quem concluiu tarefa OU teve check-in -------
    presence_qs = TechnicianDailyPresence.objects.filter(
        date__gte=date_from, date__lte=date_to, checked_in_at__isnull=False
    )
    if site_id:
        presence_qs = presence_qs.filter(collaborator__sites=site_id)
    if allowed_ids is not None:
        presence_qs = presence_qs.filter(collaborator_id__in=allowed_ids)
    days_worked = {}
    for collaborator_id in presence_qs.values_list("collaborator_id", flat=True):
        days_worked[collaborator_id] = days_worked.get(collaborator_id, 0) + 1

    missing_ids = set(days_worked) - set(tech)
    if missing_ids:
        for collaborator in Collaborator.objects.filter(pk__in=missing_ids).select_related("person").prefetch_related("sites"):
            tech_entry(collaborator)

    collaborator_ids = list(tech)
    per_day, incomplete_days = presence_durations(collaborator_ids, date_from, date_to, now)

    productive = {}
    external_block = {}
    internal_idle = {}
    days_with_execution = set()
    for (collaborator_id, day), durations in per_day.items():
        in_progress = _sum_statuses(durations, PRODUCTIVE_STATUSES)
        if in_progress > 0:
            days_with_execution.add((collaborator_id, day))
        productive[collaborator_id] = productive.get(collaborator_id, 0.0) + in_progress
        external_block[collaborator_id] = external_block.get(collaborator_id, 0.0) + _sum_statuses(
            durations, EXTERNAL_BLOCK_STATUSES
        )
        internal_idle[collaborator_id] = internal_idle.get(collaborator_id, 0.0) + _sum_statuses(
            durations, INTERNAL_IDLE_STATUSES
        )
    # Fallback RN-04: dia sem tempo "Em Execução" nos eventos (ex.: tarefa
    # iniciada/concluída pela coordenação) usa as horas do assignment,
    # limitadas à jornada do dia.
    for (collaborator_id, day), hours in assignment_hours_by_day.items():
        if collaborator_id in tech and (collaborator_id, day) not in days_with_execution:
            productive[collaborator_id] = productive.get(collaborator_id, 0.0) + min(
                hours, TechnicianDailyPresence.STANDARD_WORKDAY_HOURS
            )

    technicians = []
    for collaborator_id, entry in tech.items():
        collaborator = entry["collaborator"]
        journey = days_worked.get(collaborator_id, 0) * TechnicianDailyPresence.STANDARD_WORKDAY_HOURS
        productive_hours = round(productive.get(collaborator_id, 0.0), 2)
        utilization = _pct(productive_hours, journey)
        idle_hours = internal_idle.get(collaborator_id, 0.0)
        worked_days = days_worked.get(collaborator_id, 0)
        idle_per_day = round(idle_hours / worked_days, 2) if worked_days else None
        completed = entry["completed_count"]
        technicians.append(
            {
                "id": collaborator_id,
                "name": collaborator.person.name,
                "site_name": ", ".join(s.name for s in collaborator.sites.all()) or "—",
                "productive_hours": productive_hours,
                "worked_hours": productive_hours,  # compatibilidade com o frontend v1
                "man_hours": round(entry["man_hours"], 2),
                "journey_hours": round(journey, 2),
                "utilization_pct": utilization,
                "utilization_band": utilization_band(utilization),
                "completed_count": completed,
                "untracked_count": entry["untracked_count"],
                "tracking_rate_pct": _pct(completed - entry["untracked_count"], completed),
                "external_block_hours": round(external_block.get(collaborator_id, 0.0), 2),
                "internal_idle_hours": round(idle_hours, 2),
                "internal_idle_avg_per_day": idle_per_day,
                "idle_limit_exceeded": idle_per_day is not None and idle_per_day > INTERNAL_IDLE_LIMIT_HOURS,
                "incomplete_days": incomplete_days.get(collaborator_id, 0),
            }
        )
    technicians.sort(key=lambda t: (t["utilization_pct"] is None, t["utilization_pct"] or 0, t["name"]))

    # --- Produtividade por atividade -------------------------------------
    activity_productivity = []
    for group in activity_groups.values():
        used = len(group["man_hours"])
        sufficient = used >= MIN_SAMPLE_SIZE
        family = group["family"]
        hh_per_meter = None
        if sufficient and group["hh_per_meter"]:
            hh_per_meter = _distribution(group["hh_per_meter"])
            hh_per_meter["total_meters"] = round(group["total_meters"], 2)
        activity_productivity.append(
            {
                "activity_code": group["activity"].code,
                "activity_name": group["activity"].name,
                "cable_family_code": family.code if family else None,
                "cable_family_name": family.name if family else None,
                "unit": group["unit"],
                "executions_total": group["executions_total"],
                "executions_used": used,
                "excluded": group["excluded"],
                "sufficient_sample": sufficient,
                "median_man_hours": round(statistics.median(group["man_hours"]), 2) if used else None,
                "median_duration_hours": round(statistics.median(group["durations"]), 2) if used else None,
                "avg_crew_size": round(sum(group["crews"]) / used, 1) if used else None,
                "total_quantity": round(group["total_quantity"], 2),
                "hh_per_unit": _distribution(group["hh_per_unit"]) if sufficient else None,
                "hh_per_meter": hh_per_meter,
            }
        )
    activity_productivity.sort(key=lambda a: (-a["executions_total"], a["activity_name"]))

    # Lista legada (v1) — mantida durante a transição do frontend.
    legacy_activities = [
        {
            "name": f'{a["activity_name"]} — {a["cable_family_name"]}' if a["cable_family_name"] else a["activity_name"],
            "executions": a["executions_total"],
            "avg_hours": a["median_man_hours"] or 0,
            "best_hours": a["hh_per_unit"]["p25"] if a["hh_per_unit"] else 0,
            "ignored_count": a["executions_total"] - a["executions_used"],
        }
        for a in activity_productivity
    ]

    # --- Improdutivo do período por motivo (RN-11, RN-14) ----------------
    status_display = dict(TechnicianDailyPresence.STATUS_CHOICES)
    by_status = {}
    for durations in per_day.values():
        for status in EXTERNAL_BLOCK_STATUSES + INTERNAL_IDLE_STATUSES:
            if durations.get(status):
                by_status[status] = by_status.get(status, 0.0) + durations[status]
    unproductive_by_reason = sorted(
        (
            {
                "status": status,
                "status_display": status_display[status],
                "category": "external" if status in EXTERNAL_BLOCK_STATUSES else "internal",
                "hours": round(hours, 1),
            }
            for status, hours in by_status.items()
            if round(hours, 1) > 0
        ),
        key=lambda r: -r["hours"],
    )

    total_productive = sum(t["productive_hours"] for t in technicians)
    total_journey = sum(t["journey_hours"] for t in technicians)
    utilization_total = _pct(total_productive, total_journey)

    # --- Bloco "Hoje" (independe do filtro de período, RN-14) ------------
    today_collaborators = Collaborator.objects.filter(is_active=True).select_related("person").prefetch_related("sites")
    today_collaborators = scope_collaborators(today_collaborators, user)
    if site_id:
        today_collaborators = today_collaborators.filter(sites=site_id)
    today_by_id = {c.id: c for c in today_collaborators}
    today_ids = list(today_by_id)
    today_per_day, _ = presence_durations(today_ids, today, today, now)
    checked_in_today = set(
        TechnicianDailyPresence.objects.filter(
            date=today, checked_in_at__isnull=False, collaborator_id__in=today_ids
        ).values_list("collaborator_id", flat=True)
    )
    today_technicians = []
    for (collaborator_id, _day), durations in today_per_day.items():
        collaborator = today_by_id.get(collaborator_id)
        if collaborator is None:
            continue
        journey = TechnicianDailyPresence.STANDARD_WORKDAY_HOURS if collaborator_id in checked_in_today else 0.0
        active = _sum_statuses(durations, PRODUCTIVE_STATUSES)
        available = durations.get(TechnicianDailyPresence.STATUS_AVAILABLE, 0.0)
        breaks = _sum_statuses(
            durations,
            (
                TechnicianDailyPresence.STATUS_LUNCH,
                TechnicianDailyPresence.STATUS_PERSONAL,
                TechnicianDailyPresence.STATUS_MEAL,
                TechnicianDailyPresence.STATUS_MEETING,
                TechnicianDailyPresence.STATUS_TRAVELING,
            ),
        )
        blocked = _sum_statuses(durations, EXTERNAL_BLOCK_STATUSES)
        utilization = _pct(active, journey)
        today_technicians.append(
            {
                "id": collaborator_id,
                "name": collaborator.person.name,
                "site_name": ", ".join(s.name for s in collaborator.sites.all()) or "—",
                "journey_hours": round(journey, 2),
                "active_hours": round(active, 2),
                "available_hours": round(available, 2),
                "internal_idle_hours": round(available, 2),
                "idle_limit_exceeded": available > INTERNAL_IDLE_LIMIT_HOURS,
                "break_hours": round(breaks, 2),
                "unproductive_hours": round(blocked, 2),  # compatibilidade v1 (= bloqueio externo)
                "external_block_hours": round(blocked, 2),
                "utilization_pct": utilization,
                "utilization_band": utilization_band(utilization),
            }
        )
    today_technicians.sort(key=lambda t: -t["active_hours"])
    today_productive = sum(t["active_hours"] for t in today_technicians)
    today_block = sum(t["external_block_hours"] for t in today_technicians)
    today_idle = sum(t["internal_idle_hours"] for t in today_technicians)
    n_checked_in = len(checked_in_today)

    month_start = today.replace(day=1)
    completed_month_qs = ProjectTaskAssignment.objects.filter(
        status=ProjectTask.STATUS_COMPLETED, assignment_end__date__gte=month_start, assignment_end__date__lte=today
    )
    if project_ids is not None:
        completed_month_qs = completed_month_qs.filter(project_task__project_id__in=project_ids)
    if site_id:
        completed_month_qs = completed_month_qs.filter(project_task__project__site_id=site_id)

    stats = {
        "period_completed_count": len(completed_assignments),
        "tracked_completed_count": tracked_completed,
        "tracking_rate_pct": _pct(tracked_completed, len(completed_assignments)),
        "man_hours_total": round(sum(t["man_hours"] for t in technicians), 2),
        "productive_hours_total": round(total_productive, 2),
        "journey_hours_total": round(total_journey, 2),
        "utilization_pct": utilization_total,
        "utilization_band": utilization_band(utilization_total),
        "external_block_hours": round(sum(t["external_block_hours"] for t in technicians), 2),
        "internal_idle_hours": round(sum(t["internal_idle_hours"] for t in technicians), 2),
        "incomplete_days": sum(t["incomplete_days"] for t in technicians),
        "internal_idle_limit_hours": INTERNAL_IDLE_LIMIT_HOURS,
        "technicians_over_idle_limit": sum(1 for t in technicians if t["idle_limit_exceeded"]),
        # Campos v1 mantidos durante a transição do frontend.
        "avg_utilization_pct": utilization_total or 0,
        "productive_hours": round(total_productive, 1),
        "completed_count": len(completed_assignments),
        "today_productive_hours": round(today_productive, 1),
        "today_unproductive_hours": round(today_block + today_idle, 1),
        "completed_this_month": completed_month_qs.count(),
    }

    today_summary = {
        "technicians_checked_in": n_checked_in,
        "productive_hours_total": round(today_productive, 2),
        "productive_hours_avg_per_tech": round(today_productive / n_checked_in, 2) if n_checked_in else None,
        "productive_target_hours": TODAY_PRODUCTIVE_TARGET_HOURS,
        "external_block_hours": round(today_block, 2),
        "internal_idle_hours": round(today_idle, 2),
        "internal_idle_limit_hours": INTERNAL_IDLE_LIMIT_HOURS,
        "technicians_over_idle_limit": sum(1 for t in today_technicians if t["idle_limit_exceeded"]),
    }

    log_entries = [
        {"at": e["at"].isoformat(), "name": e["name"], "type": e["type"], "text": e["text"]}
        for e in log_entries_fn(today_ids, today, project_ids=project_ids)
    ]

    return {
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "stats": stats,
        "today": today_summary,
        "technicians": technicians,
        "activity_productivity": activity_productivity,
        "activity_excluded_no_catalog": excluded_no_catalog,
        "activities": legacy_activities,
        "today_technicians": today_technicians,
        "unproductive_by_reason": unproductive_by_reason,
        "log_entries": log_entries,
    }
