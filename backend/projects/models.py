from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from core.models import (
    ActivityType,
    Category,
    Client,
    Collaborator,
    Company,
    ProjectItemType,
    ProjectType,
    Responsible,
    Site,
    Task,
    TimestampedModel,
)

PRIORITY_LOW = "low"
PRIORITY_MEDIUM = "medium"
PRIORITY_HIGH = "high"
PRIORITY_CRITICAL = "critical"
PRIORITY_CHOICES = (
    (PRIORITY_LOW, "Baixa"),
    (PRIORITY_MEDIUM, "Média"),
    (PRIORITY_HIGH, "Alta"),
    (PRIORITY_CRITICAL, "Crítica"),
)

COMPLEXITY_SIMPLE = "simple"
COMPLEXITY_MEDIUM = "medium"
COMPLEXITY_COMPLEX = "complex"
COMPLEXITY_CHOICES = (
    (COMPLEXITY_SIMPLE, "Simples"),
    (COMPLEXITY_MEDIUM, "Média"),
    (COMPLEXITY_COMPLEX, "Complexa"),
)


class ProjectSequence(models.Model):
    year = models.PositiveIntegerField("ano", primary_key=True)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "Sequência de Projetos"
        verbose_name_plural = "Sequências de Projetos"


class Project(TimestampedModel):
    STATUS_PLANNING = "planning"
    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_PAUSED = "paused"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_PLANNING, "Planejamento"),
        (STATUS_NOT_STARTED, "Não Iniciado"),
        (STATUS_IN_PROGRESS, "Ativo"),
        (STATUS_PAUSED, "Pausado"),
        (STATUS_COMPLETED, "Concluído"),
        (STATUS_CANCELED, "Cancelado"),
    )

    code = models.CharField("código", max_length=30, unique=True, editable=False)
    company = models.ForeignKey(Company, verbose_name="empresa", on_delete=models.PROTECT, related_name="projects")
    name = models.CharField("nome do projeto", max_length=200)
    po = models.CharField("PO", max_length=100, blank=True)
    link_count = models.PositiveIntegerField("quantidade de links", default=0, blank=True)
    has_rack_positions = models.BooleanField(
        "Rack Position",
        default=False,
        blank=True,
        help_text="Ative para controlar Rack Position (DH, Links, UTP por posição) neste projeto.",
    )
    client = models.ForeignKey(Client, verbose_name="cliente", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    site = models.ForeignKey(Site, verbose_name="site", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    project_type = models.ForeignKey(ProjectType, verbose_name="Tipo de Projeto", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    category = models.ForeignKey(Category, verbose_name="categoria", on_delete=models.PROTECT, related_name="projects", null=True, blank=True)
    responsible_cstr = models.ForeignKey(
        Responsible,
        verbose_name="Responsável CSTR",
        on_delete=models.PROTECT,
        related_name="cstr_projects",
        null=True,
        blank=True,
        limit_choices_to=(
            models.Q(kind=Responsible.KIND_CSTR)
            & (
                models.Q(person__company__legal_name__icontains="CONSULTIMER")
                | models.Q(person__company__trade_name__icontains="CONSULTIMER")
            )
        ),
    )
    responsible_client = models.ForeignKey(
        Responsible,
        verbose_name="Responsável Cliente",
        on_delete=models.PROTECT,
        related_name="client_projects",
        null=True,
        blank=True,
        limit_choices_to=models.Q(kind=Responsible.KIND_CLIENT),
    )
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_PLANNING)
    planned_start = models.DateField("início previsto", null=True, blank=True)
    planned_end = models.DateField("término previsto", null=True, blank=True)
    actual_start = models.DateField("início real", null=True, blank=True)
    actual_end = models.DateField("término real", null=True, blank=True)
    description = models.TextField("descrição", blank=True)
    notes = models.TextField("observações", blank=True)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Projeto"
        verbose_name_plural = "Projetos"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.code} - {self.name}" if self.code else self.name

    def clean(self):
        super().clean()
        errors = {}
        if self.client_id and self.site_id and self.site.client_id != self.client_id:
            errors["site"] = "O Site selecionado deve pertencer ao Cliente do projeto."
        if self.responsible_cstr_id and "CONSULTIMER" not in (
            f"{self.responsible_cstr.person.company.legal_name} {self.responsible_cstr.person.company.trade_name}".upper()
        ):
            errors["responsible_cstr"] = "O Responsável CSTR deve pertencer à empresa Consultimer."
        if self.responsible_client_id and self.client_id and self.responsible_client.client_id != self.client_id:
            errors["responsible_client"] = "O responsável selecionado deve pertencer ao Cliente do projeto."
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            errors["planned_end"] = "O término previsto não pode ser anterior ao início previsto."
        if self.actual_start and self.actual_end and self.actual_end < self.actual_start:
            errors["actual_end"] = "O término real não pode ser anterior ao início real."
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)

        year = timezone.localdate().year
        with transaction.atomic():
            try:
                sequence = ProjectSequence.objects.select_for_update().get(year=year)
            except ProjectSequence.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = ProjectSequence.objects.create(year=year)
                except IntegrityError:
                    sequence = ProjectSequence.objects.select_for_update().get(year=year)
            sequence.last_number += 1
            sequence.save(update_fields=("last_number",))
            self.code = f"CSTR-PROJ-{year}{sequence.last_number:04d}"
            return super().save(*args, **kwargs)


