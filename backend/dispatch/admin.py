from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import SelectablePageSizeAdminMixin

from .models import TechnicianDailyPresence, TechnicianStatusEvent


@admin.register(TechnicianDailyPresence)
class TechnicianDailyPresenceAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("collaborator", "date", "status", "checked_in_at", "checked_out_at")
    list_filter = ("status", "date")
    search_fields = ("collaborator__person__name",)
    autocomplete_fields = ("collaborator",)


@admin.register(TechnicianStatusEvent)
class TechnicianStatusEventAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("collaborator", "date", "status", "changed_at")
    list_filter = ("status", "date")
    search_fields = ("collaborator__person__name",)
    autocomplete_fields = ("collaborator",)
