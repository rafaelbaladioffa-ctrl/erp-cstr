import csv
import io
from datetime import datetime

from django import forms
from django.contrib import admin
from django.contrib import messages
from django.db import transaction
from django.db.models import Max, Q, Sum
from django.http import HttpResponse
from django.template.response import TemplateResponse
from django.urls import path, reverse
from django.shortcuts import redirect
from django.utils.html import format_html
from unfold.admin import ModelAdmin, TabularInline

from core.admin_mixins import SelectablePageSizeAdminMixin
from core.models import Category, Client, ClientResponsible, Collaborator, Company, ProjectType, Responsible, Site, Task
from .models import Project, ProjectHistory, ProjectTask


class ProjectTaskMultipleChoiceField(forms.ModelMultipleChoiceField):
    def label_from_instance(self, obj):
        return f"{obj.order} — {obj.task.name}"


class ProjectCSVImportForm(forms.Form):
    csv_file = forms.FileField(
        label="Arquivo CSV",
        widget=forms.ClearableFileInput(
            attrs={"class": "project-csv-input", "accept": ".csv,text/csv"}
        ),
    )


class ProjectAdminForm(forms.ModelForm):
    BULK_ACTION_UPDATE = "update"
    BULK_ACTION_DELETE = "delete"

    import_tasks_from_project_type = forms.BooleanField(
        label="Inserir Tarefas",
        required=False,
    )
    bulk_task_action = forms.ChoiceField(
        label="Ação em Massa",
        required=False,
        choices=(
            ("", "Selecione uma ação"),
            (BULK_ACTION_UPDATE, "Atualizar tarefas selecionadas"),
            (BULK_ACTION_DELETE, "Excluir tarefas selecionadas"),
        ),
    )
    bulk_collaborators = forms.ModelMultipleChoiceField(
        label="Responsáveis",
        required=False,
        queryset=Collaborator.objects.none(),
        widget=forms.SelectMultiple(
            attrs={
                "class": "project-bulk-multiselect",
                "data-placeholder": "Selecione um ou mais responsáveis",
            }
        ),
    )
    bulk_tasks = ProjectTaskMultipleChoiceField(
        label="Tarefas",
        required=False,
        queryset=ProjectTask.objects.none(),
        widget=forms.SelectMultiple(
            attrs={
                "class": "project-bulk-multiselect",
                "data-placeholder": "Selecione as tarefas que serão alteradas",
            }
        ),
    )
    bulk_status = forms.ChoiceField(
        label="Status",
        required=False,
        choices=(("", "Manter status atual"),) + ProjectTask.STATUS_CHOICES,
    )
    bulk_start = forms.DateTimeField(
        label="Início",
        required=False,
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=("%Y-%m-%dT%H:%M",),
    )
    bulk_end = forms.DateTimeField(
        label="Término",
        required=False,
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=("%Y-%m-%dT%H:%M",),
    )
    bulk_estimated_hours = forms.DecimalField(
        label="Horas",
        required=False,
        min_value=0,
        max_digits=8,
        decimal_places=2,
    )

    class Meta:
        model = Project
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        company_id = self.data.get("company") or getattr(self.instance, "company_id", None)
        queryset = Collaborator.objects.filter(is_active=True).order_by("name")
        self.fields["bulk_collaborators"].queryset = queryset.filter(company_id=company_id) if company_id else queryset.none()
        if self.instance and self.instance.pk:
            self.fields["bulk_tasks"].queryset = self.instance.project_tasks.select_related("task").order_by("order", "id")

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("import_tasks_from_project_type") and not cleaned_data.get("project_type"):
            self.add_error("project_type", "Selecione um Tipo de Projeto para inserir suas tarefas.")
        if cleaned_data.get("bulk_start") and cleaned_data.get("bulk_end"):
            if cleaned_data["bulk_end"] < cleaned_data["bulk_start"]:
                self.add_error("bulk_end", "O Término não pode ser anterior ao Início.")
        if cleaned_data.get("bulk_task_action") and not cleaned_data.get("bulk_tasks"):
            self.add_error("bulk_tasks", "Selecione ao menos uma Tarefa para executar a ação em massa.")
        return cleaned_data


