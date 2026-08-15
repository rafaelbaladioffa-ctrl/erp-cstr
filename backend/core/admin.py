import json

from django import forms
from django.contrib import admin
from django.db import models
from django.template.response import TemplateResponse
from django.urls import path, reverse
from unfold.admin import ModelAdmin, TabularInline
from .admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin
from .models import Category, Client, ClientResponsible, Collaborator, Company, JobTitle, ProjectType, Responsible, Site, Task


class PhoneMaskAdminMixin:
    class Media:
        js = ("core/js/phone-mask.js",)


@admin.register(Company)
class CompanyAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("legal_name", "trade_name", "tax_id", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("legal_name", "trade_name", "tax_id")
    readonly_fields = ("created_at", "updated_at")


class CompanyScopedAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_filter = ("company", "is_active")
    readonly_fields = ("created_at", "updated_at")


@admin.register(Site)
class SiteAdmin(CompanyScopedAdmin):
    change_list_template = "admin/core/site/change_list.html"
    list_display = ("code", "name", "company", "city", "state", "geocode_status", "is_active")
    search_fields = ("code", "name", "city")
    actions = ("regeocode_selected",)
    fieldsets = (
        (None, {"fields": ("company", "name", "code", "is_active")}),
        ("Endereço", {"fields": ("address", "city", "state")}),
        (
            "Geolocalização",
            {
                "fields": ("manual_coordinates", "latitude", "longitude"),
                "description": (
                    "Por padrão, latitude/longitude são preenchidas automaticamente a partir do endereço "
                    "(via OpenStreetMap/Nominatim) ao salvar. Marque \"coordenadas manuais\" para digitar "
                    "os valores você mesmo — nesse caso a geocodificação automática não roda."
                ),
            },
        ),
        ("Auditoria", {"fields": ("created_at", "updated_at"), "classes": ("collapse",)}),
    )

    @admin.display(description="Geolocalização")
    def geocode_status(self, obj):
        if obj.latitude is None or obj.longitude is None:
            return "Sem coordenadas"
        return "Manual" if obj.manual_coordinates else "Localizado"

    @admin.action(description="Reprocessar geocodificação (endereço → coordenadas)")
    def regeocode_selected(self, request, queryset):
        import time

        updated = 0
        skipped_manual = 0
        failed = 0
        candidates = list(queryset.exclude(manual_coordinates=True))
        skipped_manual = queryset.filter(manual_coordinates=True).count()
        for index, site in enumerate(candidates):
            if index:
                time.sleep(1)  # respeita o limite de 1 req/s do Nominatim
            site.geocoded_address = ""
            site.save()
            site.refresh_from_db()
            if site.latitude is not None and site.longitude is not None:
                updated += 1
            else:
                failed += 1
        message = f"{updated} site(s) geocodificado(s) com sucesso."
        if failed:
            message += f" {failed} não foram encontrados pelo serviço de geocodificação."
        if skipped_manual:
            message += f" {skipped_manual} ignorado(s) por ter coordenadas manuais."
        self.message_user(request, message)

    def get_urls(self):
        return [
            path(
                "mapa/",
                self.admin_site.admin_view(self.map_view),
                name="core_site_map",
            )
        ] + super().get_urls()

    def map_view(self, request):
        from projects.models import Project

        sites = (
            self.get_queryset(request)
            .filter(is_active=True, latitude__isnull=False, longitude__isnull=False)
            .select_related("company")
        )
        active_projects = (
            Project.objects.filter(site__in=sites, status=Project.STATUS_IN_PROGRESS)
            .select_related("client", "site")
            .order_by("name")
        )
        projects_by_site = {}
        for project in active_projects:
            projects_by_site.setdefault(project.site_id, []).append(
                {
                    "code": project.code,
                    "name": project.name,
                    "client": str(project.client) if project.client_id else "",
                    "url": reverse("admin:projects_project_change", args=[project.pk]),
                }
            )

        points = [
            {
                "name": str(site),
                "company": str(site.company) if site.company_id else "",
                "address": site.full_address,
                "lat": float(site.latitude),
                "lng": float(site.longitude),
                "projects": projects_by_site.get(site.pk, []),
            }
            for site in sites
        ]
        without_coords = self.get_queryset(request).filter(is_active=True).filter(
            models.Q(latitude__isnull=True) | models.Q(longitude__isnull=True)
        ).count()
        context = {
            **self.admin_site.each_context(request),
            "title": "Mapa de Sites",
            "points_json": json.dumps(points),
            "points_count": len(points),
            "without_coords": without_coords,
            "opts": self.model._meta,
        }
        return TemplateResponse(request, "admin/core/site/map.html", context)


@admin.register(Collaborator)
class CollaboratorAdmin(CompanyScopedAdmin):
    list_display = ("registration", "yellow_badge", "name", "job_title", "manager", "user", "company", "email", "is_active")
    search_fields = (
        "registration",
        "yellow_badge",
        "name",
        "job_title__name",
        "manager__name",
        "email",
        "user__username",
        "user__email",
    )
    autocomplete_fields = ("job_title", "manager", "user")
    filter_horizontal = ("sites",)
    fields = (
        "company",
        "name",
        "registration",
        "yellow_badge",
        "job_title",
        "manager",
        "user",
        "email",
        "phone",
        "sites",
        "is_active",
        "created_at",
        "updated_at",
    )

    class Media:
        js = ("core/js/phone-mask.js", "core/js/collaborator-manager-filter.js")

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "manager":
            company_id = request.GET.get("company_id")
            queryset = queryset.filter(company_id=company_id) if company_id else queryset.none()
        return queryset, use_distinct


@admin.register(JobTitle)
class JobTitleAdmin(CompanyScopedAdmin):
    list_display = ("name", "company", "is_active", "updated_at")
    search_fields = ("name", "description")


@admin.register(Responsible)
class ResponsibleAdmin(CompanyScopedAdmin):
    list_display = ("name", "company", "user", "email", "phone", "is_active")
    search_fields = ("name", "email", "phone", "user__username", "user__first_name", "user__last_name", "user__email")
    autocomplete_fields = ("user",)

    class Media:
        js = ("core/js/phone-mask.js", "core/js/collaborator-manager-filter.js")


@admin.register(Category)
class CategoryAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("name", "is_active", "updated_at")
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    readonly_fields = ("created_at", "updated_at")


class ProjectTypeAdminForm(forms.ModelForm):
    bulk_names = forms.CharField(
        label="Adicionar Vários",
        required=False,
        widget=forms.Textarea(attrs={"rows": 8, "placeholder": "Digite ou cole um nome por linha"}),
        help_text="Cada linha será cadastrada como um Tipo de Projeto separado, usando a mesma descrição.",
    )

    class Meta:
        model = ProjectType
        fields = "__all__"

    def clean(self):
        cleaned_data = super().clean()
        names = list(dict.fromkeys(line.strip() for line in cleaned_data.get("bulk_names", "").splitlines() if line.strip()))
        current_name = cleaned_data.get("name", "").strip()
        if names and not current_name:
            current_name = names.pop(0)
            cleaned_data["name"] = current_name
            self.instance.name = current_name
        self.additional_names = [name for name in names if name != current_name]
        return cleaned_data


@admin.register(ProjectType)
class ProjectTypeAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    form = ProjectTypeAdminForm
    list_display = ("name", "is_active")
    list_display_links = ("name",)
    list_filter = ("is_active",)
    search_fields = ("name", "description")
    readonly_fields = ("created_at", "updated_at")
    fields = ("name", "bulk_names", "description", "is_active", "created_at", "updated_at")

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        created = 0
        for name in getattr(form, "additional_names", []):
            _, was_created = ProjectType.objects.get_or_create(
                name=name,
                defaults={
                    "description": obj.description,
                    "is_active": obj.is_active,
                },
            )
            created += int(was_created)
        if created:
            self.message_user(request, f"{created} tipo(s) de projeto adicional(is) cadastrado(s).")


class TaskAdminForm(forms.ModelForm):
    bulk_names = forms.CharField(
        label="Adicionar Várias",
        required=False,
        widget=forms.Textarea(attrs={"rows": 8, "placeholder": "Digite ou cole o nome de uma tarefa por linha"}),
        help_text="Cada linha será cadastrada como uma Tarefa separada, com código automático e os mesmos dados complementares.",
    )

    class Meta:
        model = Task
        fields = "__all__"

    def clean(self):
        cleaned_data = super().clean()
        names = list(dict.fromkeys(line.strip() for line in cleaned_data.get("bulk_names", "").splitlines() if line.strip()))
        current_name = cleaned_data.get("name", "").strip()
        if names and not current_name:
            current_name = names.pop(0)
            cleaned_data["name"] = current_name
            self.instance.name = current_name
        self.additional_names = [name for name in names if name != current_name]
        return cleaned_data


@admin.register(Task)
class TaskAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    form = TaskAdminForm
    list_display = ("code", "name", "project_types_display", "estimated_hours", "is_active")
    list_display_links = ("code", "name")
    list_filter = ("is_active", "project_types")
    search_fields = ("code", "name", "description", "project_types__name")
    filter_horizontal = ("project_types",)
    readonly_fields = ("code", "created_at", "updated_at")
    fields = ("code", "name", "bulk_names", "description", "estimated_hours", "project_types", "is_active", "created_at", "updated_at")

    @admin.display(description="Tipos de Projeto")
    def project_types_display(self, obj):
        names = [project_type.name for project_type in obj.project_types.all()]
        return ", ".join(names) if names else "-"

    def get_queryset(self, request):
        return super().get_queryset(request).prefetch_related("project_types")

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        created = 0
        project_types = form.cleaned_data.get("project_types", [])
        for name in getattr(form, "additional_names", []):
            task = Task.objects.create(
                name=name,
                description=form.instance.description,
                estimated_hours=form.instance.estimated_hours,
                is_active=form.instance.is_active,
            )
            task.project_types.set(project_types)
            created += 1
        if created:
            self.message_user(request, f"{created} tarefa(s) adicional(is) cadastrada(s) com códigos automáticos.")


@admin.register(Client)
class ClientAdmin(CompanyScopedAdmin):
    list_display = ("legal_name", "trade_name", "tax_id", "company", "city", "state", "is_active")
    list_filter = ("company", "person_type", "state", "is_active")
    search_fields = ("legal_name", "trade_name", "tax_id", "email", "phone")
    inlines = ()


class ClientResponsibleInline(TabularInline):
    model = ClientResponsible
    extra = 0
    fields = ("name", "job_title", "email", "phone", "is_active")

    class Media:
        js = ("core/js/phone-mask.js",)


ClientAdmin.inlines = (ClientResponsibleInline,)


@admin.register(ClientResponsible)
class ClientResponsibleAdmin(CSVImportExportMixin, PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("name", "client", "job_title", "email", "phone", "is_active")
    list_filter = ("client", "is_active")
    search_fields = ("name", "email", "phone", "job_title", "client__legal_name", "client__trade_name")
    autocomplete_fields = ("client",)
    readonly_fields = ("created_at", "updated_at")

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "responsible_client":
            client_id = request.GET.get("client_id")
            queryset = queryset.filter(client_id=client_id, is_active=True) if client_id else queryset.none()
        return queryset, use_distinct
