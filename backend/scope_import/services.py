"""Orquestra a interpretação por IA e a confirmação (criação dos registros
reais) de uma ScopeImport. Segue o mesmo padrão de projects/services.py:
funções simples, chamadas pela view — nenhuma lógica de negócio na view."""

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.utils import timezone

from core.models import ActivityType, ProjectItemType
from core.rules import activities_for_technology
from projects.models import ProjectItem, ProjectTask, WorkBlock

from .ai_provider import AIProviderError
from .models import ScopeImport


class ScopeImportConfirmError(Exception):
    """Erro de validação ao confirmar uma ScopeImport, com mensagem amigável."""


def _active_catalog():
    activity_types = list(ActivityType.objects.filter(is_active=True).order_by("order", "name").values("id", "name"))
    item_types = list(ProjectItemType.objects.filter(is_active=True).order_by("order", "name").values("id", "name"))
    return activity_types, item_types


def _resolve_by_name(name, catalog_by_name):
    return catalog_by_name.get((name or "").strip().casefold())


def run_ai_interpretation(scope_import, provider):
    """Chama `provider.interpret_scope`, resolve os nomes de item_type/
    activity_type propostos pela IA contra o catálogo real (marcando
    `unmatched=True` no que não bateu, para a tela de revisão obrigar
    resolução manual), e salva o resultado em `ai_raw_response`. Atualiza
    `status` para READY ou FAILED (+ `error_message`) — nunca levanta
    exceção, para a criação da ScopeImport nunca falhar mesmo se a IA
    falhar."""
    activity_types, item_types = _active_catalog()
    activity_by_name = {a["name"].casefold(): a for a in activity_types}
    item_by_name = {i["name"].casefold(): i for i in item_types}

    scope_import.status = ScopeImport.STATUS_PROCESSING
    scope_import.save(update_fields=["status", "updated_at"])

    try:
        raw = provider.interpret_scope(scope_import.raw_text, activity_types=activity_types, item_types=item_types)
    except AIProviderError as exc:
        scope_import.status = ScopeImport.STATUS_FAILED
        scope_import.error_message = str(exc)
        scope_import.save(update_fields=["status", "error_message", "updated_at"])
        return

    resolved_blocks = []
    for block in raw.get("work_blocks") or []:
        resolved_items = []
        for item in block.get("items") or []:
            matched_item_type = _resolve_by_name(item.get("item_type"), item_by_name)
            ai_tasks = item.get("tasks") or []
            resolved_tasks = []
            for task in ai_tasks:
                matched_activity = _resolve_by_name(task.get("activity_type"), activity_by_name)
                resolved_tasks.append({
                    "activity_type_id": matched_activity["id"] if matched_activity else None,
                    "activity_type_name": task.get("activity_type") or "",
                    "activity_type_unmatched": matched_activity is None,
                    "quantity_planned": task.get("quantity_planned"),
                    "unit": task.get("unit") or "",
                })

            # Fase 3: se existe uma regra determinística ativa pra essa
            # tecnologia, ela sempre vence o que a IA propôs — regra de
            # negócio nunca é decidida pela IA sozinha. A quantidade
            # planejada de cada etapa herda a que a IA já tinha inferido
            # pro item (todas as atividades da cadeia operam sobre a mesma
            # quantidade física do item).
            rule_steps = activities_for_technology(item.get("technology"))
            if rule_steps:
                reference_quantity = ai_tasks[0].get("quantity_planned") if ai_tasks else None
                reference_unit = ai_tasks[0].get("unit") if ai_tasks else ""
                resolved_tasks = [
                    {
                        "activity_type_id": step.activity_type_id,
                        "activity_type_name": step.activity_type.name,
                        "activity_type_unmatched": False,
                        "quantity_planned": reference_quantity,
                        "unit": step.activity_type.default_unit or reference_unit or "",
                    }
                    for step in rule_steps
                ]

            resolved_items.append({
                "internal_code": item.get("internal_code") or "",
                "item_type_id": matched_item_type["id"] if matched_item_type else None,
                "item_type_name": item.get("item_type") or "",
                "item_type_unmatched": matched_item_type is None,
                "technology": item.get("technology") or "",
                "fiber_count": item.get("fiber_count"),
                "length_meters": item.get("length_meters"),
                "origin": item.get("origin") or "",
                "destination": item.get("destination") or "",
                "route": item.get("route") or "",
                "priority": item.get("priority") or "medium",
                "complexity": item.get("complexity") or "medium",
                "tasks": resolved_tasks,
            })
        resolved_blocks.append({"name": block.get("name") or "Geral", "items": resolved_items})

    scope_import.ai_raw_response = {"work_blocks": resolved_blocks}
    scope_import.status = ScopeImport.STATUS_READY
    scope_import.save(update_fields=["ai_raw_response", "status", "updated_at"])