class ProjectHistory(Project):
    class Meta:
        proxy = True
        verbose_name = "Histórico de Projeto"
        verbose_name_plural = "Histórico de Projetos"


class DashboardProxy(Project):
    class Meta:
        proxy = True
        default_permissions = ()
        verbose_name = "Dashboard"
        verbose_name_plural = "Dashboard"


class RackPosition(TimestampedModel):
    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="rack_positions")
    position = models.CharField("Rack Position", max_length=50)
    dh = models.CharField("DH", max_length=50, blank=True)
    links = models.PositiveIntegerField("Links", default=0, blank=True)
    utp = models.PositiveIntegerField("UTP", default=0, blank=True)

    class Meta:
        verbose_name = "Rack Position"
        verbose_name_plural = "Rack Positions"
        ordering = ("position",)
        constraints = [
            models.UniqueConstraint(fields=("project", "position"), name="unique_rack_position_per_project")
        ]

    def __str__(self):
        return self.position

    def clean(self):
        super().clean()
        if self.project_id and not self.project.has_rack_positions:
            raise ValidationError({"project": "O projeto selecionado não tem Rack Position ativado."})


class WorkBlock(TimestampedModel):
    """Agrupamento visual de tarefas/itens dentro de um projeto (ex: UMN,
    BFC, EG1, Preparação, Finalização) — pra não jogar centenas de tarefas
    numa tela só. Progresso consolidado (ex: "17/24 — 71%") é sempre
    calculado na hora a partir das ProjectTask do bloco, nunca guardado
    aqui, pra não correr o risco de ficar desatualizado."""

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="work_blocks")
    name = models.CharField("nome", max_length=150)
    code = models.CharField("código", max_length=30, blank=True)
    description = models.TextField("descrição", blank=True)
    order = models.PositiveIntegerField("ordem", default=0)
    scope_import = models.ForeignKey(
        "scope_import.ScopeImport",
        verbose_name="importação de escopo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="work_blocks_created",
    )

    class Meta:
        verbose_name = "Bloco de Trabalho"
        verbose_name_plural = "Blocos de Trabalho"
        ordering = ("order", "name")
        constraints = [
            models.UniqueConstraint(
                fields=("project", "name"),
                condition=~models.Q(name=""),
                name="unique_nonempty_workblock_name_per_project",
            )
        ]

    def __str__(self):
        return f"{self.project} - {self.name}"


