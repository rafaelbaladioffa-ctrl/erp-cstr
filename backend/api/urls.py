from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views
from .auth_views import ThrottledTokenObtainPairView, ThrottledTokenRefreshView
from .dashboard import ProjectsPerformanceView, TechnicalPerformanceView
from .operations import OperationsBoardView, OperationsReportsView, OperationsTimelineView

router = DefaultRouter()
router.register("projects", views.ProjectViewSet, basename="project")
router.register("project-tasks", views.ProjectTaskViewSet, basename="project-task")
router.register("rack-positions", views.RackPositionViewSet, basename="rack-position")
router.register("work-blocks", views.WorkBlockViewSet, basename="work-block")
router.register("project-items", views.ProjectItemViewSet, basename="project-item")
router.register("scope-imports", views.ScopeImportViewSet, basename="scope-import")
router.register("project-occurrences", views.ProjectOccurrenceViewSet, basename="project-occurrence")
router.register("project-attachments", views.ProjectAttachmentViewSet, basename="project-attachment")
router.register("notifications", views.NotificationViewSet, basename="notification")
router.register("clients", views.ClientViewSet, basename="client")
router.register("sites", views.SiteViewSet, basename="site")
router.register("collaborators", views.CollaboratorViewSet, basename="collaborator")
router.register("daily-updates", views.DailyUpdateViewSet, basename="daily-update")
router.register("project-updates", views.ProjectDailyUpdateViewSet, basename="project-update")
router.register("my-tasks", views.MyTaskViewSet, basename="my-task")
router.register("technician-presence", views.TechnicianPresenceViewSet, basename="technician-presence")
router.register("audit-logs", views.AuditLogViewSet, basename="audit-log")
router.register("registry/companies", views.CompanyViewSet, basename="registry-company")
router.register("registry/categories", views.CategoryViewSet, basename="registry-category")
router.register("registry/project-types", views.ProjectTypeViewSet, basename="registry-project-type")
router.register("registry/job-titles", views.JobTitleViewSet, basename="registry-job-title")
router.register("registry/sites", views.SiteRegistryViewSet, basename="registry-site")
router.register("registry/clients", views.ClientRegistryViewSet, basename="registry-client")
router.register("registry/responsibles", views.ResponsibleViewSet, basename="registry-responsible")
router.register("registry/collaborators", views.CollaboratorRegistryViewSet, basename="registry-collaborator")
router.register("registry/tasks", views.TaskViewSet, basename="registry-task")
router.register("registry/activity-types", views.ActivityTypeViewSet, basename="registry-activity-type")
router.register("registry/project-item-types", views.ProjectItemTypeViewSet, basename="registry-project-item-type")

urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token-obtain-pair"),
    path("token/refresh/", ThrottledTokenRefreshView.as_view(), name="token-refresh"),
    path("me/", views.MeView.as_view(), name="me"),
    path("user-options/", views.UserOptionsView.as_view(), name="user-options"),
    path("me/change-password/", views.ChangePasswordView.as_view(), name="change-password"),
    path("search/", views.GlobalSearchView.as_view(), name="global-search"),
    path("dashboard/projects/", ProjectsPerformanceView.as_view(), name="dashboard-projects"),
    path("dashboard/technical/", TechnicalPerformanceView.as_view(), name="dashboard-technical"),
    path("operations/board/", OperationsBoardView.as_view(), name="operations-board"),
    path("operations/timeline/", OperationsTimelineView.as_view(), name="operations-timeline"),
    path("operations/reports/", OperationsReportsView.as_view(), name="operations-reports"),
    path("bot/", include("bot.urls")),
    path("", include(router.urls)),
]
