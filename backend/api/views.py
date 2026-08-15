from django.http import FileResponse
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Category, Client, ClientResponsible, Collaborator, Company, JobTitle, ProjectType, Responsible, Site, Task
from projects.models import Project, ProjectTask
from technical.models import MyTask
from updates.mail import send_daily_update_emails
from updates.models import DailyUpdate, ProjectDailyUpdate
from updates.pdf import build_daily_updates_pdf
from updates.project_client_mail import send_project_daily_update_email
from updates.project_pdf import build_project_daily_update_pdf

from .permissions import RequireChangePermissionForActions, ViewAwareModelPermissions
from .serializers import (
    ClientCrudSerializer,
    ClientResponsibleCrudSerializer,
    ClientSerializer,
    CollaboratorCrudSerializer,
    CollaboratorSerializer,
    CompanyCrudSerializer,
    CategoryCrudSerializer,
    DailyUpdateSerializer,
    JobTitleCrudSerializer,
    MyTaskUpdateSerializer,
    ProjectDailyUpdateCreateSerializer,
    ProjectDailyUpdateSerializer,
    ProjectSerializer,
    ProjectTaskSerializer,
    ProjectTypeCrudSerializer,
    RackPositionSerializer,
    ResponsibleCrudSerializer,
    SiteCrudSerializer,
    SiteSerializer,
    TaskCrudSerializer,
)


class RegistryViewSet(viewsets.ModelViewSet):
    """Base para os cadastros gerais: CRUD completo com busca simples por
    nome e filtro opcional por is_active, protegido pelas permissões
    padrão do Django (view/add/change/delete) por modelo."""

    permission_classes = [ViewAwareModelPermissions]
    search_fields: tuple[str, ...] = ("name",)

    def get_queryset(self):
        queryset = super().get_queryset()
        is_active = self.request.query_params.get("is_active")
        if is_active is not None:
            queryset = queryset.filter(is_active=is_active.lower() in ("1", "true", "yes"))
        search = self.request.query_params.get("search")
        if search:
            from django.db.models import Q

            condition = Q()
            for field in self.search_fields:
                condition |= Q(**{f"{field}__icontains": search})
            queryset = queryset.filter(condition)
        return queryset


class MeView(APIView):
    def get(self, request):
        user = request.user
        if user.is_superuser:
            permissions = ["*"]
        else:
            permissions = sorted(user.get_all_permissions())
        return Response({
            "id": user.pk,
            "username": user.get_username(),
            "full_name": user.get_full_name(),
            "email": user.email,
            "company_id": user.company_id,
            "is_superuser": user.is_superuser,
            "permissions": permissions,
            "has_collaborator_profile": hasattr(user, "collaborator_profile"),
        })


class ClientViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Client.objects.filter(is_active=True).order_by("legal_name")
    serializer_class = ClientSerializer


class SiteViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Site.objects.filter(is_active=True).order_by("name")
    serializer_class = SiteSerializer


class CollaboratorViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Collaborator.objects.filter(is_active=True).order_by("name")
    serializer_class = CollaboratorSerializer


class ProjectViewSet(viewsets.ModelViewSet):
    queryset = (
        Project.objects.select_related("client", "site", "category")
        .prefetch_related("project_tasks")
        .order_by("-created_at")
    )
    serializer_class = ProjectSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset

    @action(detail=True, methods=["get"])
    def tasks(self, request, pk=None):
        project = self.get_object()
        tasks = (
            project.project_tasks.select_related("task", "rack_position")
            .prefetch_related("collaborators")
            .order_by("order", "id")
        )
        serializer = ProjectTaskSerializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="rack-positions")
    def rack_positions(self, request, pk=None):
        project = self.get_object()
        positions = project.rack_positions.all().order_by("position")
        serializer = RackPositionSerializer(positions, many=True)
        return Response(serializer.data)


class ProjectTaskViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = ProjectTask.objects.select_related("task", "project", "rack_position").prefetch_related("collaborators")
    serializer_class = ProjectTaskSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset.order_by("order", "id")


# ---------------------------------------------------------------------------
# Cadastros Gerais
# ---------------------------------------------------------------------------


class CompanyViewSet(RegistryViewSet):
    queryset = Company.objects.order_by("legal_name")
    serializer_class = CompanyCrudSerializer
    search_fields = ("legal_name", "trade_name", "tax_id")


class CategoryViewSet(RegistryViewSet):
    queryset = Category.objects.order_by("name")
    serializer_class = CategoryCrudSerializer
    search_fields = ("name",)


class ProjectTypeViewSet(RegistryViewSet):
    queryset = ProjectType.objects.order_by("name")
    serializer_class = ProjectTypeCrudSerializer
    search_fields = ("name",)


class JobTitleViewSet(RegistryViewSet):
    queryset = JobTitle.objects.select_related("company").order_by("name")
    serializer_class = JobTitleCrudSerializer
    search_fields = ("name",)


