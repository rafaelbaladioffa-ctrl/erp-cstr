from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import CSVImportExportMixin, SelectablePageSizeAdminMixin

from .models import CableAlias, CableFamily


class CableAliasInline(admin.TabularInline):
    model = CableAlias
    extra = 1
    fields = ("alias_text", "is_active")


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
class CableAliasAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("alias_text", "cable_family", "is_active")
    list_filter = ("is_active",)
    search_fields = ("alias_text", "cable_family__code", "cable_family__name")
    autocomplete_fields = ("cable_family",)
