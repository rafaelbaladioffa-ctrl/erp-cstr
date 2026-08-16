import csv

from django.db import models
from django.http import FileResponse, HttpResponse
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.models import AuditLog
from core.access_scope import (
    deny_if_client_scoped,
    scope_category_queryset,
    scope_client_queryset,
    scope_project_queryset,
    scope_site_queryset,
)
from core.csv_io import MAX_CSV_UPLOAD_BYTES, build_csv_content, import_csv_rows
from core.models import Category, Client, ClientResponsible, Collaborator, Company, JobTitle, ProjectType, Responsible, Site, Task
from projects.models import Project, ProjectTask, RackPosition
from projects.services import (
    BulkActionError,
    add_tasks_to_project,
    apply_bulk_task_update,
    create_rack_positions_bulk,
    create_task_instances,
    import_tasks_from_project_type,
)
from technical.models import MyTask
from updates.mail import send_daily_update_emails
from updates.models import DailyUpdate, ProjectDailyUpdate
from updates.pdf import build_daily_updates_pdf
from updates.project_client_mail import send_project_daily_update_email
from updates.project_pdf import build_project_daily_update_pdf

from .permissions import IsSuperUser, RequireChangePermissionForActions, ViewAwareModelPermissions
from .serializers import (
    AuditLogSerializer,
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
    ProjectTaskBulkActionSerializer,
    ProjectTaskCreateSerializer,
    ProjectTaskSerializer,
    ProjectTypeCrudSerializer,
    RackPositionBulkCreateSerializer,
    RackPositionSerializer,
    ResponsibleCrudSerializer,
    SiteCrudSerializer,
    SiteSerializer,
    TaskCrudSerializer,
)


def clean_bulk_names(raw_names):
    """Normaliza a lista de nomes vinda do textarea 'Adicionar Vários': tira
    espaços, remove vazios e duplicados preservando a ordem — mesmo
    comportamento do ProjectTypeAdminForm/TaskAdminForm no Django Admin."""
    if not isinstance(raw_names, list):
        return []
    return list(dict.fromkeys(name.strip() for name in raw_names if isinstance(name, str) and name.strip()))


class CSVExportImportMixin:
    """Adiciona export-csv (GET) e import-csv (POST multipart) a qualquer
    ViewSet de Cadastros Gerais — mesma lógica usada pelos botões
    'Importar/Exportar CSV' do Django Admin (core/csv_io.py): colunas
    derivadas automaticamente dos campos editáveis do model, relações
    exportadas/importadas pelo texto do __str__ do registro relacionado."""

    @action(detail=False, methods=["get"], url_path="export-csv")
    def export_csv(self, request):
        model = self.get_queryset().model
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{model._meta.model_name}.csv"'
        response.write(build_csv_content(model, self.get_queryset()))
        return response

    @action(detail=False, methods=["post"], url_path="import-csv", parser_classes=[MultiPartParser])
    def import_csv(self, request):
        model = self.get_queryset().model
        uploaded_file = request.FILES.get("csv_file")
        if not uploaded_file:
            return Response({"detail": "Envie um arquivo CSV no campo 'csv_file'."}, status=400)
        if uploaded_file.size > MAX_CSV_UPLOAD_BYTES:
            return Response(
                {"detail": f"Arquivo CSV muito grande (máximo {MAX_CSV_UPLOAD_BYTES // (1024 * 1024)} MB)."},
                status=400,
            )
        try:
            content = uploaded_file.read().decode("utf-8-sig")
            created, errors = import_csv_rows(model, content)
        except (UnicodeDecodeError, csv.Error, ValueError) as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created, "errors": errors})