class ProjectItem(TimestampedModel):
    """Item técnico do projeto — o que fisicamente/logicamente precisa ser
    executado (ex: 'cabo Robust 2F de 20m', 'link óptico', 'rack'). Uma
    tarefa (ProjectTask) é uma atividade (ActivityType) aplicada a um item
    — ver ProjectTask.project_item/activity_type."""

    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_NOT_STARTED, "Não Iniciado"),
        (STATUS_IN_PROGRESS, "Em Andamento"),
        (STATUS_COMPLETED, "Concluído"),
        (STATUS_CANCELED, "Cancelado"),
    )

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="items")
    work_block = models.ForeignKey(
        WorkBlock, verbose_name="bloco de trabalho", on_delete=models.SET_NULL, null=True, blank=True, related_name="items"
    )
    internal_code = models.CharField("código interno", max_length=50, blank=True)
    item_type = models.ForeignKey(ProjectItemType, verbose_name="tipo", on_delete=models.PROTECT, related_name="project_items")
    technology = models.CharField("tecnologia", max_length=100, blank=True)
    fiber_count = models.PositiveIntegerField("quantidade de fibras", null=True, blank=True)
    connector_type_a = models.CharField("tipo de conector A", max_length=50, blank=True)
    connector_type_b = models.CharField("tipo de conector B", max_length=50, blank=True)
    part_number = models.CharField("part number", max_length=100, blank=True)
    length_meters = models.DecimalField("metragem", max_digits=10, decimal_places=2, null=True, blank=True)
    origin = models.CharField("origem", max_length=150, blank=True)
    destination = models.CharField("destino", max_length=150, blank=True)
    route = models.CharField("rota", max_length=255, blank=True)
    priority = models.CharField("prioridade", max_length=20, choices=PRIORITY_CHOICES, default=PRIORITY_MEDIUM)
    complexity = models.CharField("complexidade", max_length=20, choices=COMPLEXITY_CHOICES, default=COMPLEXITY_MEDIUM)
    metadata = models.JSONField("metadados", default=dict, blank=True)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED)
    order = models.PositiveIntegerField("ordem", default=0)
    notes = models.TextField("observações", blank=True)
    scope_import = models.ForeignKey(
        "scope_import.ScopeImport",
        verbose_name="importação de escopo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="items_created",
    )

    class Meta:
        verbose_name = "Item do Projeto"
        verbose_name_plural = "Itens do Projeto"
        ordering = ("order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("project", "internal_code"),
                condition=~models.Q(internal_code=""),
                name="unique_nonempty_item_code_per_project",
            )
        ]
        indexes = [models.Index(fields=("project", "work_block"))]

    def __str__(self):
        return self.internal_code or f"{self.item_type} - {self.project}"


