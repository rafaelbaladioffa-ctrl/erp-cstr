from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin

from .models import CableAlias, CableFamily


class CableAliasInline(admin.TabularInline):
    model = CableAlias
    extra = 1
    fields = ("alias", "alias_type", "active")


@admin.register(CableFamily)
class CableFamilyAdmin(CSVImportExportMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("code", "name", "medium", "fiber_count", "cable_category", "active", "updated_at")
    list_filter = ("medium", "active", "preterminated")
    search_fields = ("code", "name", "description")
    readonly_fields = ("created_at", "updated_at", "created_by", "updated_by")
    inlines = [CableAliasInline]

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