class RegistryViewSet(CSVExportImportMixin, viewsets.ModelViewSet):
    """Base para os cadastros gerais: CRUD completo com busca simples por
    nome e filtro opcional por is_active, protegido pelas permissões
    padrão do Django (view/add/change/delete) por modelo."""

    permission_classes = [ViewAwareModelPermissions]
    search_fields: tuple[str, ...] = ("name",)

    ORDERING_ALLOWLIST = ("updated_at", "-updated_at", "created_at", "-created_at")

    # Como um usuário-cliente (User.client preenchido) deve ser tratado neste
    # cadastro: "deny" (padrão) nega acesso total — cadastro interno, sem
    # relação direta com Cliente; "client"/"site"/"category" aplicam o
    # escopo correspondente de core.access_scope. Subclasses que representam
    # dado do próprio Cliente (Client, Site, Categoria) sobrescrevem isso.
    client_scope_mode = "deny"
    client_scope_field = None

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
        ordering = self.request.query_params.get("ordering")
        if ordering in self.ORDERING_ALLOWLIST:
            queryset = queryset.order_by(ordering)
        return self.apply_client_scope(queryset)

    def apply_client_scope(self, queryset):
        user = self.request.user
        if self.client_scope_mode == "client":
            return scope_client_queryset(queryset, user, client_field=self.client_scope_field or "id")
        if self.client_scope_mode == "site":
            return scope_site_queryset(queryset, user, client_field=self.client_scope_field or "client_id")
        if self.client_scope_mode == "category":
            return scope_category_queryset(queryset, user)
        return deny_if_client_scoped(queryset, user)


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

    def get_queryset(self):
        return scope_client_queryset(super().get_queryset(), self.request.user)


class SiteViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = Site.objects.filter(is_active=True).order_by("name")
    serializer_class = SiteSerializer

    def get_queryset(self):
        return scope_site_queryset(super().get_queryset(), self.request.user)


class CollaboratorViewSet(viewsets.ReadOnlyModelViewSet):
    """Colaboradores são dados internos (equipe CSTR), não do Cliente — um
    usuário-cliente não deve enxergá-los de forma alguma."""

    queryset = Collaborator.objects.filter(is_active=True).order_by("name")
    serializer_class = CollaboratorSerializer

    def get_queryset(self):
        return deny_if_client_scoped(super().get_queryset(), self.request.user)


class ProjectViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        Project.objects.select_related("client", "site", "category")
        .prefetch_related("project_tasks")
        .order_by("-created_at")
    )
    serializer_class = ProjectSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("tasks_bulk", "import_tasks", "rack_positions_bulk", "tasks_create")

    def get_queryset(self):
        queryset = super().get_queryset()
        status_param = self.request.query_params.get("status")
        if status_param:
            queryset = queryset.filter(status=status_param)
        search = self.request.query_params.get("search")
        if search:
            queryset = queryset.filter(name__icontains=search)
        return scope_project_queryset(queryset, self.request.user)

    @action(detail=True, methods=["get"])
    def tasks(self, request, pk=None):
        project = self.get_object()
        tasks = (
            project.project_tasks.select_related("task")
            .prefetch_related("collaborators", "rack_positions")
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

    @action(detail=True, methods=["post"], url_path="rack-positions/bulk")
    def rack_positions_bulk(self, request, pk=None):
        project = self.get_object()
        if not project.has_rack_positions:
            return Response({"detail": 'Marque "Rack Position" para poder cadastrar Rack Positions.'}, status=400)
        payload = RackPositionBulkCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            created, skipped = create_rack_positions_bulk(project, payload.validated_data["text"])
        except BulkActionError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created, "skipped": skipped})

    @action(detail=True, methods=["post"], url_path="tasks/create")
    def tasks_create(self, request, pk=None):
        project = self.get_object()
        payload = ProjectTaskCreateSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        rack_positions = data["rack_position_ids"]
        invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
        if invalid:
            names = ", ".join(rp.position for rp in invalid)
            return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)

        fields = {
            "status": data["status"],
            "planned_start": data["planned_start"],
            "planned_end": data["planned_end"],
            "estimated_hours": data["estimated_hours"] if data["estimated_hours"] is not None else data["task"].estimated_hours,
            "notes": data["notes"],
        }
        created, skipped = create_task_instances(project, data["task"], rack_positions, collaborators=data["collaborator_ids"], **fields)
        tasks = ProjectTaskSerializer(created, many=True).data
        return Response({"created": len(created), "skipped": skipped, "tasks": tasks})

    @action(detail=True, methods=["post"], url_path="import-tasks")
    def import_tasks(self, request, pk=None):
        project = self.get_object()
        try:
            created = import_tasks_from_project_type(project)
        except BulkActionError as exc:
            return Response({"detail": str(exc)}, status=400)
        return Response({"created": created})

    @action(detail=True, methods=["post"], url_path="tasks/bulk")
    def tasks_bulk(self, request, pk=None):
        project = self.get_object()
        payload = ProjectTaskBulkActionSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data
        bulk_action = data["action"]

        if bulk_action == ProjectTaskBulkActionSerializer.ACTION_ADD:
            add_tasks = data["add_task_ids"]
            if not add_tasks:
                return Response({"detail": "Selecione ao menos uma Tarefa do catálogo para adicionar."}, status=400)
            rack_positions = data["rack_position_ids"]
            if rack_positions:
                invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
                if invalid:
                    names = ", ".join(rp.position for rp in invalid)
                    return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)
            created = add_tasks_to_project(project, add_tasks, rack_positions=rack_positions or None)
            return Response({"created": created})

        selected_ids = [task.pk for task in data["task_ids"]]
        target_tasks = project.project_tasks.filter(pk__in=selected_ids)
        if not selected_ids:
            return Response({"detail": "Selecione ao menos uma Tarefa."}, status=400)

        if bulk_action == ProjectTaskBulkActionSerializer.ACTION_DELETE:
            deleted, _ = target_tasks.delete()
            return Response({"deleted": deleted})

        collaborators = data["collaborator_ids"]
        rack_positions = data["rack_position_ids"]
        if rack_positions:
            invalid = [rp for rp in rack_positions if rp.project_id != project.pk]
            if invalid:
                names = ", ".join(rp.position for rp in invalid)
                return Response({"detail": f"Rack Position(s) que não pertencem a este projeto: {names}."}, status=400)
        has_input = data["status"] or data["planned_start"] or data["planned_end"] or data["estimated_hours"] is not None or collaborators or rack_positions
        if not has_input:
            return Response({"detail": "Informe ao menos um valor para a atualização em massa."}, status=400)
        updated = apply_bulk_task_update(
            target_tasks,
            status=data["status"] or None,
            planned_start=data["planned_start"],
            planned_end=data["planned_end"],
            estimated_hours=data["estimated_hours"],
            collaborators=collaborators,
            rack_positions=rack_positions,
        )
        return Response({"updated": updated})


class ProjectTaskViewSet(viewsets.ModelViewSet):
    queryset = ProjectTask.objects.select_related("task", "project").prefetch_related("collaborators", "rack_positions")
    serializer_class = ProjectTaskSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        queryset = scope_project_queryset(queryset, self.request.user, field_prefix="project__")
        return queryset.order_by("order", "id")

    def perform_create(self, serializer):
        from django.db import transaction

        project = serializer.validated_data["project"]
        with transaction.atomic():
            Project.objects.select_for_update().filter(pk=project.pk).exists()
            next_order = (project.project_tasks.aggregate(highest=models.Max("order"))["highest"] or 0) + 1
            serializer.save(order=serializer.validated_data.get("order") or next_order)


class RackPositionViewSet(viewsets.ModelViewSet):
    queryset = RackPosition.objects.select_related("project").order_by("project_id", "position")
    serializer_class = RackPositionSerializer
    permission_classes = [ViewAwareModelPermissions]

    def get_queryset(self):
        queryset = super().get_queryset()
        project_id = self.request.query_params.get("project")
        if project_id:
            queryset = queryset.filter(project_id=project_id)
        return scope_project_queryset(queryset, self.request.user, field_prefix="project__")


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
    client_scope_mode = "category"


