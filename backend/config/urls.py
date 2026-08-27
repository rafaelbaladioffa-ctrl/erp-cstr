from django.contrib import admin
from django.http import JsonResponse
from django.urls import include, path

from core.views import admin_session_beacon_logout


def health_check(request):
    return JsonResponse({"status": "ok"})


urlpatterns = [
    path("admin/session-beacon-logout/", admin_session_beacon_logout, name="admin-session-beacon-logout"),
    path("admin/", admin.site.urls),
    path("health/", health_check, name="health-check"),
    path("api/", include("api.urls")),
]

admin.site.site_header = "ERP CSTR"
admin.site.site_title = "ERP CSTR"
admin.site.index_title = "Administração"
admin.site.login_template = "core/admin_login.html"
