"""Geração de GeneratedTask a partir de um ScopeItem já resolvido —
independente de HTTP/DRF (mesmo espírito de task_rule_resolver.py e
scope_item_normalizer.py):

ScopeItem -> TaskTemplate (resolvido) -> TaskTemplateSteps -> GeneratedTask

NUNCA gera tarefas para um ScopeItem que não esteja
rule_resolution_status=RESOLVED com um resolved_template — a ordem correta
é sempre "Resolver Template" primeiro, "Gerar Tarefas" depois (processo
auditável, sem resolução implícita escondida dentro da geração). Este
módulo NUNCA cria/atualiza ScopeItem, TaskTemplate ou TaskTemplateStep —
só lê e cria GeneratedTask."""

from decimal import Decimal

from django.db import transaction


class TaskGenerationError(Exception):
    """ScopeItem não está pronto para gerar tarefas (rule_resolution_status
    != RESOLVED, ou sem resolved_template) — resolva o template primeiro."""


# Origens de quantidade reconhecidas nesta primeira versão (ver
# TaskTemplateStep.QUANTITY_SOURCE_SUGGESTIONS). Uma origem fora destas
# listas NÃO é um erro: só resulta em quantity=None e um warning no
# retorno da geração (ver _resolve_quantity).
_QUANTITY_FROM_SCOPE_ITEM_QUANTITY = ("SCOPE_ITEM", "CABLE_COUNT", "LINK_COUNT", "CONNECTION_COUNT")
_QUANTITY_FROM_SCOPE_ITEM_LENGTH = ("METERAGE",)
_QUANTITY_FIXED_ONE = ("PROJECT",)
_QUANTITY_NULL = ("MANUAL", "NONE", "")


def _resolve_quantity(scope_item, quantity_source, warnings):
    if quantity_source in _QUANTITY_FROM_SCOPE_ITEM_QUANTITY:
        return Decimal(scope_item.quantity)
    if quantity_source in _QUANTITY_FROM_SCOPE_ITEM_LENGTH:
        return scope_item.length_m
    if quantity_source in _QUANTITY_FIXED_ONE:
        return Decimal(1)
    if quantity_source in _QUANTITY_NULL:
        return None
    warnings.append(f'Origem de quantidade não reconhecida ("{quantity_source}") — quantidade ficou em branco.')
    return None


def _resolve_unit(step, scope_item):
    return step.unit_override or step.activity.default_unit or scope_item.unit or ""


def generate_tasks_for_scope_item(scope_item, user=None):
    """Gera (ou reaproveita, se já existir) uma GeneratedTask por
    TaskTemplateStep ATIVO do template resolvido do ScopeItem, em ordem de
    step_order. Idempotente: chamar de novo não duplica — reforçado tanto
    pela UniqueConstraint (scope_item, task_template_step) quanto por
    get_or_create() aqui.

    Levanta TaskGenerationError se o ScopeItem não estiver
    rule_resolution_status=RESOLVED ou não tiver resolved_template.

    `user`: usado como created_by/updated_by das tarefas recém-criadas
    (None é aceito — ex.: chamada fora do contexto de uma request HTTP).

    Retorna um dict com instâncias de model (não dicts JSON-safe, para que
    a camada de API reaproveite diretamente GeneratedTaskCrudSerializer):
    {"scope_item": ScopeItem, "created_tasks": [...], "existing_tasks":
    [...], "warnings": [...]}."""

    if scope_item.rule_resolution_status != "RESOLVED" or not scope_item.resolved_template_id:
        raise TaskGenerationError(
            "O item de escopo precisa estar resolvido (rule_resolution_status=RESOLVED, com um "
            'template resolvido) antes de gerar tarefas — use "Resolver Template" primeiro.'
        )

    from master_data.models import GeneratedTask, TaskTemplateStep

    steps = (
        TaskTemplateStep.objects.filter(task_template_id=scope_item.resolved_template_id, active=True)
        .select_related("activity")
        .order_by("step_order")
    )

    created_tasks = []
    existing_tasks = []
    warnings = []

    with transaction.atomic():
        for step in steps:
            quantity = _resolve_quantity(scope_item, step.quantity_source or "", warnings)
            unit = _resolve_unit(step, scope_item)
            task, was_created = GeneratedTask.objects.get_or_create(
                scope_item=scope_item,
                task_template_step=step,
                defaults={
                    "task_template": scope_item.resolved_template,
                    "activity": step.activity,
                    "step_order": step.step_order,
                    "name": step.effective_name,
                    "quantity": quantity,
                    "unit": unit,
                    "required": step.required,
                    "repeatable": step.repeatable,
                    "generation_source": "TEMPLATE",
                    "status": "PENDING",
                    "created_by": user,
                    "updated_by": user,
                },
            )
            if was_created:
                created_tasks.append(task)
            else:
                existing_tasks.append(task)

    return {
        "scope_item": scope_item,
        "created_tasks": created_tasks,
        "existing_tasks": existing_tasks,
        "warnings": warnings,
    }