class ProjectTypeViewSet(RegistryViewSet):
    queryset = ProjectType.objects.order_by("name")
    serializer_class = ProjectTypeCrudSerializer
    search_fields = ("name",)

    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request):
        names = clean_bulk_names(request.data.get("names"))
        if not names:
            return Response({"detail": "Informe ao menos um nome."}, status=400)
        description = request.data.get("description", "")
        is_active = request.data.get("is_active", True)
        created = 0
        for name in names:
            _, was_created = ProjectType.objects.get_or_create(
                name=name, defaults={"description": description, "is_active": is_active}
            )
            created += int(was_created)
        return Response({"created": created})


class JobTitleViewSet(RegistryViewSet):
    queryset = JobTitle.objects.select_related("company").order_by("name")
    serializer_class = JobTitleCrudSerializer
    search_fields = ("name",)


class SiteRegistryViewSet(RequireChangePermissionForActions, RegistryViewSet):
    queryset = Site.objects.select_related("client").order_by("name")
    serializer_class = SiteCrudSerializer
    search_fields = ("name", "code", "city")
    change_permission_actions = ("regeocode", "regeocode_bulk")
    client_scope_mode = "site"

    @action(detail=False, methods=["get"], url_path="map-data")
    def map_data(self, request):
        from projects.models import Project

        sites = self.get_queryset().filter(is_active=True, latitude__isnull=False, longitude__isnull=False)
        active_projects = (
            Project.objects.filter(site__in=sites, status=Project.STATUS_IN_PROGRESS)
            .select_related("client", "site")
            .order_by("name")
        )
        projects_by_site = {}
        for project in active_projects:
            projects_by_site.setdefault(project.site_id, []).append(
                {
                    "id": project.pk,
                    "code": project.code,
                    "name": project.name,
                    "client": str(project.client) if project.client_id else "",
                }
            )
        points = [
            {
                "id": site.pk,
                "name": str(site),
                "client": str(site.client) if site.client_id else "",
                "address": site.full_address,
                "lat": float(site.latitude),
                "lng": float(site.longitude),
                "projects": projects_by_site.get(site.pk, []),
            }
            for site in sites
        ]
        without_coords = (
            self.get_queryset()
            .filter(is_active=True)
            .filter(models.Q(latitude__isnull=True) | models.Q(longitude__isnull=True))
            .count()
        )
        return Response({"points": points, "points_count": len(points), "without_coords": without_coords})

    @action(detail=True, methods=["post"])
    def regeocode(self, request, pk=None):
        site = self.get_object()
        if site.manual_coordinates:
            return Response({"detail": "Este site tem coordenadas manuais e não é regeocodificado automaticamente."}, status=400)
        site.geocoded_address = ""
        site.save()
        site.refresh_from_db()
        return Response(SiteCrudSerializer(site).data)

    @action(detail=False, methods=["post"], url_path="regeocode-bulk")
    def regeocode_bulk(self, request):
        import time

        ids = request.data.get("ids")
        queryset = self.get_queryset()
        queryset = queryset.filter(pk__in=ids) if ids else queryset.filter(is_active=True)
        candidates = list(queryset.exclude(manual_coordinates=True))
        skipped_manual = queryset.filter(manual_coordinates=True).count()
        updated = 0
        failed = 0
        for index, site in enumerate(candidates):
            if index:
                time.sleep(1)
            site.geocoded_address = ""
            site.save()
            site.refresh_from_db()
            if site.latitude is not None and site.longitude is not None:
                updated += 1
            else:
                failed += 1
        return Response({"updated": updated, "failed": failed, "skipped_manual": skipped_manual})