class SiteRegistryViewSet(RegistryViewSet):
    queryset = Site.objects.select_related("client").order_by("name")
    serializer_class = SiteCrudSerializer
    search_fields = ("name", "code", "city")


class ClientRegistryViewSet(RegistryViewSet):
    queryset = Client.objects.select_related("company").order_by("legal_name")
    serializer_class = ClientCrudSerializer
    search_fields = ("legal_name", "trade_name", "tax_id")


class ClientResponsibleViewSet(RegistryViewSet):
    queryset = ClientResponsible.objects.select_related("client").order_by("name")
    serializer_class = ClientResponsibleCrudSerializer
    search_fields = ("name", "email")

    def get_queryset(self):
        queryset = super().get_queryset()
        client_id = self.request.query_params.get("client")
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        return queryset


class ResponsibleViewSet(RegistryViewSet):
    queryset = Responsible.objects.select_related("company").order_by("name")
    serializer_class = ResponsibleCrudSerializer
    search_fields = ("name", "email")


class CollaboratorRegistryViewSet(RegistryViewSet):
    queryset = Collaborator.objects.select_related("company", "job_title", "manager").order_by("name")
    serializer_class = CollaboratorCrudSerializer
    search_fields = ("name", "registration", "yellow_badge")


class TaskViewSet(RegistryViewSet):
    queryset = Task.objects.prefetch_related("project_types").order_by("name")
    serializer_class = TaskCrudSerializer
    search_fields = ("name", "code")


class DailyUpdateViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        DailyUpdate.objects.select_related("created_by")
        .prefetch_related("allocations__project", "allocations__collaborators")
        .order_by("-allocation_date", "-created_at")
    )
    serializer_class = DailyUpdateSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("send_email", "pdf")

    def get_queryset(self):
        queryset = super().get_queryset()
        date_param = self.request.query_params.get("date")
        if date_param:
            queryset = queryset.filter(allocation_date=date_param)
        return queryset

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        daily_update = self.get_object()
        sent, skipped = send_daily_update_emails(daily_update)
        return Response({"sent": sent, "skipped": skipped})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        daily_update = self.get_object()
        pdf_buffer = build_daily_updates_pdf([daily_update], daily_update.allocation_date)
        filename = f"atualizacao-diaria-{daily_update.allocation_date:%Y-%m-%d}.pdf"
        return FileResponse(pdf_buffer, content_type="application/pdf", filename=filename)


class ProjectDailyUpdateViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        ProjectDailyUpdate.objects.select_related("project", "project__client", "created_by")
        .prefetch_related("collaborators")
        .order_by("-date", "-created_at")
    )
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("send_email", "pdf")

    def get_serializer_class(self):
        if self.action == "create":
            return ProjectDailyUpdateCreateSerializer
        return ProjectDailyUpdateSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return queryset

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        instance = ProjectDailyUpdate.objects.get(pk=response.data["id"])
        response.data = ProjectDailyUpdateSerializer(instance).data
        return response

    @action(detail=True, methods=["post"], url_path="send-email")
    def send_email(self, request, pk=None):
        project_update = self.get_object()
        if not project_update.project.client_id:
            return Response({"detail": "O projeto não possui cliente vinculado."}, status=400)
        sent, skipped = send_project_daily_update_email(project_update)
        return Response({"sent": sent, "skipped": skipped})

    @action(detail=True, methods=["get"])
    def pdf(self, request, pk=None):
        project_update = self.get_object()
        pdf_buffer = build_project_daily_update_pdf(project_update)
        filename = f"atualizacao-projeto-{project_update.project.code or project_update.project_id}-{project_update.date:%Y-%m-%d}.pdf"
        return FileResponse(pdf_buffer, content_type="application/pdf", filename=filename)


class MyTaskViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.UpdateModelMixin,
    viewsets.GenericViewSet,
):
    """Módulo Técnico > Minhas Tarefas: cada usuário só vê e só pode
    atualizar as ProjectTask em que o Colaborador vinculado a ele está
    entre os responsáveis. Usa permissões próprias (technical.view_mytask
    / technical.change_mytask), separadas das permissões gerais de
    projects.ProjectTask.
    """

    queryset = MyTask.objects.select_related("project", "task").prefetch_related("collaborators")
    permission_classes = [ViewAwareModelPermissions]

    def get_serializer_class(self):
        if self.action in ("update", "partial_update"):
            return MyTaskUpdateSerializer
        return ProjectTaskSerializer

    def get_queryset(self):
        collaborator = getattr(self.request.user, "collaborator_profile", None)
        if collaborator is None:
            return self.queryset.none()
        return self.queryset.filter(collaborators=collaborator).order_by("planned_start", "order", "id")

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        instance = self.get_object()
        response.data = ProjectTaskSerializer(instance).data
        return response
