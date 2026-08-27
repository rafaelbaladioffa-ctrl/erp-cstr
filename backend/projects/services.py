"""Lógica de negócio compartilhada entre o Django Admin (projects/admin.py)
e a API REST (api/views.py) para as ações de Projeto que não são um simples
CRUD: importar Tarefas do catálogo do Tipo de Projeto, ações em massa sobre
as Tarefas do Projeto e cadastro em massa de Rack Positions.
"""

from django.core.exceptions import ValidationError
from django.db import transaction
from django.db.models import Max

from .models import Project, ProjectTask, RackPosition


class BulkActionError(Exception):
    """Erro de validação de uma ação em massa, com mensagem amigável."""


def parse_bulk_rack_positions(raw_text):
    """Converte o texto colado (um Rack Position por linha, no formato
    'Rack Position;DH;Links;UTP', com DH/Links/UTP opcionais) numa lista de
    dicts {position, dh, links, utp}. Levanta BulkActionError com a linha
    problemática em caso de erro."""
    rows = []
    for line_number, raw_line in enumerate((raw_text or "").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = [part.strip() for part in line.split(";")]
        position = parts[0]
        if not position:
            raise BulkActionError(f"Linha {line_number}: informe o Rack Position.")
        dh = parts[1] if len(parts) > 1 else ""

        def _parse_count(raw_value, field_label):
            raw_value = (raw_value or "").strip()
            if not raw_value:
                return 0
            try:
                value = int(raw_value)
            except ValueError:
                raise BulkActionError(f'Linha {line_number}: {field_label} inválido "{raw_value}".')
            if value < 0:
                raise BulkActionError(f"Linha {line_number}: {field_label} não pode ser negativo.")
            return value

        links = _parse_count(parts[2] if len(parts) > 2 else "", "Links")
        utp = _parse_count(parts[3] if len(parts) > 3 else "", "UTP")
        rows.append({"position": position, "dh": dh, "links": links, "utp": utp})
    return rows


def create_rack_positions_bulk(project, raw_text):
    """Cria os Rack Positions descritos em `raw_text` (ver
    parse_bulk_rack_positions), ignorando os que já existem (mesma
    'position') no projeto. Retorna (created, skipped)."""
    rows = parse_bulk_rack_positions(raw_text)
    created = 0
    skipped = 0
    for row in rows:
        _, was_created = RackPosition.objects.get_or_create(
            project=project,
            position=row["position"],
            defaults={"dh": row["dh"], "links": row["links"], "utp": row["utp"]},
        )
        if was_created:
            created += 1
        else:
            skipped += 1
    return created, skipped


def create_task_instances(project, task, rack_positions=None, *, collaborators=None, **fields):
    """Cria uma ProjectTask para `task` no projeto — UMA POR Rack Position em
    `rack_positions` (ex: 'Aplicação de Label' em 3 Rack Positions vira 3
    ProjectTask, uma por posição, cada uma com seu próprio status/
    responsáveis/horário — não uma tarefa só cobrindo as 3), ou uma única
    ProjectTask sem Rack Position se a lista vier vazia/None. Ignora
    silenciosamente combinações (task, rack_position) que já existem.
    `fields` (status, planned_start, planned_end, estimated_hours, notes...)
    são aplicados a cada ProjectTask criada. Retorna (created, skipped).

    Roda dentro de uma transação que trava a linha do Project (select_for_update)
    para serializar chamadas concorrentes e evitar duas requisições calculando
    o mesmo `next_order` (a unicidade (project, task) foi removida para
    suportar 'uma ProjectTask por Rack Position', então não há mais nenhuma
    constraint no banco para pegar essa corrida)."""
    with transaction.atomic():
        Project.objects.select_for_update().filter(pk=project.pk).exists()
        next_order = (project.project_tasks.aggregate(highest=Max("order"))["highest"] or 0) + 1
        created = []
        skipped = 0
        for rack_position in (rack_positions or [None]):
            existing = ProjectTask.objects.filter(project=project, task=task)
            existing = (
                existing.filter(rack_positions=rack_position)
                if rack_position
                else existing.filter(rack_positions__isnull=True)
            )
            if existing.exists():
                skipped += 1
                continue
            project_task = ProjectTask.objects.create(project=project, task=task, order=next_order, **fields)
            if rack_position:
                project_task.rack_positions.set([rack_position])
            if collaborators:
                project_task.collaborators.set(collaborators)
            created.append(project_task)
            next_order += 1
    return created, skipped


def add_tasks_to_project(project, tasks, rack_positions=None):
    """Cria ProjectTask para cada Tarefa do catálogo em `tasks` — uma por
    Rack Position em `rack_positions` (explode, ver create_task_instances).
    Se `rack_positions` não for informado (None) e o projeto usar Rack
    Position, usa TODOS os Rack Positions já cadastrados no projeto como
    padrão. Retorna a quantidade criada."""
    if rack_positions is None:
        rack_positions = list(project.rack_positions.all()) if project.has_rack_positions else []
    total_created = 0
    for task in tasks:
        created, _ = create_task_instances(project, task, rack_positions, estimated_hours=task.estimated_hours)
        total_created += len(created)
    return total_created


def add_custom_tasks_to_project(project, names):
    """Cria uma ProjectTask avulsa (sem Tarefa de catálogo, usando texto livre
    em `custom_name`) para cada nome em `names` — uma linha de texto vira uma
    tarefa. Diferente de add_tasks_to_project, não explode por Rack Position
    nem faz checagem de duplicidade (tarefa avulsa não tem catálogo pra
    comparar); quem precisar de Rack Position edita a tarefa depois de criada.
    Retorna a lista de ProjectTask criadas."""
    with transaction.atomic():
        Project.objects.select_for_update().filter(pk=project.pk).exists()
        next_order = (project.project_tasks.aggregate(highest=Max("order"))["highest"] or 0) + 1
        created = []
        for name in names:
            name = name.strip()
            if not name:
                continue
            created.append(ProjectTask.objects.create(project=project, custom_name=name, order=next_order))
            next_order += 1
    return created


def import_tasks_from_project_type(project):
    """Copia todas as Tarefas ativas do Tipo de Projeto do projeto para
    ProjectTask (ignorando as que já existem). Retorna a quantidade criada."""
    if not project.project_type_id:
        raise BulkActionError("O projeto não tem Tipo de Projeto definido.")
    tasks = project.project_type.tasks.filter(is_active=True).order_by("name", "id")
    return add_tasks_to_project(project, tasks)


def apply_bulk_task_update(project_tasks, *, status=None, planned_start=None, planned_end=None,
                            estimated_hours=None, collaborators=None, rack_positions=None):
    """Aplica os valores informados (todos opcionais) às ProjectTasks do
    queryset `project_tasks`. `collaborators`/`rack_positions`, quando
    informados, SUBSTITUEM o conjunto atual de cada tarefa (não somam).
    Retorna a quantidade de tarefas afetadas, ou 0 se nada foi informado."""
    updates = {}
    if status:
        updates["status"] = status
    if planned_start:
        updates["planned_start"] = planned_start
    if planned_end:
        updates["planned_end"] = planned_end
    if estimated_hours is not None:
        updates["estimated_hours"] = estimated_hours

    updated = 0
    if updates:
        updated = project_tasks.update(**updates)
    if collaborators:
        for project_task in project_tasks:
            project_task.collaborators.set(collaborators)
        updated = project_tasks.count()
    if rack_positions:
        for project_task in project_tasks:
            project_task.validate_rack_positions(rack_positions)
        for project_task in project_tasks:
            project_task.rack_positions.set(rack_positions)
        updated = project_tasks.count()
    return updated
