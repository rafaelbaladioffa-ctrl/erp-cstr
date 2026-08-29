from django.contrib import admin
from unfold.admin import ModelAdmin

from core.admin import PhoneMaskAdminMixin
from core.admin_mixins import SelectablePageSizeAdminMixin

from .models import BotSubscriber


@admin.register(BotSubscriber)
class BotSubscriberAdmin(PhoneMaskAdminMixin, SelectablePageSizeAdminMixin, ModelAdmin):
    list_display = ("name", "phone", "receives_daily_tasks", "receives_project_updates", "is_active")
    list_filter = ("is_active", "receives_daily_tasks", "receives_project_updates")
    search_fields = ("name", "phone")
