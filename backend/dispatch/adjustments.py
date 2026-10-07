"""Ajustes administrativos da timeline do técnico.

Diferente do ajuste de status do admin (que não registra horas), aqui o admin grava
exatamente o que o técnico gravaria — intervalos de trabalho nas tarefas e trocas de
status de presença — então as horas valem para todos os indicadores (utilização, HH,
produção, horas por status). Toda alteração exige motivo, é marcada como "ajustada"
(is_adjusted) e fica registrada em TimelineAdjustment com os valores antes e depois.
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import TechnicianDailyPresence, TechnicianStatusEvent, TimelineAdjustment

MAX_WINDOW_HOURS = 16
P = TechnicianDailyPresence
ADJUSTABLE_STATUSES = tuple(value for value, _label in P.STATUS_CHOICES if value != P.STATUS_NOT_STARTED)


class AdjustmentError(Exception):
    """Regra de negócio violada; a mensagem é mostrada ao administrador."""


def _validate_reason(reason):
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise AdjustmentError("Informe o motivo do ajuste.")
    return reason


def _validate_window(start, end):
    if end <= start:
        raise AdjustmentError("O fim precisa ser depois do início.")
    if timezone.localtime(start).date() != timezone.localtime(end).date():
        raise AdjustmentError("O trecho precisa começar e terminar no mesmo dia.")
    if end > timezone.now():
        raise AdjustmentError("Não é possível ajustar para o futuro.")
    if end - start > timedelta(hours=MAX_WINDOW_HOURS):
        raise AdjustmentError(f"O trecho não pode passar de {MAX_WINDOW_HOURS} horas.")


def _serialize_events(events):
    return [
        {"status": e.status, "changed_at": e.changed_at.isoformat(), "adjusted": e.is_adjusted} for e in events
    ]


def _day_events(collaborator, day):
    return list(TechnicianStatusEvent.objects.filter(collaborator=collaborator, date=day).order_by("changed_at", "id"))


def _apply_status_window(collaborator, start, end, status):
    """Define `status` no trecho [start, end) da linha do tempo do dia: apaga as trocas
    que caíam dentro, abre o trecho com o novo status e, no fim, volta ao status que
    valeria naquele instante. Devolve (antes, depois) já serializados."""
    day = timezone.localtime(start).date()
    events = _day_events(collaborator, day)
    before = _serialize_events(events)

    previous_status = None
    status_at_end = None
    for event in events:
        if event.changed_at < start:
            previous_status = event.status
        if event.changed_at <= end:
            status_at_end = event.status
    inside_ids = [e.id for e in events if start <= e.changed_at < end]
    if inside_ids:
        TechnicianStatusEvent.objects.filter(id__in=inside_ids).delete()

    if previous_status != status:
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=status, changed_at=start, is_adjusted=True
        )
    restore = status_at_end if status_at_end is not None else P.STATUS_AVAILABLE
    if not any(e.changed_at == end for e in events) and restore != status:
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=restore, changed_at=end, is_adjusted=True
        )
    return before, day


def _refresh_presence(collaborator, day):
    """Alinha a presença do dia (status atual, check-in/out) com a linha do tempo ajustada."""
    events = _day_events(collaborator, day)
    if not events:
        return []
    first, last = events[0], events[-1]
    presence, _ = TechnicianDailyPresence.objects.get_or_create(collaborator=collaborator, date=day)
    presence.status = last.status
    presence.checked_in_at = min(filter(None, [presence.checked_in_at, first.changed_at]))
    presence.checked_out_at = last.changed_at if last.status == P.STATUS_OFF_DUTY else None
    presence.save(update_fields=("status", "checked_in_at", "checked_out_at", "updated_at"))
    return _serialize_events(events)


@transaction.atomic
def replace_status_events(*, user, collaborator, day, events, reason):
    """Edita a lista de status do dia: `events` é a lista COMPLETA desejada, [(status, instante)].
    Registros que continuam iguais (mesmo status e instante) são mantidos como estão; os
    alterados ou novos entram marcados como ajustados; os que sumiram da lista são excluídos.
    Serve para corrigir um status (trocar tipo ou horário), excluir um registro errado ou
    cadastrar um novo."""
    reason = _validate_reason(reason)
    if not events:
        raise AdjustmentError("Mantenha ao menos um status no dia.")
    ordered = sorted(events, key=lambda item: item[1])
    now = timezone.now()
    previous_at = None
    for status, changed_at in ordered:
        if status not in ADJUSTABLE_STATUSES:
            raise AdjustmentError("Status inválido.")
        if timezone.localtime(changed_at).date() != day:
            raise AdjustmentError("Todos os horários precisam ser do dia selecionado.")
        if changed_at > now:
            raise AdjustmentError("Não é possível registrar status no futuro.")
        if previous_at is not None and changed_at == previous_at:
            raise AdjustmentError("Dois status não podem ter o mesmo horário.")
        previous_at = changed_at

    current = _day_events(collaborator, day)
    before = _serialize_events(current)
    unused = {}
    for e in current:
        unused.setdefault((e.status, e.changed_at), []).append(e)
    for status, changed_at in ordered:
        bucket = unused.get((status, changed_at))
        if bucket:
            bucket.pop()  # registro idêntico já existe: mantém como está
            continue
        TechnicianStatusEvent.objects.create(
            collaborator=collaborator, date=day, status=status, changed_at=changed_at, is_adjusted=True
        )
    stale_ids = [e.id for bucket in unused.values() for e in bucket]
    if stale_ids:
        TechnicianStatusEvent.objects.filter(id__in=stale_ids).delete()
    after = _refresh_presence(collaborator, day)
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=day,
        kind=TimelineAdjustment.KIND_STATUS_WINDOW,
        reason=reason,
        before={"events": before},
        after={"events": after},
    )


@transaction.atomic
def adjust_status_window(*, user, collaborator, start, end, status, reason):
    """Corrige um trecho de status (ex.: técnico esqueceu de sair do almoço)."""
    reason = _validate_reason(reason)
    if status not in ADJUSTABLE_STATUSES:
        raise AdjustmentError("Status inválido.")
    _validate_window(start, end)
    before, day = _apply_status_window(collaborator, start, end, status)
    after = _refresh_presence(collaborator, day)
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=day,
        kind=TimelineAdjustment.KIND_STATUS_WINDOW,
        reason=reason,
        before={"events": before},
        after={"events": after, "window": {"start": start.isoformat(), "end": end.isoformat(), "status": status}},
    )


def _snapshot_assignment(assignment):
    return {
        "status": assignment.status,
        "assignment_start": assignment.assignment_start.isoformat() if assignment.assignment_start else None,
        "assignment_end": assignment.assignment_end.isoformat() if assignment.assignment_end else None,
        "pause_log": assignment.pause_log,
        "paused_seconds": assignment.paused_seconds,
        "actual_hours": str(assignment.actual_hours) if assignment.actual_hours is not None else None,
        "completion_outcome": assignment.completion_outcome,
    }


@transaction.atomic
def register_execution(*, user, collaborator, task, start, end, pauses, reason, sync_presence=True):
    """Registra (ou corrige) a execução de `collaborator` em `task` como se o próprio
    técnico tivesse iniciado, pausado e concluído: horas reais válidas. Substitui o
    apontamento anterior dele nessa tarefa. Com `sync_presence`, os trechos trabalhados
    também viram "Em Execução" na linha do tempo de presença (que é de onde saem as
    horas produtivas)."""
    from projects.models import ProjectTask, ProjectTaskAssignment

    reason = _validate_reason(reason)
    _validate_window(start, end)
    ordered_pauses = sorted(pauses)
    cursor = start
    for pause_start, pause_end in ordered_pauses:
        if pause_end <= pause_start:
            raise AdjustmentError("Cada pausa precisa terminar depois de começar.")
        if pause_start < cursor or pause_end > end:
            raise AdjustmentError("As pausas precisam estar dentro da execução e não podem se sobrepor.")
        cursor = pause_end

    assignment, created = ProjectTaskAssignment.objects.get_or_create(
        project_task=task, collaborator=collaborator, defaults={"dispatched_by": user}
    )
    before = _snapshot_assignment(assignment)
    before["created"] = created

    assignment.assignment_start = start
    assignment.assignment_end = end
    assignment.paused_at = None
    assignment.pause_log = [[ps.isoformat(), pe.isoformat()] for ps, pe in ordered_pauses]
    assignment.paused_seconds = sum((pe - ps).total_seconds() for ps, pe in ordered_pauses)
    assignment.status = ProjectTask.STATUS_COMPLETED
    if not assignment.completion_outcome:
        assignment.completion_outcome = ProjectTask.COMPLETION_OUTCOME_COMPLETED
    intervals = assignment.working_intervals()
    assignment.actual_hours = round(sum((e - s).total_seconds() for s, e in intervals) / 3600, 2)
    assignment.is_adjusted = True
    assignment.save()
    task.sync_from_assignments()

    days = set()
    if sync_presence:
        for interval_start, interval_end in intervals:
            _, day = _apply_status_window(collaborator, interval_start, interval_end, P.STATUS_IN_PROGRESS)
            days.add(day)
    after_events = []
    for day in days:
        after_events += _refresh_presence(collaborator, day)

    after = _snapshot_assignment(assignment)
    after["presence_events"] = after_events
    return TimelineAdjustment.objects.create(
        user=user,
        collaborator=collaborator,
        date=timezone.localtime(start).date(),
        kind=TimelineAdjustment.KIND_EXECUTION,
        reason=reason,
        before={"assignment": before, "task_id": task.pk},
        after={"assignment": after, "task_id": task.pk},
    )