class ProjectTask(TimestampedModel):
    STATUS_NOT_STARTED = "not_started"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_PAUSED = "paused"
    STATUS_COMPLETED = "completed"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_NOT_STARTED, "Não Iniciada"),
        (STATUS_IN_PROGRESS, "Em Andamento"),
        (STATUS_PAUSED, "Pausada"),
        (STATUS_COMPLETED, "Concluída"),
        (STATUS_CANCELED, "Cancelada"),
    )

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="project_tasks")
    task = models.ForeignKey(
        Task, verbose_name="tarefa", on_delete=models.PROTECT, related_name="project_tasks", null=True, blank=True
    )
    custom_name = models.CharField(
        "nome da tarefa avulsa",
        max_length=200,
        blank=True,
        help_text="Usado só quando a tarefa não vem do catálogo (campo 'Tarefa' em branco).",
    )
    rack_positions = models.ManyToManyField(
        RackPosition,
        verbose_name="Rack Positions",
        related_name="project_tasks",
        blank=True,
    )
    collaborators = models.ManyToManyField(
        Collaborator,
        through="ProjectTaskAssignment",
        verbose_name="responsáveis",
        related_name="project_tasks",
        blank=True,
    )
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED)
    order = models.PositiveIntegerField("ordem", default=0)
    planned_start = models.DateTimeField("Início", null=True, blank=True)
    planned_end = models.DateTimeField("Término", null=True, blank=True)
    actual_start = models.DateTimeField("início real", null=True, blank=True)
    actual_end = models.DateTimeField("término real", null=True, blank=True)
    estimated_hours = models.DecimalField("horas previstas", max_digits=8, decimal_places=2, null=True, blank=True)
    actual_hours = models.DecimalField("horas realizadas", max_digits=8, decimal_places=2, null=True, blank=True)
    paused_seconds = models.FloatField("segundos pausados", default=0, editable=False)
    paused_at = models.DateTimeField("pausado em", null=True, blank=True, editable=False)
    notes = models.TextField("observações", blank=True)

    COMPLETION_OUTCOME_COMPLETED = "completed"
    COMPLETION_OUTCOME_PARTIAL = "partial"
    COMPLETION_OUTCOME_BLOCKED = "blocked"
    COMPLETION_OUTCOME_CHOICES = (
        (COMPLETION_OUTCOME_COMPLETED, "Concluída"),
        (COMPLETION_OUTCOME_PARTIAL, "Parcial"),
        (COMPLETION_OUTCOME_BLOCKED, "Bloqueada"),
    )
    completion_outcome = models.CharField(
        "resultado da finalização", max_length=20, choices=COMPLETION_OUTCOME_CHOICES, blank=True
    )
    quantity_done = models.CharField("quantidade executada", max_length=100, blank=True)

    # --- Campos novos (padronização/rastreabilidade) — todos opcionais,
    # convivem com task/custom_name sem substituí-los. Ver clean()/
    # display_name mais abaixo para como os dois caminhos coexistem. ---
    activity_type = models.ForeignKey(
        ActivityType, verbose_name="tipo de atividade", on_delete=models.PROTECT,
        null=True, blank=True, related_name="project_tasks",
    )
    project_item = models.ForeignKey(
        ProjectItem, verbose_name="item do projeto", on_delete=models.PROTECT,
        null=True, blank=True, related_name="project_tasks",
    )
    work_block = models.ForeignKey(
        WorkBlock, verbose_name="bloco de trabalho", on_delete=models.SET_NULL,
        null=True, blank=True, related_name="project_tasks",
        help_text="Preenchido automaticamente a partir do bloco do item do projeto (ver save()).",
    )
    quantity_planned = models.DecimalField("quantidade planejada", max_digits=10, decimal_places=2, null=True, blank=True)
    quantity_completed = models.DecimalField("quantidade concluída", max_digits=10, decimal_places=2, null=True, blank=True)
    unit = models.CharField("unidade", max_length=20, blank=True, help_text="Ex: m, un, porta, ponta, link, caixa.")
    priority = models.CharField("prioridade", max_length=20, choices=PRIORITY_CHOICES, blank=True)
    sequence = models.PositiveIntegerField(
        "sequência", default=0,
        help_text="Posição da atividade dentro da cadeia do item (ex: Lançamento=1, Organização=2...) — não confundir com 'ordem' (exibição geral) nem com a fila de despacho do técnico.",
    )
    complexity = models.CharField("complexidade", max_length=20, choices=COMPLEXITY_CHOICES, blank=True)
    instructions = models.TextField("instruções", blank=True)
    scope_import = models.ForeignKey(
        "scope_import.ScopeImport",
        verbose_name="importação de escopo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="tasks_created",
    )

    class Meta:
        verbose_name = "Tarefa do Projeto"
        verbose_name_plural = "Tarefas do Projeto"
        ordering = ("order", "id")
        constraints = [
            models.UniqueConstraint(
                fields=("project_item", "activity_type"),
                condition=models.Q(project_item__isnull=False) & models.Q(activity_type__isnull=False),
                name="unique_activity_per_item",
            )
        ]

    def __str__(self):
        return f"{self.project} - {self.display_name}"

    @property
    def display_name(self):
        """Nome de exibição: prefere o Tipo de Atividade padronizado quando
        a tarefa já usa o modelo novo (activity_type + project_item), senão
        cai no comportamento de sempre — Tarefa do catálogo ou nome avulso —
        pra tarefas antigas continuarem exibindo exatamente como antes."""
        if self.activity_type_id:
            label = self.activity_type.name
            if self.project_item_id:
                label = f"{label} - {self.project_item}"
            return label
        return self.task.name if self.task_id else self.custom_name

    def clean(self):
        super().clean()
        errors = {}
        if not self.task_id and not self.custom_name.strip() and not self.activity_type_id:
            errors["custom_name"] = "Informe uma Tarefa do catálogo, um nome avulso, ou um Tipo de Atividade."
        if self.planned_start and self.planned_end and self.planned_end < self.planned_start:
            errors["planned_end"] = "O término previsto não pode ser anterior ao início previsto."
        if self.actual_start and self.actual_end and self.actual_end < self.actual_start:
            errors["actual_end"] = "O término real não pode ser anterior ao início real."
        if errors:
            raise ValidationError(errors)

    def validate_rack_positions(self, rack_positions):
        """Confere que todos os Rack Positions informados pertencem a este
        projeto. M2M não dá para validar em clean() (só existe após salvar
        a instância), então isso é chamado explicitamente por quem atribui
        os valores (admin, API) depois de resolver o project_id."""
        invalid = [rp for rp in rack_positions if rp.project_id != self.project_id]
        if invalid:
            names = ", ".join(rp.position for rp in invalid)
            raise ValidationError({"rack_positions": f"Rack Position(s) que não pertencem a este projeto: {names}."})

    def validate_unique_for_rack_positions(self, rack_positions):
        """Uma mesma Tarefa do catálogo pode se repetir no projeto, desde
        que cada repetição cubra um Rack Position diferente (uma tarefa por
        Rack Position — ex: 'Aplicação de Label' em 3 Rack Positions vira 3
        ProjectTask, uma por posição, não uma só com os 3 vinculados). Sem
        Rack Position envolvido, continua só podendo haver uma tarefa igual
        por projeto. Assim como validate_rack_positions, precisa ser chamado
        explicitamente por quem atribui os valores (M2M só existe após
        salvar). Tarefas avulsas (sem Tarefa de catálogo) não entram nessa
        checagem — não há o que deduplicar contra um catálogo que não existe
        para elas."""
        if not self.task_id:
            return
        queryset = ProjectTask.objects.filter(project_id=self.project_id, task_id=self.task_id)
        if self.pk:
            queryset = queryset.exclude(pk=self.pk)
        if rack_positions:
            conflicting = queryset.filter(rack_positions__in=rack_positions).distinct()
            if conflicting.exists():
                names = ", ".join(sorted({rp.position for pt in conflicting for rp in pt.rack_positions.all() if rp in rack_positions}))
                raise ValidationError({"rack_positions": f"Esta tarefa já existe para o(s) Rack Position(s): {names}."})
        elif queryset.exists():
            raise ValidationError({"task": f'A tarefa "{self.task}" já foi adicionada a este projeto.'})

    def save(self, *args, **kwargs):
        previous = ProjectTask.objects.filter(pk=self.pk).first() if self.pk else None
        now = timezone.now()

        # work_block é uma cópia denormalizada do bloco do item vinculado —
        # sempre a fonte de verdade é project_item.work_block, isso aqui só
        # evita um join extra em toda listagem/consulta agrupada por bloco.
        self.work_block_id = self.project_item.work_block_id if self.project_item_id else self.work_block_id

        if previous and previous.status != self.status:
            if self.status == self.STATUS_PAUSED:
                self.paused_at = now
            elif previous.status == self.STATUS_PAUSED:
                if previous.paused_at:
                    self.paused_seconds = (previous.paused_seconds or 0) + (now - previous.paused_at).total_seconds()
                self.paused_at = None

        if self.actual_start and self.actual_end and self.actual_hours is None:
            total_seconds = (self.actual_end - self.actual_start).total_seconds()
            total_seconds -= self.paused_seconds or 0
            if self.paused_at:
                total_seconds -= (now - self.paused_at).total_seconds()
            self.actual_hours = round(max(total_seconds, 0) / 3600, 2)

        super().save(*args, **kwargs)

    @property
    def worked_hours(self):
        """Horas trabalhadas para exibição: usa `actual_hours` quando
        registrado; se a tarefa foi concluída sem apontamento real, cai
        para a duração prevista (planned_start/planned_end) como estimativa."""
        if self.actual_hours is not None:
            return float(self.actual_hours)
        if self.status == self.STATUS_COMPLETED and self.planned_start and self.planned_end:
            return round(max((self.planned_end - self.planned_start).total_seconds(), 0) / 3600, 2)
        return 0.0


