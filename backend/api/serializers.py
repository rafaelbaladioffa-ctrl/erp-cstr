from rest_framework import serializers

from core.models import Category, Client, ClientResponsible, Collaborator, Company, JobTitle, ProjectType, Responsible, Site, Task
from projects.models import Project, ProjectTask
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


class CollaboratorSerializer(serializers.ModelSerializer):
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


class ClientResponsibleCrudSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()

    class Meta:
        model = ClientResponsible
        fields = ("id", "client", "client_name", "name", "email", "phone", "job_title", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None


class ResponsibleCrudSerializer(serializers.ModelSerializer):
    company_name = serializers.SerializerMethodField()

    class Meta:
        model = Responsible
        fields = ("id", "company", "company_name", "name", "email", "phone", "is_active", "created_at", "updated_at")
        read_only_fields = ("created_at", "updated_at")

    def get_company_name(self, obj):
        return str(obj.company) if obj.company_id else None


class CollaboratorCrudSerializer(serializers.ModelSerializer):
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
        return str(obj.company) if obj.company_id else None

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
            "client",
            "client_name",
            "site",
            "site_name",
            "category",
            "category_name",
            "project_type",
            "responsible_cstr",
            "responsible_client",
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

    def _tasks(self, obj):
        return list(obj.project_tasks.all())

    def get_total_tasks(self, obj):
        return len(self._tasks(obj))

    def get_completed_tasks(self, obj):
        return len([t for t in self._tasks(obj) if t.status == "completed"])

    def get_worked_hours(self, obj):
        return float(sum(t.worked_hours for t in self._tasks(obj)))

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


class ProjectTaskSerializer(serializers.ModelSerializer):
    task_name = serializers.CharField(source="task.name", read_only=True)
    project_name = serializers.CharField(source="project.name", read_only=True)
    project_code = serializers.CharField(source="project.code", read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    collaborators = CollaboratorSerializer(many=True, read_only=True)

    class Meta:
        model = ProjectTask
        fields = (
            "id",
            "project",
            "project_name",
            "project_code",
            "task",
            "task_name",
            "collaborators",
            "status",
            "status_display",
            "order",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "estimated_hours",
            "actual_hours",
            "notes",
        )


class MyTaskUpdateSerializer(serializers.ModelSerializer):
    """Usado em /api/my-tasks/: o técnico só pode alterar o andamento da
    própria tarefa, não o projeto/tarefa/responsáveis atribuídos."""

    class Meta:
        model = ProjectTask
        fields = ("id", "status", "actual_start", "actual_end", "actual_hours", "notes")


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


class ProjectDailyUpdateCreateSerializer(serializers.ModelSerializer):
    """Usado apenas na criação: os demais campos são calculados
    automaticamente a partir do projeto (ver ProjectDailyUpdate.save())."""

    class Meta:
        model = ProjectDailyUpdate
        fields = ("id", "project", "date", "summary")

    def create(self, validated_data):
        request = self.context["request"]
        return ProjectDailyUpdate.objects.create(created_by=request.user, **validated_data)
