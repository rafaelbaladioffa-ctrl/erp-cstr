from django.urls import path

from . import views
from .operations_print import OperationsPrintView

urlpatterns = [
    path("operations-print/", OperationsPrintView.as_view(), name="bot-operations-print"),
    path("allocation/", views.BotAllocationView.as_view(), name="bot-allocation"),
    path("daily-broadcast/", views.BotDailyBroadcastView.as_view(), name="bot-daily-broadcast"),
    path("my-tasks/", views.BotMyTasksView.as_view(), name="bot-my-tasks"),
    path("sites/", views.BotSitesView.as_view(), name="bot-sites"),
    path("projects/", views.BotProjectsView.as_view(), name="bot-projects"),
    path("project-update/", views.BotProjectUpdateView.as_view(), name="bot-project-update"),
    path(
        "broadcasts/daily-tasks/",
        views.BotDailyTasksBroadcastView.as_view(),
        name="bot-broadcast-daily-tasks",
    ),
    path(
        "broadcasts/project-updates/",
        views.BotProjectUpdatesBroadcastView.as_view(),
        name="bot-broadcast-project-updates",
    ),
    path(
        "broadcasts/operations-print-recipients/",
        views.BotOperationsPrintRecipientsView.as_view(),
        name="bot-broadcast-operations-print-recipients",
    ),
]