class ProjectTaskBulkActionForm(forms.Form):
    BULK_ACTION_UPDATE = "update"
    BULK_ACTION_DELETE = "delete"
    BULK_ACTION_ADD = "add"

    bulk_task_action = forms.ChoiceField(
        label="Ação em Massa",
        required=False,
        choices=(
            ("", "Selecione uma ação"),
            (BULK_ACTION_UPDATE, "Atualizar tarefas selecionadas"),
            (BULK_ACTION_DELETE, "Excluir tarefas selecionadas"),
            (BULK_ACTION_ADD, "Adicionar tarefas ao projeto"),
        ),
    )
    add_tasks = forms.ModelMultipleChoiceField(
        label="Tarefas do Catálogo",
        required=False,
        queryset=Task.objects.none(),
        widget=forms.SelectMultiple(
            attrs={
                "class": "project-bulk-multiselect",
                "data-placeholder": "Selecione as tarefas a incluir no projeto",
            }
        ),
    )
    bulk_collaborators = forms.ModelMultipleChoiceField(
        label="Responsáveis",
        required=False,
        queryset=Collaborator.objects.none(),
        widget=forms.SelectMultiple(
            attrs={
                "class": "project-bulk-multiselect",
                "data-placeholder": "Selecione um ou mais responsáveis",
            }
        ),
    )
    bulk_tasks = ProjectTaskMultipleChoiceField(
        label="Tarefas",
        required=False,
        queryset=ProjectTask.objects.none(),
        widget=forms.SelectMultiple(
            attrs={
                "class": "project-bulk-multiselect",
                "data-placeholder": "Selecione as tarefas que serão alteradas",
            }
        ),
    )
    bulk_status = forms.ChoiceField(
        label="Status",
        required=False,
        choices=(("", "Manter status atual"),) + ProjectTask.STATUS_CHOICES,
    )
    bulk_start = forms.DateTimeField(
        label="Início",
        required=False,
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=("%Y-%m-%dT%H:%M",),
    )
    bulk_end = forms.DateTimeField(
        label="Término",
        required=False,
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}, format="%Y-%m-%dT%H:%M"),
        input_formats=("%Y-%m-%dT%H:%M",),
    )
    bulk_estimated_hours = forms.DecimalField(
        label="Horas",
        required=False,
        min_value=0,
        max_digits=8,
        decimal_places=2,
    )

    def __init__(self, *args, project=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["bulk_collaborators"].queryset = Collaborator.objects.filter(
            is_active=True, company_id=project.company_id
        ).order_by("name") if project else Collaborator.objects.none()
        self.fields["bulk_tasks"].queryset = (
            project.project_tasks.select_related("task").order_by("order", "id") if project else ProjectTask.objects.none()
        )
        if project:
            already_added = project.project_tasks.values_list("task_id", flat=True)
            self.fields["add_tasks"].queryset = Task.objects.filter(is_active=True).exclude(pk__in=already_added).order_by("name")

    def clean(self):
        cleaned_data = super().clean()
        if cleaned_data.get("bulk_start") and cleaned_data.get("bulk_end"):
            if cleaned_data["bulk_end"] < cleaned_data["bulk_start"]:
                self.add_error("bulk_end", "O Término não pode ser anterior ao Início.")
        action = cleaned_data.get("bulk_task_action")
        if action == self.BULK_ACTION_ADD:
            if not cleaned_data.get("add_tasks"):
                self.add_error("add_tasks", "Selecione ao menos uma Tarefa do catálogo para adicionar.")
        elif action and not cleaned_data.get("bulk_tasks"):
            self.add_error("bulk_tasks", "Selecione ao menos uma Tarefa para executar a ação em massa.")
        return cleaned_data


class ProjectTaskInline(TabularInline):
    model = ProjectTask
    extra = 0
    classes = ("collapse",)
    autocomplete_fields = ("task", "collaborators")
    fields = (
        "order",
        "task",
        "collaborators",
        "status",
        "planned_start",
        "planned_end",
        "estimated_hours",
        "actual_start",
        "actual_end",
        "actual_hours",
    )
    readonly_fields = ("actual_start", "actual_end", "actual_hours")
    show_change_link = True


@admin.register(Project)
class ProjectAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    form = ProjectAdminForm
    change_list_template = "admin/projects/project/change_list.html"
    list_display = (
        "project_code_link",
        "project_name_link",
        "po",
        "company",
        "client",
        "site_code",
        "project_type",
        "status",
        "responsible_cstr",
        "link_count",
        "is_active",
    )
    list_display_links = ()
    list_filter = ("company", "status", "site", "project_type", "category", "is_active")
    search_fields = (
        "code",
        "name",
        "po",
        "client__legal_name",
        "client__trade_name",
        "responsible_client__name",
    )
    autocomplete_fields = ("client", "site", "project_type", "category", "responsible_cstr", "responsible_client")
    readonly_fields = ("code", "created_at", "updated_at")
    inlines = (ProjectTaskInline,)
    fieldsets = (
        ("Identificação", {"fields": ("code", "company", "name", "po", "link_count", "status", "is_active")}),
        (
            "Vinculações",
            {
                "fields": (
                    "client",
                    "site",
                    ("project_type", "import_tasks_from_project_type"),
                    "category",
                )
            },
        ),
        ("Responsáveis", {"fields": ("responsible_cstr", "responsible_client")}),
        ("Cronograma", {"fields": (("planned_start", "planned_end"), ("actual_start", "actual_end"))}),
        ("Detalhes", {"fields": ("description", "notes")}),
        (
            "Ações em Massa das Tarefas",
            {
                "fields": (
                    "bulk_task_action",
                    "bulk_tasks",
                    "bulk_collaborators",
                    "bulk_status",
                    ("bulk_start", "bulk_end"),
                    "bulk_estimated_hours",
                ),
                "classes": ("collapse",),
            },
        ),
        ("Auditoria", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    class Media:
        css = {
            "all": (
                "admin/css/vendor/select2/select2.css",
                "admin/css/autocomplete.css",
                "projects/css/project-admin.css",
            )
        }
        js = (
            "admin/js/vendor/jquery/jquery.js",
            "admin/js/vendor/select2/select2.full.js",
            "admin/js/jquery.init.js",
            "projects/js/project-responsible-filter.js",
            "projects/js/project-bulk-actions.js",
        )

    def get_queryset(self, request):
        queryset = super().get_queryset(request)
        if request.resolver_match and request.resolver_match.url_name == "projects_project_changelist":
            queryset = queryset.filter(
                status__in=(
                    Project.STATUS_IN_PROGRESS,
                    Project.STATUS_PLANNING,
                    Project.STATUS_PAUSED,
                )
            )
        return queryset

    def get_urls(self):
        custom_urls = [
            path("import-csv/", self.admin_site.admin_view(self.import_csv_view), name="projects_project_import_csv"),
            path("export-csv/", self.admin_site.admin_view(self.export_csv_view), name="projects_project_export_csv"),
            path(
                "<path:object_id>/overview/",
                self.admin_site.admin_view(self.overview_view),
                name="projects_project_overview",
            ),
            path(
                "<path:object_id>/tasks/bulk/",
                self.admin_site.admin_view(self.tasks_bulk_view),
                name="projects_project_tasks_bulk",
            ),
        ]
        return custom_urls + super().get_urls()

    @staticmethod
    def _csv_relation(model, value, *fields, queryset=None):
        value = (value or "").strip()
        if not value:
            return None
        queryset = queryset if queryset is not None else model.objects.all()
        condition = Q()
        for field in fields:
            condition |= Q(**{f"{field}__iexact": value})
        obj = queryset.filter(condition).first()
        if obj is None:
            raise ValueError(f'Não foi encontrado: "{value}".')
        return obj

    @staticmethod
    def _csv_date(value):
        value = (value or "").strip()
        if not value:
            return None
        for date_format in ("%d/%m/%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(value, date_format).date()
            except ValueError:
                continue
        raise ValueError(f'Data inválida: "{value}". Use DD/MM/AAAA.')

    @staticmethod
    def _csv_int(value, field_label):
        value = (value or "").strip()
        if not value:
            return 0
        try:
            parsed = int(value)
        except ValueError:
            raise ValueError(f'{field_label} inválido: "{value}".')
        if parsed < 0:
            raise ValueError(f'{field_label} não pode ser negativo: "{value}".')
        return parsed

    def export_csv_view(self, request):
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="projetos.csv"'
        response.write("\ufeff")
        writer = csv.writer(response, delimiter=";")
        writer.writerow(
            [
                "codigo", "nome", "po", "empresa", "cliente", "site", "tipo_projeto", "categoria",
                "responsavel_cstr", "responsavel_cliente", "status", "inicio_previsto", "termino_previsto",
                "quantidade_links", "descricao", "observacoes", "ativo",
            ]
        )
        queryset = self.get_queryset(request).select_related(
            "company", "client", "site", "project_type", "category", "responsible_cstr", "responsible_client"
        )
        for project in queryset:
            writer.writerow(
                [
                    project.code,
                    project.name,
                    project.po,
                    project.company.trade_name or project.company.legal_name,
                    project.client.trade_name or project.client.legal_name if project.client else "",
                    project.site.name if project.site else "",
                    project.project_type.name if project.project_type else "",
                    project.category.name if project.category else "",
                    project.responsible_cstr.name if project.responsible_cstr else "",
                    project.responsible_client.name if project.responsible_client else "",
                    project.get_status_display(),
                    project.planned_start.strftime("%d/%m/%Y") if project.planned_start else "",
                    project.planned_end.strftime("%d/%m/%Y") if project.planned_end else "",
                    project.link_count,
                    project.description,
                    project.notes,
                    "Sim" if project.is_active else "Não",
                ]
            )
        return response

    def import_csv_view(self, request):
        form = ProjectCSVImportForm(request.POST or None, request.FILES or None)
        if request.method == "POST" and form.is_valid():
            uploaded_file = form.cleaned_data["csv_file"]
            try:
                content = uploaded_file.read().decode("utf-8-sig")
                sample = content[:4096]
                delimiter = csv.Sniffer().sniff(sample, delimiters=";,\t").delimiter
                rows = csv.DictReader(io.StringIO(content), delimiter=delimiter)
                required_columns = {"nome", "empresa"}
                if not rows.fieldnames or not required_columns.issubset(set(rows.fieldnames)):
                    raise ValueError("O CSV deve conter, no mínimo, as colunas nome e empresa.")

                created = 0
                errors = []
                status_map = {
                    str(label).casefold(): value for value, label in Project.STATUS_CHOICES
                } | {value.casefold(): value for value, _ in Project.STATUS_CHOICES}
                for line_number, row in enumerate(rows, start=2):
                    try:
                        with transaction.atomic():
                            company = self._csv_relation(Company, row.get("empresa"), "legal_name", "trade_name")
                            client = self._csv_relation(Client, row.get("cliente"), "legal_name", "trade_name")
                            site_queryset = Site.objects.filter(client=client) if client else Site.objects.all()
                            site = self._csv_relation(Site, row.get("site"), "name", "code", queryset=site_queryset)
                            project_type = self._csv_relation(ProjectType, row.get("tipo_projeto"), "name")
                            category = self._csv_relation(Category, row.get("categoria"), "name")
                            responsible_cstr = self._csv_relation(Responsible, row.get("responsavel_cstr"), "name")
                            client_responsibles = ClientResponsible.objects.filter(client=client) if client else ClientResponsible.objects.none()
                            responsible_client = self._csv_relation(
                                ClientResponsible,
                                row.get("responsavel_cliente"),
                                "name",
                                queryset=client_responsibles,
                            )
                            status_text = (row.get("status") or "Planejamento").strip().casefold()
                            if status_text not in status_map:
                                raise ValueError(f'Status inválido: "{row.get("status")}".')
                            active_text = (row.get("ativo") or "sim").strip().casefold()
                            project = Project(
                                company=company,
                                name=(row.get("nome") or "").strip(),
                                po=(row.get("po") or "").strip(),
                                client=client,
                                site=site,
                                project_type=project_type,
                                category=category,
                                responsible_cstr=responsible_cstr,
                                responsible_client=responsible_client,
                                status=status_map[status_text],
                                planned_start=self._csv_date(row.get("inicio_previsto")),
                                planned_end=self._csv_date(row.get("termino_previsto")),
                                link_count=self._csv_int(row.get("quantidade_links"), "Quantidade de links"),
                                description=(row.get("descricao") or "").strip(),
                                notes=(row.get("observacoes") or "").strip(),
                                is_active=active_text not in {"não", "nao", "0", "false", "inativo"},
                            )
                            project.full_clean()
                            project.save()
                            created += 1
                    except Exception as exc:
                        errors.append(f"Linha {line_number}: {exc}")

                if created:
                    self.message_user(request, f"{created} Projeto(s) importado(s) com sucesso.")
                if errors:
                    self.message_user(request, " | ".join(errors[:5]), level=messages.ERROR)
                if created and not errors:
                    return redirect("admin:projects_project_changelist")
            except (UnicodeDecodeError, csv.Error, ValueError) as exc:
                self.message_user(request, str(exc), level=messages.ERROR)

        context = {
            **self.admin_site.each_context(request),
            "title": "Importar Projetos via CSV",
            "opts": self.model._meta,
            "form": form,
            "changelist_url": reverse("admin:projects_project_changelist"),
        }
        return TemplateResponse(request, "admin/projects/project/import_csv.html", context)

    def _overview_url(self, obj):
        return reverse("admin:projects_project_overview", args=(obj.pk,))

    @admin.display(description="Código", ordering="code")
    def project_code_link(self, obj):
        return format_html('<a href="{}">{}</a>', self._overview_url(obj), obj.code)

    @admin.display(description="Nome do projeto", ordering="name")
    def project_name_link(self, obj):
        return format_html('<a href="{}">{}</a>', self._overview_url(obj), obj.name)

    @admin.display(description="Site", ordering="site__code")
    def site_code(self, obj):
        return obj.site.code if obj.site else "-"

    @staticmethod
    def _format_hours(value):
        total_minutes = round(float(value or 0) * 60)
        hours, minutes = divmod(total_minutes, 60)
        return f"{hours}h{minutes:02d}min"

    @staticmethod
    def _format_duration(total_seconds):
        total_minutes = max(0, round(total_seconds / 60))
        hours, minutes = divmod(total_minutes, 60)
        return f"{hours}h{minutes:02d}min"

    def overview_view(self, request, object_id):
        project = self.get_object(request, object_id)
        if project is None or not self.has_view_or_change_permission(request, project):
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied

        tasks = project.project_tasks.select_related("task").prefetch_related("collaborators").order_by("order", "id")
        totals = tasks.aggregate(estimated=Sum("estimated_hours"))
        total_tasks = tasks.count()
        completed_tasks = tasks.filter(status=ProjectTask.STATUS_COMPLETED).count()
        progress = round((completed_tasks / total_tasks) * 100) if total_tasks else 0
        worked_seconds = sum(project_task.worked_hours for project_task in tasks) * 3600
        task_rows = []
        team = []
        seen_collaborators = set()
        for project_task in tasks:
            collaborators = list(project_task.collaborators.all())
            task_rows.append(
                {
                    "project_task": project_task,
                    "visible_collaborators": collaborators[:2],
                    "extra_collaborators": collaborators[2:],
                    "extra_count": max(0, len(collaborators) - 2),
                    "worked_hours": self._format_hours(project_task.worked_hours)
                    if project_task.worked_hours
                    else "—",
                    "edit_url": reverse("admin:projects_projecttask_change", args=(project_task.pk,)),
                }
            )
            for collaborator in collaborators:
                if collaborator.pk not in seen_collaborators:
                    seen_collaborators.add(collaborator.pk)
                    team.append(collaborator)

        context = {
            **self.admin_site.each_context(request),
            "title": f"Visão Geral — {project.code}",
            "opts": self.model._meta,
            "project": project,
            "tasks": tasks,
            "task_rows": task_rows,
            "team": team,
            "total_tasks": total_tasks,
            "completed_tasks": completed_tasks,
            "progress": progress,
            "estimated_hours": self._format_hours(totals["estimated"]),
            "actual_hours": self._format_duration(worked_seconds),
            "change_url": reverse("admin:projects_project_change", args=(project.pk,)),
            "changelist_url": reverse("admin:projects_project_changelist"),
            "has_change_permission": self.has_change_permission(request, project),
            "has_delete_permission": self.has_delete_permission(request, project),
            "tasks_bulk_url": reverse("admin:projects_project_tasks_bulk", args=(project.pk,)),
            "task_add_url": reverse("admin:projects_projecttask_add") + f"?project={project.pk}",
            "task_status_choices": ProjectTask.STATUS_CHOICES,
            "bulk_form": ProjectTaskBulkActionForm(project=project),
        }
        return TemplateResponse(request, "admin/projects/project/overview.html", context)

    def _apply_bulk_task_action(self, request, project, cleaned_data):
        """Lógica compartilhada entre o fieldset 'Ações em Massa das Tarefas'
        (formulário de Editar Projeto) e a sub-aba equivalente na Visão Geral
        do Projeto — mesmo comportamento em ambos os lugares."""
        bulk_action = cleaned_data.get("bulk_task_action")
        selected_tasks = cleaned_data.get("bulk_tasks")
        target_tasks = project.project_tasks.filter(pk__in=selected_tasks) if selected_tasks is not None else project.project_tasks.none()

        if bulk_action == ProjectTaskBulkActionForm.BULK_ACTION_ADD:
            add_tasks = cleaned_data.get("add_tasks")
            if not add_tasks:
                self.message_user(request, "Selecione ao menos uma Tarefa do catálogo para adicionar.", level=messages.WARNING)
                return
            next_order = (project.project_tasks.aggregate(highest=Max("order"))["highest"] or 0) + 1
            created = 0
            for task in add_tasks:
                _, was_created = ProjectTask.objects.get_or_create(
                    project=project,
                    task=task,
                    defaults={"order": next_order, "estimated_hours": task.estimated_hours},
                )
                if was_created:
                    created += 1
                    next_order += 1
            self.message_user(request, f"{created} Tarefa(s) adicionada(s) ao Projeto.")
        elif bulk_action == ProjectTaskBulkActionForm.BULK_ACTION_DELETE:
            deleted, _ = target_tasks.delete()
            self.message_user(request, f"{deleted} Tarefa(s) excluída(s) do Projeto.", level=messages.WARNING)
        elif bulk_action == ProjectTaskBulkActionForm.BULK_ACTION_UPDATE:
            updates = {}
            field_map = {
                "bulk_status": "status",
                "bulk_start": "planned_start",
                "bulk_end": "planned_end",
                "bulk_estimated_hours": "estimated_hours",
            }
            for form_field, model_field in field_map.items():
                value = cleaned_data.get(form_field)
                if value not in (None, ""):
                    updates[model_field] = value
            selected_collaborators = cleaned_data.get("bulk_collaborators")
            project_tasks = target_tasks
            if updates:
                updated = project_tasks.update(**updates)
            else:
                updated = 0
            if selected_collaborators:
                for project_task in project_tasks:
                    project_task.collaborators.set(selected_collaborators)
                updated = project_tasks.count()
            if updates or selected_collaborators:
                self.message_user(request, f"{updated} Tarefa(s) atualizada(s) em massa.")
            else:
                self.message_user(request, "Informe ao menos um valor para a atualização em massa.", level=messages.WARNING)

    def tasks_bulk_view(self, request, object_id):
        """Recebe o POST da sub-aba 'Ações em Massa das Tarefas' (dentro de
        Visão Geral > Tarefas) e redireciona de volta com o resultado — o
        formulário em si é renderizado dentro de overview_view/overview.html."""
        project = self.get_object(request, object_id)
        if project is None or not self.has_change_permission(request, project):
            from django.core.exceptions import PermissionDenied

            raise PermissionDenied

        overview_url = reverse("admin:projects_project_overview", args=(project.pk,)) + "#tarefas"

        if request.method == "POST":
            form = ProjectTaskBulkActionForm(request.POST, project=project)
            if form.is_valid():
                self._apply_bulk_task_action(request, project, form.cleaned_data)
            else:
                for field_errors in form.errors.values():
                    for error in field_errors:
                        self.message_user(request, error, level=messages.ERROR)

        return redirect(overview_url)

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        project = form.instance
        if form.cleaned_data.get("import_tasks_from_project_type"):
            tasks = project.project_type.tasks.filter(is_active=True).order_by("name", "id")
            next_order = (project.project_tasks.aggregate(highest=Max("order"))["highest"] or 0) + 1
            created = 0
            for task in tasks:
                _, was_created = ProjectTask.objects.get_or_create(
                    project=project,
                    task=task,
                    defaults={"order": next_order, "estimated_hours": task.estimated_hours},
                )
                if was_created:
                    created += 1
                    next_order += 1
            if created:
                self.message_user(request, f"{created} Tarefa(s) do Tipo de Projeto adicionada(s) com sucesso.")
            else:
                self.message_user(
                    request,
                    "Nenhuma nova Tarefa foi adicionada. Verifique os vínculos do Tipo de Projeto ou as tarefas já existentes.",
                    level=messages.WARNING,
                )

        self._apply_bulk_task_action(request, project, form.cleaned_data)


@admin.register(ProjectHistory)
class ProjectHistoryAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = (
        "project_code_link",
        "project_name_link",
        "po",
        "company",
        "client",
        "site_code",
        "project_type",
        "responsible_cstr",
        "completed_at",
        "is_active",
    )
    list_display_links = ()
    list_filter = ("company", "site", "project_type", "category", "is_active")
    search_fields = (
        "code",
        "name",
        "po",
        "client__legal_name",
        "client__trade_name",
        "responsible_cstr__name",
        "responsible_client__name",
    )
    ordering = ("-actual_end", "-updated_at")

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .filter(status=Project.STATUS_COMPLETED)
            .select_related("company", "client", "site", "project_type", "responsible_cstr")
        )

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    @staticmethod
    def _overview_url(obj):
        return reverse("admin:projects_project_overview", args=(obj.pk,))

    @admin.display(description="Código", ordering="code")
    def project_code_link(self, obj):
        return format_html('<a href="{}">{}</a>', self._overview_url(obj), obj.code)

    @admin.display(description="Nome do Projeto", ordering="name")
    def project_name_link(self, obj):
        return format_html('<a href="{}">{}</a>', self._overview_url(obj), obj.name)

    @admin.display(description="Site", ordering="site__code")
    def site_code(self, obj):
        return obj.site.code if obj.site else "-"

    @admin.display(description="Conclusão", ordering="actual_end", empty_value="—")
    def completed_at(self, obj):
        return obj.actual_end

    @admin.display(description="Editar")
    def edit_link(self, obj):
        url = reverse("admin:projects_project_change", args=(obj.pk,))
        return format_html('<a href="{}">Editar</a>', url)


@admin.register(ProjectTask)
class ProjectTaskAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("project", "task", "collaborators_display", "status", "order", "planned_start", "planned_end")
    list_filter = ("status", "project__company", "project")
    search_fields = ("project__code", "project__name", "task__code", "task__name", "collaborators__name")
    autocomplete_fields = ("project", "task", "collaborators")
    readonly_fields = ("created_at", "updated_at")

    @admin.display(description="Responsáveis")
    def collaborators_display(self, obj):
        names = [collaborator.name for collaborator in obj.collaborators.all()]
        return ", ".join(names) if names else "-"

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("collaborators")

    def get_model_perms(self, request):
        """Mantém as rotas para os links internos, mas oculta o submódulo do menu."""
        return {}
