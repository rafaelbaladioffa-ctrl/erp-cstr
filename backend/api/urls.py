from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from . import views

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("project-tasks", views.ProjectTaskViewSet, basename="project-task")
router.register("clients", views.ClientViewSet, basename="client")
router.register("sites", views.SiteViewSet, basename="site")
router.register("collaborators", views.CollaboratorViewSet, basename="collaborator")
router.register("daily-updates", views.DailyUpdateViewSet, basename="daily-update")
router.register("project-updates", views.ProjectDailyUpdateViewSet, basename="project-update")
router.register("my-tasks", views.MyTaskViewSet, basename="my-task")

urlpatterns = [
    path("token/", TokenObtainPairView.as_view(), name="token-obtain-pair"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token-refresh"),
    path("me/", views.MeView.as_view(), name="me"),
    path("", include(router.urls)),
]