class ProjectTaskAssignment(TimestampedModel):
    """Through model de ProjectTask.collaborators — guarda quem despachou a
    tarefa pra cada técnico, quando, e a posição dela na fila do técnico
    (várias tarefas podem ser despachadas pra um técnico, mas só uma fica
    'em execução' por vez; as demais aguardam nessa ordem)."""

    project_task = models.ForeignKey(ProjectTask, on_delete=models.CASCADE, related_name="assignments")
    collaborator = models.ForeignKey(Collaborator, on_delete=models.CASCADE, related_name="task_assignments")
    dispatched_at = models.DateTimeField("despachado em", auto_now_add=True)
    dispatched_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="despachado por",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="+",
    )
    queue_order = models.PositiveIntegerField("posição na fila", default=0)

    class Meta:
        verbose_name = "Despacho de Tarefa"
        verbose_name_plural = "Despachos de Tarefa"
        ordering = ("queue_order", "dispatched_at")
        constraints = [
            models.UniqueConstraint(fields=("project_task", "collaborator"), name="unique_assignment_per_task_collaborator")
        ]

    def __str__(self):
        return f"{self.project_task} → {self.collaborator}"


class TaskDependency(models.Model):
    """Dependência entre tarefas (ex: Lançamento → Organização → Patching →
    Certificação). A regra de que as duas tarefas pertencem ao mesmo
    ProjectItem é validada em clean() (não dá pra expressar em CHECK
    constraint comparando FK de duas linhas diferentes — mesmo padrão já
    usado em ProjectTask.validate_unique_for_rack_positions). "Disponível
    pra despacho" é sempre calculado na hora (sem dependências, ou todas
    com status=completed), não existe uma flag guardada aqui."""

    task = models.ForeignKey(ProjectTask, verbose_name="tarefa", on_delete=models.CASCADE, related_name="dependencies")
    depends_on = models.ForeignKey(
        ProjectTask, verbose_name="depende de", on_delete=models.CASCADE, related_name="dependents"
    )
    created_at = models.DateTimeField("criado em", auto_now_add=True)

    class Meta:
        verbose_name = "Dependência de Tarefa"
        verbose_name_plural = "Dependências de Tarefa"
        constraints = [
            models.UniqueConstraint(fields=("task", "depends_on"), name="unique_task_dependency"),
            models.CheckConstraint(check=~models.Q(task=models.F("depends_on")), name="dependency_not_self"),
        ]

    def __str__(self):
        return f"{self.task} depende de {self.depends_on}"

    def clean(self):
        super().clean()
        if self.task_id and self.depends_on_id and self.task_id == self.depends_on_id:
            raise ValidationError({"depends_on": "Uma tarefa não pode depender de si mesma."})
        if (
            self.task_id
            and self.depends_on_id
            and self.task.project_item_id
            and self.depends_on.project_item_id
            and self.task.project_item_id != self.depends_on.project_item_id
        ):
            raise ValidationError({"depends_on": "As duas tarefas precisam pertencer ao mesmo item do projeto."})


