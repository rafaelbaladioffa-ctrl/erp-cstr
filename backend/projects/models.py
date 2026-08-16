from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.utils import timezone

from core.models import Category, Client, Collaborator, Company, ProjectType, Responsible, Site, Task, TimestampedModel


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
    task = models.ForeignKey(Task, verbose_name="tarefa", on_delete=models.PROTECT, related_name="project_tasks")
    rack_positions = models.ManyToManyField(
        RackPosition,
        verbose_name="Rack Positions",
        related_name="project_tasks",
        blank=True,
    )
    collaborators = models.ManyToManyField(
        Collaborator,
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

    class Meta:
        verbose_name = "Tarefa do Projeto"
        verbose_name_plural = "Tarefas do Projeto"
        ordering = ("order", "id")

    def __str__(self):
        return f"{self.project} - {self.task}"

    def clean(self):
        super().clean()
        errors = {}
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
        salvar)."""
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
