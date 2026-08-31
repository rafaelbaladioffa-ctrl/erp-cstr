from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from audit.models import AuditLog
from core.models import (
    Category,
    Client,
    Collaborator,
    Company,
    JobTitle,
    Notification,
    ProjectType,
    Responsible,
    Site,
    Task,
    get_collaborator_role,
    get_or_create_person,
    update_person,
)
from dispatch.models import TechnicianDailyPresence
from projects.models import Project, ProjectAttachment, ProjectOccurrence, ProjectTask, RackPosition, merged_worked_hours
from updates.models import DailyUpdate, DailyUpdateAllocation, ProjectDailyUpdate
from updates.project_client_mail import build_project_update_body


class ClientSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = ("id", "name", "tax_id", "email", "phone")

    def get_name(self, obj):
        return str(obj)


class SiteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Site
        fields = ("id", "name", "code", "city", "state")


def _get_or_create_person(*, name="", email="", phone="", company=None):
    return get_or_create_person(name=name, email=email, phone=phone, company=company)


def _update_person_from_data(instance, person_data):
    if not person_data:
        return
    update_person(instance.person, **person_data)


class CollaboratorSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="person.name", read_only=True)
    email = serializers.EmailField(source="person.email", read_only=True)

    class Meta:
        model = Collaborator
        fields = ("id", "name", "registration", "email", "is_active")


# ---------------------------------------------------------------------------
# Cadastros Gerais (CRUD completo usado pelo módulo Cadastros do frontend)
# ---------------------------------------------------------------------------


class CompanyCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = Company
        fields = ("id", "legal_name", "trade_name", "tax_id", "email", "phone", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class CategoryCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ("id", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class ProjectTypeCrudSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProjectType
        fields = ("id", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class JobTitleCrudSerializer(serializers.ModelSerializer):
    company_name = serializers.SerializerMethodField()

    class Meta:
        model = JobTitle
        fields = ("id", "company", "company_name", "name", "description", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.company) if obj.company_id else None


class SiteCrudSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Site
        fields = (
            "id", "client", "client_name", "name", "code", "address", "city", "state",
            "manual_coordinates", "latitude", "longitude", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None


class ClientCrudSerializer(serializers.ModelSerializer):
    company_name = serializers.SerializerMethodField()

    class Meta:
        model = Client
        fields = (
            "id", "company", "company_name", "person_type", "legal_name", "trade_name", "tax_id",
            "email", "phone", "address", "city", "state", "notes", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.company) if obj.company_id else None


class ResponsibleCrudSerializer(serializers.ModelSerializer):
    """Responsável unificado — Tipo (`kind`) define se é CSTR (usa
    `company`, via Person) ou Cliente (usa `client` + `job_title`)."""

    name = serializers.CharField(source="person.name", required=False, allow_blank=True)
    email = serializers.EmailField(source="person.email", required=False, allow_blank=True)
    phone = serializers.CharField(source="person.phone", required=False, allow_blank=True)
    company = serializers.PrimaryKeyRelatedField(source="person.company", queryset=Company.objects.all(), required=False, allow_null=True)
    company_name = serializers.SerializerMethodField()
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = Responsible
        fields = (
            "id", "kind", "company", "company_name", "client", "client_name",
            "name", "email", "phone", "job_title", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.person.company) if obj.person_id and obj.person.company_id else None

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def validate(self, attrs):
        kind = attrs.get("kind", getattr(self.instance, "kind", Responsible.KIND_CSTR))
        client = attrs.get("client", getattr(self.instance, "client", None))
        if kind == Responsible.KIND_CLIENT and not client:
            raise serializers.ValidationError({"client": "Obrigatório para Responsável do Cliente."})
        if kind == Responsible.KIND_CSTR and client:
            raise serializers.ValidationError({"client": "Deve ficar em branco para Responsável CSTR."})
        return attrs

    def create(self, validated_data):
        person_data = validated_data.pop("person")
        validated_data["person"] = _get_or_create_person(**person_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        _update_person_from_data(instance, validated_data.pop("person", None))
        return super().update(instance, validated_data)


class CollaboratorCrudSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="person.name", required=False, allow_blank=True)
    email = serializers.EmailField(source="person.email", required=False, allow_blank=True)
    phone = serializers.CharField(source="person.phone", required=False, allow_blank=True)
    company = serializers.PrimaryKeyRelatedField(source="person.company", queryset=Company.objects.all())
    company_name = serializers.SerializerMethodField()
    job_title_name = serializers.SerializerMethodField()
    manager_name = serializers.SerializerMethodField()

    class Meta:
        model = Collaborator
        fields = (
            "id", "company", "company_name", "name", "registration", "yellow_badge", "job_title",
            "job_title_name", "email", "phone", "sites", "manager", "manager_name", "is_active",
            "created_at", "updated_at",
        )
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.person.company) if obj.person_id and obj.person.company_id else None

    def create(self, validated_data):
        person_data = validated_data.pop("person")
        validated_data["person"] = _get_or_create_person(**person_data)
        return super().create(validated_data)

    def update(self, instance, validated_data):
        _update_person_from_data(instance, validated_data.pop("person", None))
        return super().update(instance, validated_data)

    def get_job_title_name(self, obj):
        return str(obj.job_title) if obj.job_title_id else None

    def get_manager_name(self, obj):
        return str(obj.manager) if obj.manager_id else None


class TaskCrudSerializer(serializers.ModelSerializer):
    project_type_names = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = (
            "id", "code", "name", "description", "estimated_hours", "project_types",
            "project_type_names", "is_active", "created_at", "updated_at",
        )
        read_only_fields = ("code", "created_at", "updated_at")

    def get_project_type_names(self, obj):
        return [str(pt) for pt in obj.project_types.all()]


class ProjectSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    site_name = serializers.SerializerMethodField()
    category_name = serializers.SerializerMethodField()
    responsible_cstr_name = serializers.SerializerMethodField()
    responsible_client_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    total_tasks = serializers.SerializerMethodField()
    completed_tasks = serializers.SerializerMethodField()
    worked_hours = serializers.SerializerMethodField()
    progress_percent = serializers.SerializerMethodField()

    class Meta:
        model = Project
        fields = (
            "id",
            "code",
            "company",
            "name",
            "po",
            "link_count",
            "has_rack_positions",
            "client",
            "client_name",
            "site",
            "site_name",
            "category",
            "category_name",
            "project_type",
            "responsible_cstr",
            "responsible_cstr_name",
            "responsible_client",
            "responsible_client_name",
            "description",
            "notes",
            "status",
            "status_display",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "is_active",
            "total_tasks",
            "completed_tasks",
            "worked_hours",
            "progress_percent",
        )

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def get_site_name(self, obj):
        return str(obj.site) if obj.site_id else None

    def get_category_name(self, obj):
        return str(obj.category) if obj.category_id else None

    def get_responsible_cstr_name(self, obj):
        return str(obj.responsible_cstr) if obj.responsible_cstr_id else None

    def get_responsible_client_name(self, obj):
        return str(obj.responsible_client) if obj.responsible_client_id else None

    def _tasks(self, obj):
        return list(obj.project_tasks.all())

    def get_total_tasks(self, obj):
        return len(self._tasks(obj))

    def get_completed_tasks(self, obj):
        return len([t for t in self._tasks(obj) if t.status == "completed"])

    def get_worked_hours(self, obj):
        return merged_worked_hours(self._tasks(obj))

    def get_progress_percent(self, obj):
        tasks = self._tasks(obj)
        if not tasks:
            return 0
        completed = len([t for t in tasks if t.status == "completed"])
        return round((completed / len(tasks)) * 100)

    def _run_model_clean(self, instance):
        from django.core.exceptions import ValidationError as DjangoValidationError

        try:
            instance.clean()
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.message_dict if hasattr(exc, "message_dict") else exc.messages)

    def create(self, validated_data):
        instance = Project(**validated_data)
        self._run_model_clean(instance)
        instance.save()
        return instance

    def update(self, instance, validated_data):
        for field, value in validated_data.items():
            setattr(instance, field, value)
        self._run_model_clean(instance)
        instance.save()
        return instance


class RackPositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RackPosition
        fields = ("id", "project", "position", "dh", "links", "utp", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")


class ProjectTaskSerializer(serializers.ModelSerializer):
    task_name = serializers.CharField(source="display_name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    worked_hours = serializers.SerializerMethodField()
    rack_position_labels = serializers.SerializerMethodField()
    collaborators = CollaboratorSerializer(many=True, read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True, write_only=True, required=False
    )
    queue_order = serializers.SerializerMethodField()

    class Meta:
        model = ProjectTask
        fields = (
            "id",
            "project",
            "project_name",
            "project_code",
            "task",
            "task_name",
            "custom_name",
            "rack_positions",
            "rack_position_labels",
            "collaborators",
            "collaborator_ids",
            "status",
            "status_display",
            "order",
            "queue_order",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "estimated_hours",
            "actual_hours",
            "worked_hours",
            "completion_outcome",
            "quantity_done",
            "notes",
        )

    def get_rack_position_labels(self, obj):
        return [rp.position for rp in obj.rack_positions.all()]

    def get_worked_hours(self, obj):
        return obj.worked_hours

    def get_queue_order(self, obj):
        """Posição desta tarefa na fila do técnico logado (não faz sentido
        fora do contexto de /my-tasks/, onde há um único técnico óbvio;
        em outros contextos retorna None)."""
        request = self.context.get("request")
        if request is None:
            return None
        collaborator = get_collaborator_role(request.user)
        if collaborator is None:
            return None
        assignment = obj.assignments.filter(collaborator=collaborator).first()
        return assignment.queue_order if assignment else None

    def validate(self, attrs):
        rack_positions = attrs.get("rack_positions")
        project = attrs.get("project") or getattr(self.instance, "project", None)
        task = attrs.get("task") if "task" in attrs else getattr(self.instance, "task", None)
        custom_name = attrs.get("custom_name") if "custom_name" in attrs else getattr(self.instance, "custom_name", "")
        if not task and not (custom_name or "").strip():
            raise serializers.ValidationError({"custom_name": "Informe uma Tarefa do catálogo ou um nome avulso."})
        if rack_positions:
            invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
            if invalid:
                names = ", ".join(rp.position for rp in invalid)
                raise serializers.ValidationError({"rack_positions": f"Rack Position(s) que não pertencem a este projeto: {names}."})
        if project and task:
            probe = self.instance or ProjectTask(project_id=project.pk, task_id=task.pk)
            try:
                probe.validate_unique_for_rack_positions(rack_positions or [])
            except DjangoValidationError as exc:
                raise serializers.ValidationError(getattr(exc, "message_dict", None) or {"non_field_errors": exc.messages})
        return attrs


class ProjectOccurrenceSerializer(serializers.ModelSerializer):
    responsible_name = serializers.CharField(source="responsible.person.name", read_only=True, default=None)
    severity_display = serializers.CharField(source="get_severity_display", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = ProjectOccurrence
        fields = (
            "id",
            "project",
            "title",
            "description",
            "responsible",
            "responsible_name",
            "severity",
            "severity_display",
            "status",
            "status_display",
            "occurred_at",
            "resolved_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("resolved_at", "created_at", "updated_at")


class ProjectAttachmentSerializer(serializers.ModelSerializer):
    file_name = serializers.SerializerMethodField()
    file_size = serializers.SerializerMethodField()
    uploaded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = ProjectAttachment
        fields = (
            "id",
            "project",
            "file",
            "file_name",
            "file_size",
            "description",
            "uploaded_by",
            "uploaded_by_name",
            "created_at",
        )
        read_only_fields = ("uploaded_by", "created_at")

    def get_file_name(self, obj):
        return obj.file.name.rsplit("/", 1)[-1] if obj.file else ""

    def get_file_size(self, obj):
        try:
            return obj.file.size
        except (ValueError, FileNotFoundError, OSError):
            return None

    def get_uploaded_by_name(self, obj):
        if not obj.uploaded_by_id:
            return None
        return obj.uploaded_by.get_full_name() or obj.uploaded_by.get_username()


class ProjectTaskCreateSerializer(serializers.Serializer):
    """Cria uma ProjectTask a partir de uma Tarefa do catálogo — uma por
    Rack Position em `rack_position_ids` (ver services.create_task_instances),
    ou uma única sem Rack Position se vier vazio. Usado pelo formulário
    'Nova Tarefa' do frontend, que permite selecionar vários Rack Positions
    de uma vez."""

    task = serializers.PrimaryKeyRelatedField(queryset=Task.objects.filter(is_active=True))
    rack_position_ids = serializers.PrimaryKeyRelatedField(queryset=RackPosition.objects.all(), many=True, required=False, default=list)
    status = serializers.ChoiceField(choices=ProjectTask.STATUS_CHOICES, required=False, default=ProjectTask.STATUS_NOT_STARTED)
    planned_start = serializers.DateTimeField(required=False, allow_null=True, default=None)
    planned_end = serializers.DateTimeField(required=False, allow_null=True, default=None)
    estimated_hours = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        queryset=Collaborator.objects.filter(is_active=True), many=True, required=False, default=list
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs.get("planned_start") and attrs.get("planned_end") and attrs["planned_end"] < attrs["planned_start"]:
            raise serializers.ValidationError({"planned_end": "O término não pode ser anterior ao início."})
        return attrs


class ProjectTaskBulkActionSerializer(serializers.Serializer):
    ACTION_UPDATE = "update"
    ACTION_DELETE = "delete"
    ACTION_ADD = "add"

    action = serializers.ChoiceField(choices=(ACTION_UPDATE, ACTION_DELETE, ACTION_ADD))
    task_ids = serializers.PrimaryKeyRelatedField(queryset=ProjectTask.objects.all(), many=True, required=False, default=list)
    add_task_ids = serializers.PrimaryKeyRelatedField(queryset=Task.objects.filter(is_active=True), many=True, required=False, default=list)
    status = serializers.ChoiceField(choices=ProjectTask.STATUS_CHOICES, required=False, allow_blank=True, default="")
    planned_start = serializers.DateTimeField(required=False, allow_null=True, default=None)
    planned_end = serializers.DateTimeField(required=False, allow_null=True, default=None)
    estimated_hours = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True, default=None)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        queryset=Collaborator.objects.filter(is_active=True), many=True, required=False, default=list
    )
    rack_position_ids = serializers.PrimaryKeyRelatedField(queryset=RackPosition.objects.all(), many=True, required=False, default=list)

    def validate(self, attrs):
        if attrs.get("planned_start") and attrs.get("planned_end") and attrs["planned_end"] < attrs["planned_start"]:
            raise serializers.ValidationError({"planned_end": "O término não pode ser anterior ao início."})
        return attrs


class RackPositionBulkCreateSerializer(serializers.Serializer):
    text = serializers.CharField(allow_blank=False)


class MyTaskUpdateSerializer(serializers.ModelSerializer):
    """Usado em /api/my-tasks/: o técnico só pode alterar o andamento da
    própria tarefa, não o projeto/tarefa/responsáveis atribuídos. Um técnico
    pode ter várias tarefas em andamento ao mesmo tempo — sem essa
    restrição de propósito."""

    class Meta:
        model = ProjectTask
        fields = (
            "id",
            "status",
            "actual_start",
            "actual_end",
            "actual_hours",
            "completion_outcome",
            "quantity_done",
            "notes",
        )


class TechnicianDailyPresenceSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = TechnicianDailyPresence
        fields = ("id", "collaborator", "date", "status", "status_display", "checked_in_at", "checked_out_at")
        read_only_fields = ("collaborator", "date", "status", "checked_in_at", "checked_out_at")


class DailyUpdateAllocationSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True
    )
    collaborators = CollaboratorSerializer(many=True, read_only=True)

    class Meta:
        model = DailyUpdateAllocation
        fields = ("id", "project", "project_name", "collaborators", "collaborator_ids")


class DailyUpdateSerializer(serializers.ModelSerializer):
    allocations = DailyUpdateAllocationSerializer(many=True)
    created_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DailyUpdate
        fields = (
            "id",
            "allocation_date",
            "description",
            "created_by",
            "created_by_name",
            "allocations",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("description", "created_by", "created_at", "updated_at")

    def get_created_by_name(self, obj):
        if not obj.created_by_id:
            return None
        return obj.created_by.get_full_name() or obj.created_by.get_username()

    def create(self, validated_data):
        allocations_data = validated_data.pop("allocations")
        request = self.context["request"]
        daily_update = DailyUpdate.objects.create(created_by=request.user, **validated_data)
        for allocation_data in allocations_data:
            collaborators = allocation_data.pop("collaborators")
            allocation = DailyUpdateAllocation.objects.create(daily_update=daily_update, **allocation_data)
            allocation.collaborators.set(collaborators)
        daily_update.refresh_description()
        return daily_update

    def update(self, instance, validated_data):
        allocations_data = validated_data.pop("allocations", None)
        instance = super().update(instance, validated_data)
        if allocations_data is not None:
            instance.allocations.all().delete()
            for allocation_data in allocations_data:
                collaborators = allocation_data.pop("collaborators")
                allocation = DailyUpdateAllocation.objects.create(daily_update=instance, **allocation_data)
                allocation.collaborators.set(collaborators)
        instance.refresh_description()
        return instance


class ProjectDailyUpdateSerializer(serializers.ModelSerializer):
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    client_name = serializers.SerializerMethodField()
    collaborators = CollaboratorSerializer(many=True, read_only=True)
    collaborator_ids = serializers.PrimaryKeyRelatedField(
        source="collaborators", queryset=Collaborator.objects.filter(is_active=True), many=True, required=False
    )
    is_sent = serializers.BooleanField(read_only=True)
    preview = serializers.SerializerMethodField()

    class Meta:
        model = ProjectDailyUpdate
        fields = (
            "id",
            "project",
            "project_name",
            "project_code",
            "client_name",
            "date",
            "collaborators",
            "collaborator_ids",
            "completion_percent",
            "activities_text",
            "certification_done",
            "project_finished",
            "summary",
            "preview",
            "is_sent",
            "sent_at",
            "created_by",
            "created_at",
            "updated_at",
        )
        read_only_fields = ("sent_at", "created_by", "created_at", "updated_at")

    def get_client_name(self, obj):
        client = obj.project.client if obj.project_id else None
        return str(client) if client else None

    def get_preview(self, obj):
        if not obj.pk:
            return None
        return build_project_update_body(obj)

    def to_representation(self, instance):
        # Recalcula percentual/atividades/certificação/finalização a partir
        # das ProjectTask sempre que a Atualização é lida (lista, detalhe ou
        # resposta de update), em vez de mostrar o valor congelado desde a
        # criação do registro.
        instance.refresh_from_tasks()
        return super().to_representation(instance)


class ProjectDailyUpdateCreateSerializer(serializers.ModelSerializer):
    """Usado apenas na criação: os demais campos são calculados
    automaticamente a partir do projeto (ver ProjectDailyUpdate.save())."""

    class Meta:
        model = ProjectDailyUpdate
        fields = ("id", "project", "date", "summary")

    def create(self, validated_data):
        request = self.context["request"]
        return ProjectDailyUpdate.objects.create(created_by=request.user, **validated_data)


class AuditLogSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    action_display = serializers.CharField(source="get_action_display", read_only=True)

    class Meta:
        model = AuditLog
        fields = (
            "id", "created_at", "actor", "actor_name", "app_label", "model_name", "object_pk", "object_repr",
            "action", "action_display", "field_name", "old_value", "new_value", "origin", "path", "ip_address",
        )

    def get_actor_name(self, obj):
        return str(obj.actor) if obj.actor_id else None


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ("id", "title", "message", "url", "project_id", "project_code", "is_read", "created_at")
        read_only_fields = fields