def confirm_scope_import(scope_import, reviewed_payload, user):
    """Revalida `reviewed_payload` (nunca confia cegamente no que o
    frontend manda — o usuário pode ter editado qualquer campo) e cria de
    fato os WorkBlock/ProjectItem/ProjectTask, todos marcados com
    `scope_import=scope_import` para rastreabilidade. Retorna um dict com
    as contagens criadas. Levanta ScopeImportConfirmError com mensagem
    amigável em caso de estrutura inválida."""
    work_blocks = reviewed_payload.get("work_blocks") if isinstance(reviewed_payload, dict) else None
    if not isinstance(work_blocks, list) or not work_blocks:
        raise ScopeImportConfirmError("Nenhum bloco de trabalho informado para confirmar.")

    valid_activity_ids = set(ActivityType.objects.filter(is_active=True).values_list("id", flat=True))
    valid_item_type_ids = set(ProjectItemType.objects.filter(is_active=True).values_list("id", flat=True))

    counts = {"work_blocks": 0, "items": 0, "tasks": 0}

    with transaction.atomic():
        for block_index, block in enumerate(work_blocks, start=1):
            block_name = (block.get("name") or "").strip()
            if not block_name:
                raise ScopeImportConfirmError(f"Bloco #{block_index}: informe um nome.")
            work_block, created = WorkBlock.objects.get_or_create(
                project=scope_import.project, name=block_name, defaults={"scope_import": scope_import}
            )
            if created:
                counts["work_blocks"] += 1

            for item_index, item in enumerate(block.get("items") or [], start=1):
                item_type_id = item.get("item_type_id")
                if item_type_id not in valid_item_type_ids:
                    raise ScopeImportConfirmError(
                        f'Bloco "{block_name}", item #{item_index}: tipo de item inválido ou não selecionado.'
                    )
                project_item = ProjectItem(
                    project=scope_import.project,
                    work_block=work_block,
                    scope_import=scope_import,
                    internal_code=item.get("internal_code") or "",
                    item_type_id=item_type_id,
                    technology=item.get("technology") or "",
                    fiber_count=item.get("fiber_count") or None,
                    length_meters=item.get("length_meters") or None,
                    origin=item.get("origin") or "",
                    destination=item.get("destination") or "",
                    route=item.get("route") or "",
                    priority=item.get("priority") or "medium",
                    complexity=item.get("complexity") or "medium",
                )
                try:
                    project_item.full_clean()
                except DjangoValidationError as exc:
                    raise ScopeImportConfirmError(
                        f'Bloco "{block_name}", item #{item_index}: {"; ".join(exc.messages)}'
                    ) from exc
                project_item.save()
                counts["items"] += 1

                tasks = item.get("tasks") or []
                if not tasks:
                    raise ScopeImportConfirmError(
                        f'Bloco "{block_name}", item #{item_index}: informe ao menos uma tarefa.'
                    )
                for task_index, task in enumerate(tasks, start=1):
                    activity_type_id = task.get("activity_type_id")
                    if activity_type_id not in valid_activity_ids:
                        raise ScopeImportConfirmError(
                            f'Bloco "{block_name}", item #{item_index}, tarefa #{task_index}: '
                            "tipo de atividade inválido ou não selecionado."
                        )
                    project_task = ProjectTask(
                        project=scope_import.project,
                        project_item=project_item,
                        activity_type_id=activity_type_id,
                        scope_import=scope_import,
                        quantity_planned=task.get("quantity_planned") or None,
                        unit=task.get("unit") or "",
                    )
                    try:
                        project_task.full_clean()
                    except DjangoValidationError as exc:
                        raise ScopeImportConfirmError(
                            f'Bloco "{block_name}", item #{item_index}, tarefa #{task_index}: {"; ".join(exc.messages)}'
                        ) from exc
                    project_task.save()
                    counts["tasks"] += 1

        scope_import.reviewed_payload = reviewed_payload
        scope_import.status = ScopeImport.STATUS_CONFIRMED
        scope_import.reviewed_by = user
        scope_import.confirmed_at = timezone.now()
        scope_import.save(update_fields=["reviewed_payload", "status", "reviewed_by", "confirmed_at", "updated_at"])

    return counts
