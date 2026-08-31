from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin_mixins import SelectablePageSizeAdminMixin

from .models import CollaboratorPair, TechnicianAbsence, TechnicianDailyPresence, TechnicianStatusEvent


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


@admin.register(CollaboratorPair)
class CollaboratorPairAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("collaborator_a", "collaborator_b", "is_active")
    list_filter = ("is_active",)
    search_fields = ("collaborator_a__person__name", "collaborator_b__person__name")
    autocomplete_fields = ("collaborator_a", "collaborator_b")


@admin.register(TechnicianAbsence)
class TechnicianAbsenceAdmin(SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("collaborator", "date_from", "date_to", "reason")
    list_filter = ("date_from",)
    search_fields = ("collaborator__person__name", "reason")
    autocomplete_fields = ("collaborator",)
    readonly_fields = ("created_by", "created_at", "updated_at")