class TaskExecutionEvent(models.Model):
    """Log de execução, append-only — nunca editar/apagar uma linha depois
    de criada (não tem updated_at de propósito; ver TaskExecutionEventAdmin
    pra reforçar isso no admin). Registra cada evento (despacho, início,
    pausa, retomada, conclusão, reabertura, cancelamento) separadamente, em
    vez de só guardar uma duração final — assim o histórico não se perde
    quando a tarefa é editada ou reaberta."""

    EVENT_DISPATCHED = "DISPATCHED"
    EVENT_STARTED = "STARTED"
    EVENT_PAUSED = "PAUSED"
    EVENT_RESUMED = "RESUMED"
    EVENT_COMPLETED = "COMPLETED"
    EVENT_REOPENED = "REOPENED"
    EVENT_CANCELLED = "CANCELLED"
    EVENT_CHOICES = (
        (EVENT_DISPATCHED, "Despachada"),
        (EVENT_STARTED, "Iniciada"),
        (EVENT_PAUSED, "Pausada"),
        (EVENT_RESUMED, "Retomada"),
        (EVENT_COMPLETED, "Concluída"),
        (EVENT_REOPENED, "Reaberta"),
        (EVENT_CANCELLED, "Cancelada"),
    )

    # PROTECT (não CASCADE, diferente de ProjectTaskAssignment) — de
    # propósito: impede apagar uma ProjectTask que já tem histórico de
    # execução, força cancelamento em vez de exclusão.
    project_task = models.ForeignKey(
        ProjectTask, verbose_name="tarefa", on_delete=models.PROTECT, related_name="execution_events"
    )
    event_type = models.CharField("evento", max_length=20, choices=EVENT_CHOICES)
    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.PROTECT,
        null=True, blank=True, related_name="task_execution_events",
    )
    occurred_at = models.DateTimeField("ocorrido em", default=timezone.now)
    quantity_delta = models.DecimalField(
        "quantidade incremental", max_digits=10, decimal_places=2, null=True, blank=True,
        help_text="Incremento concluído NESTE evento — não o total acumulado.",
    )
    productive_seconds = models.PositiveIntegerField("segundos produtivos", null=True, blank=True)
    unproductive_seconds = models.PositiveIntegerField("segundos improdutivos", null=True, blank=True)
    notes = models.TextField("observações", blank=True)
    metadata = models.JSONField("metadados", default=dict, blank=True)
    created_at = models.DateTimeField("registrado em", auto_now_add=True)

    class Meta:
        verbose_name = "Evento de Execução"
        verbose_name_plural = "Eventos de Execução"
        ordering = ("occurred_at",)
        indexes = [
            models.Index(fields=("project_task", "occurred_at")),
            models.Index(fields=("collaborator", "occurred_at")),
        ]

    def __str__(self):
        return f"{self.project_task} - {self.get_event_type_display()}"


