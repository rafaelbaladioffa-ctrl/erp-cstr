from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import SelectablePageSizeAdminMixin

from .models import ScopeImport


@admin.register(ScopeImport)
class ScopeImportAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("project", "status", "ai_provider", "ai_model", "requested_by", "reviewed_by", "created_at", "confirmed_at")
    list_filter = ("status", "ai_provider", "project__company", "project")
    search_fields = ("project__code", "project__name", "raw_text")
    autocomplete_fields = ("project", "requested_by", "reviewed_by")
    readonly_fields = (
        "raw_text", "ai_provider", "ai_model", "ai_raw_response", "reviewed_payload", "error_message",
        "requested_by", "reviewed_by", "confirmed_at", "created_at", "updated_at",
    )

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
