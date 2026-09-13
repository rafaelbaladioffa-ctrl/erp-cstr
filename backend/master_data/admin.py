from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin

from .models import CableAlias, CableFamily, CableSpec, CertificationType


class CableAliasInline(admin.TabularInline):
    model = CableAlias
    extra = 1
    fields = ("alias", "alias_type", "active")


class CableSpecInline(admin.TabularInline):
    model = CableSpec
    extra = 0
    fields = ("code", "name", "manufacturer", "part_number", "active")
    show_change_link = True


@admin.register(CableFamily)
class CableFamilyAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "medium", "fiber_count", "cable_category", "active", "updated_at")
    list_filter = ("medium", "active", "preterminated")
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")
    inlines = [CableAliasInline, CableSpecInline]

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CableSpec)
class CableSpecAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "cable_family", "part_number", "manufacturer", "active", "updated_at")
    list_filter = ("fiber_type", "polarity", "active")
    search_fields = ("code", "name", "part_number", "manufacturer", "cable_family__code", "cable_family__name")
    autocomplete_fields = ("cable_family",)
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CableAlias)
class CableAliasAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("alias", "cable_family", "alias_type", "active", "updated_at")
    list_filter = ("alias_type", "active")
    search_fields = ("alias", "normalized_alias", "cable_family__code", "cable_family__name")
    autocomplete_fields = ("cable_family",)
    readonly_fields = ("normalized_alias", "created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(CertificationType)
class CertificationTypeAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "medium", "method", "requires_report", "requires_attachment", "active", "updated_at")
    list_filter = ("medium", "active", "requires_report", "requires_attachment")
    search_fields = ("code", "name", "method", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")

    def save_model(self, request, obj, form, change):
        if not change:
            obj.created_by = request.user
        obj.updated_by = request.user
        super().save_model(request, obj, form, change)
