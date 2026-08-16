from django.contrib import admin
from django.contrib.auth.admin import GroupAdmin as BaseGroupAdmin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.models import Group
from unfold.admin import ModelAdmin
from unfold.forms import AdminPasswordChangeForm, UserChangeForm, UserCreationForm
from core.admin_mixins import SelectablePageSizeAdminMixin
from .models import User


@admin.register(User)
class ERPUserAdmin(SelectablePageSizeAdminMixin, BaseUserAdmin, ModelAdmin):
    form = UserChangeForm
    add_form = UserCreationForm
    change_password_form = AdminPasswordChangeForm
    fieldsets = BaseUserAdmin.fieldsets + (
        ("ERP", {"fields": ("company",)}),
        (
            "Acesso do Usuário-Cliente",
            {
                "fields": ("client", "client_sites", "client_categories"),
                "description": (
                    "Vincule um Cliente para dar a este usuário acesso de portal do cliente: ele só verá/"
                    "editará/excluirá os Projetos daquele Cliente (e dos Sites marcados, se algum for "
                    "escolhido). Categorias restringe à parte quais Categorias do cadastro ele enxerga, sem "
                    "relação com Cliente/Site. Deixe Cliente em branco para um usuário normal da equipe, sem "
                    "essa restrição."
                ),
            },
        ),
    )
    add_fieldsets = BaseUserAdmin.add_fieldsets + (("ERP", {"fields": ("email", "company")}),)
    autocomplete_fields = ("client",)
    filter_horizontal = ("groups", "user_permissions", "client_sites", "client_categories")
    list_display = ("username", "email", "company", "client", "is_staff", "is_active")
    list_filter = ("company", "client", "is_staff", "is_active", "groups")
    search_fields = ("username", "first_name", "last_name", "email")

    def get_search_results(self, request, queryset, search_term):
        queryset, use_distinct = super().get_search_results(request, queryset, search_term)
        if request.GET.get("field_name") == "user":
            company_id = request.GET.get("company_id")
            queryset = queryset.filter(company_id=company_id) if company_id else queryset.none()
        return queryset, use_distinct


admin.site.unregister(Group)


@admin.register(Group)
class ERPGroupAdmin(SelectablePageSizeAdminMixin, BaseGroupAdmin, ModelAdmin):
    pass
