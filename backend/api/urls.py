from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .auth_views import ThrottledTokenObtainPairView, ThrottledTokenRefreshView

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("project-tasks", views.ProjectTaskViewSet, basename="project-task")
router.register("clients", views.ClientViewSet, basename="client")
router.register("sites", views.SiteViewSet, basename="site")
router.register("collaborators", views.CollaboratorViewSet, basename="collaborator")
router.register("daily-updates", views.DailyUpdateViewSet, basename="daily-update")
router.register("project-updates", views.ProjectDailyUpdateViewSet, basename="project-update")
router.register("my-tasks", views.MyTaskViewSet, basename="my-task")
router.register("registry/companies", views.CompanyViewSet, basename="registry-company")
router.register("registry/categories", views.CategoryViewSet, basename="registry-category")
router.register("registry/project-types", views.ProjectTypeViewSet, basename="registry-project-type")
router.register("registry/job-titles", views.JobTitleViewSet, basename="registry-job-title")
router.register("registry/sites", views.SiteRegistryViewSet, basename="registry-site")
router.register("registry/clients", views.ClientRegistryViewSet, basename="registry-client")
router.register("registry/client-responsibles", views.ClientResponsibleViewSet, basename="registry-client-responsible")
router.register("registry/responsibles", views.ResponsibleViewSet, basename="registry-responsible")
router.register("registry/collaborators", views.CollaboratorRegistryViewSet, basename="registry-collaborator")
router.register("registry/tasks", views.TaskViewSet, basename="registry-task")

urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token-obtain-pair"),
    path("token/refresh/", ThrottledTokenRefreshView.as_view(), name="token-refresh"),
    path("me/", views.MeView.as_view(), name="me"),
    path("", include(router.urls)),
]