def merged_worked_hours(tasks):
    """Soma horas trabalhadas de um conjunto de ProjectTask evitando contar
    duas vezes o tempo em que houve sobreposição (ex: técnico inicia várias
    tarefas ao mesmo tempo e as conclui dentro da mesma janela — cada tarefa
    tem sua própria duração de X minutos, mas o tempo real trabalhado foi só
    X minutos, não X × número de tarefas).

    Mescla os intervalos [actual_start, actual_end] que se sobrepõem antes de
    somar a duração; tarefas sem actual_start/actual_end (usam a estimativa de
    `worked_hours`) são somadas à parte, sem tentar detectar sobreposição."""
    intervals = []
    flat_hours = 0.0
    for task in tasks:
        if task.actual_start and task.actual_end:
            intervals.append((task.actual_start, task.actual_end))
        else:
            flat_hours += task.worked_hours

    intervals.sort(key=lambda interval: interval[0])
    merged = []
    for start, end in intervals:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))

    merged_seconds = sum((end - start).total_seconds() for start, end in merged)
    return round(merged_seconds / 3600 + flat_hours, 2)


class ProjectOccurrence(TimestampedModel):
    SEVERITY_LOW = "low"
    SEVERITY_MEDIUM = "medium"
    SEVERITY_HIGH = "high"
    SEVERITY_CRITICAL = "critical"
    SEVERITY_CHOICES = (
        (SEVERITY_LOW, "Baixa"),
        (SEVERITY_MEDIUM, "Média"),
        (SEVERITY_HIGH, "Alta"),
        (SEVERITY_CRITICAL, "Crítica"),
    )

    STATUS_OPEN = "open"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_RESOLVED = "resolved"
    STATUS_CANCELED = "canceled"
    STATUS_CHOICES = (
        (STATUS_OPEN, "Aberta"),
        (STATUS_IN_PROGRESS, "Em Andamento"),
        (STATUS_RESOLVED, "Resolvida"),
        (STATUS_CANCELED, "Cancelada"),
    )

    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="occurrences")
    title = models.CharField("título", max_length=200)
    description = models.TextField("descrição", blank=True)
    responsible = models.ForeignKey(
        Collaborator, verbose_name="responsável", on_delete=models.SET_NULL, null=True, blank=True, related_name="occurrences"
    )
    severity = models.CharField("criticidade", max_length=20, choices=SEVERITY_CHOICES, default=SEVERITY_MEDIUM)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_OPEN)
    occurred_at = models.DateField("data da ocorrência", default=timezone.now)
    resolved_at = models.DateField("data de resolução", null=True, blank=True)

    class Meta:
        verbose_name = "Ocorrência do Projeto"
        verbose_name_plural = "Ocorrências do Projeto"
        ordering = ("-occurred_at", "-id")

    def __str__(self):
        return f"{self.project} - {self.title}"

    def save(self, *args, **kwargs):
        if self.status == self.STATUS_RESOLVED and not self.resolved_at:
            self.resolved_at = timezone.now().date()
        elif self.status != self.STATUS_RESOLVED:
            self.resolved_at = None
        super().save(*args, **kwargs)


def project_attachment_upload_to(instance, filename):
    return f"project_attachments/{instance.project_id}/{filename}"


class ProjectAttachment(TimestampedModel):
    project = models.ForeignKey(Project, verbose_name="projeto", on_delete=models.CASCADE, related_name="attachments")
    file = models.FileField("arquivo", upload_to=project_attachment_upload_to)
    description = models.CharField("descrição", max_length=255, blank=True)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="enviado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="project_attachments",
    )

    class Meta:
        verbose_name = "Anexo do Projeto"
        verbose_name_plural = "Anexos do Projeto"
        ordering = ("-created_at",)

    def __str__(self):
        return f"{self.project} - {self.file.name.rsplit('/', 1)[-1]}"