class ClientRegistryViewSet(RegistryViewSet):
    queryset = Client.objects.select_related("company").order_by("legal_name")
    serializer_class = ClientCrudSerializer
    search_fields = ("legal_name", "trade_name", "tax_id")
    client_scope_mode = "client"


class ClientResponsibleViewSet(RegistryViewSet):
    queryset = ClientResponsible.objects.select_related("client").order_by("name")
    serializer_class = ClientResponsibleCrudSerializer
    search_fields = ("name", "email")
    client_scope_mode = "client"
    client_scope_field = "client_id"

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

    @action(detail=False, methods=["post"], url_path="bulk-create")
    def bulk_create(self, request):
        names = clean_bulk_names(request.data.get("names"))
        if not names:
            return Response({"detail": "Informe ao menos um nome."}, status=400)
        description = request.data.get("description", "")
        estimated_hours = request.data.get("estimated_hours") or None
        is_active = request.data.get("is_active", True)
        project_types = ProjectType.objects.filter(pk__in=request.data.get("project_types") or [])
        created = 0
        for name in names:
            task = Task.objects.create(
                name=name, description=description, estimated_hours=estimated_hours, is_active=is_active
            )
            task.project_types.set(project_types)
            created += 1
        return Response({"created": created})


class DailyUpdateViewSet(RequireChangePermissionForActions, viewsets.ModelViewSet):
    queryset = (
        DailyUpdate.objects.select_related("created_by")
        .prefetch_related("allocations__project", "allocations__collaborators")
        .order_by("-allocation_date", "-created_at")
    )
    serializer_class = DailyUpdateSerializer
    permission_classes = [ViewAwareModelPermissions]
    change_permission_actions = ("send_email", "pdf", "pdf_consolidado")

    def get_queryset(self):
        queryset = super().get_queryset()
        date_param = self.request.query_params.get("date")
        if date_param:
            queryset = queryset.filter(allocation_date=date_param)
        return deny_if_client_scoped(queryset, self.request.user)

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

    @action(detail=False, methods=["get"], url_path="pdf-consolidado")
    def pdf_consolidado(self, request):
        from django.utils.dateparse import parse_date as parse_date_str

        allocation_date = parse_date_str(request.query_params.get("date", ""))
        if not allocation_date:
            return Response({"detail": "Informe uma data válida (?date=AAAA-MM-DD) para gerar o PDF."}, status=400)
        updates = (
            DailyUpdate.objects.filter(allocation_date=allocation_date)
            .select_related("created_by")
            .prefetch_related("allocations__project__site", "allocations__collaborators")
        )
        if not updates.exists():
            return Response({"detail": "Não existem Atualizações Diárias para a data selecionada."}, status=404)
        filename = f"atualizacao-diaria-{allocation_date:%Y-%m-%d}.pdf"
        return FileResponse(build_daily_updates_pdf(updates, allocation_date), content_type="application/pdf", filename=filename)


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
        return scope_project_queryset(queryset, self.request.user, field_prefix="project__")

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


class AuditLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    """Log de Auditoria: somente leitura e restrito a superusuário — mesmo
    comportamento do Django Admin (AuditLogAdmin), onde nenhum grupo de
    permissões dá acesso e nenhum registro é editável."""

    queryset = AuditLog.objects.select_related("actor").order_by("-created_at", "-id")
    serializer_class = AuditLogSerializer
    permission_classes = [IsSuperUser]

    def get_queryset(self):
        queryset = super().get_queryset()
        params = self.request.query_params
        for field, param in (("action", "action"), ("app_label", "app_label"), ("model_name", "model_name")):
            value = params.get(param)
            if value:
                queryset = queryset.filter(**{field: value})
        date_from = params.get("date_from")
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        date_to = params.get("date_to")
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)
        search = params.get("search")
        if search:
            queryset = queryset.filter(
                models.Q(object_repr__icontains=search)
                | models.Q(actor__username__icontains=search)
                | models.Q(actor__email__icontains=search)
            )
        return queryset
