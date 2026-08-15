from rest_framework import serializers

from core.models import Client, Collaborator, Site
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


class ProjectSerializer(serializers.ModelSerializer):
    client_name = serializers.SerializerMethodField()
    site_name = serializers.SerializerMethodField()
    status_display = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Project
        fields = (
            "id",
            "code",
            "name",
            "po",
            "client",
            "client_name",
            "site",
            "site_name",
            "status",
            "status_display",
            "planned_start",
            "planned_end",
            "actual_start",
            "actual_end",
            "is_active",
        )

    def get_client_name(self, obj):
        return str(obj.client) if obj.client_id else None

    def get_site_name(self, obj):
        return str(obj.site) if obj.site_id else None


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
