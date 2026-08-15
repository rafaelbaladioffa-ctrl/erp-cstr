"""Endpoints agregados para o módulo de Dashboard: Performance de Projetos
e Performance Técnica (colaboradores). Somente leitura — não expõe
ViewSets de escrita, então fica num arquivo separado dos demais views.

Definições usadas nos indicadores (documentadas aqui porque não existe
uma regra de negócio única e óbvia no domínio):

- "Horas trabalhadas" de uma tarefa usa ProjectTask.worked_hours, que já
  cai para a duração prevista quando a tarefa foi concluída sem
  apontamento real (ver projects.models.ProjectTask.worked_hours).
- "Links executados" de um colaborador soma RackPosition.links de todos
  os Rack Positions vinculados às tarefas CONCLUÍDAS em que o colaborador
  está alocado. É a única fonte de contagem de links no nível de
  tarefa/colaborador hoje (Project.link_count é um total do projeto
  inteiro, sem granularidade por tarefa ou colaborador). Se uma tarefa
  cobre vários Rack Positions, todos entram na soma; se vários
  colaboradores estão na mesma tarefa, cada um recebe o total (não é
  dividido) — é uma aproximação intencional, ajustável depois se o
  critério de negócio for outro.
"""

from datetime import date

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import Collaborator
from projects.models import Project, ProjectTask


def _parse_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


class HasDashboardPermission(IsAuthenticated):
    required_perm = None

    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        if request.user.is_superuser:
            return True
        return request.user.has_perm(self.required_perm)


class ProjectsPerformancePermission(HasDashboardPermission):
    required_perm = "projects.view_project"


class TechnicalPerformancePermission(HasDashboardPermission):
    required_perm = "core.view_collaborator"


class ProjectsPerformanceView(APIView):
    """GET /api/dashboard/projects/

    Filtros (query params, todos opcionais): company, client, status,
    date_from, date_to (aplicados em Project.created_at)."""

    permission_classes = [ProjectsPerformancePermission]

    def get(self, request):
        queryset = Project.objects.select_related("company", "client").prefetch_related("project_tasks")

        company_id = request.query_params.get("company")
        client_id = request.query_params.get("client")
        status_param = request.query_params.get("status")
        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))

        if company_id:
            queryset = queryset.filter(company_id=company_id)
        if client_id:
            queryset = queryset.filter(client_id=client_id)
        if status_param:
            queryset = queryset.filter(status=status_param)
        if date_from:
            queryset = queryset.filter(created_at__date__gte=date_from)
        if date_to:
            queryset = queryset.filter(created_at__date__lte=date_to)

        today = timezone.localdate()
        by_status = {}
        total_worked_hours = 0.0
        total_links = 0
        progress_values = []
        overdue_projects = 0
        rows = []

        for project in queryset:
            tasks = list(project.project_tasks.all())
            total_tasks = len(tasks)
            completed_tasks = len([t for t in tasks if t.status == ProjectTask.STATUS_COMPLETED])
            worked_hours = sum(t.worked_hours for t in tasks)
            progress = round((completed_tasks / total_tasks) * 100) if total_tasks else 0

            by_status[project.status] = by_status.get(project.status, 0) + 1
            total_worked_hours += worked_hours
            total_links += project.link_count
            progress_values.append(progress)
            is_overdue = (
                project.planned_end is not None
                and project.planned_end < today
                and project.status not in (Project.STATUS_COMPLETED, Project.STATUS_CANCELED)
            )
            if is_overdue:
                overdue_projects += 1

            rows.append(
                {
                    "id": project.pk,
                    "code": project.code,
                    "name": project.name,
                    "status": project.status,
                    "status_display": project.get_status_display(),
                    "company": str(project.company) if project.company_id else None,
                    "client": str(project.client) if project.client_id else None,
                    "total_tasks": total_tasks,
                    "completed_tasks": completed_tasks,
                    "progress_percent": progress,
                    "worked_hours": round(worked_hours, 2),
                    "link_count": project.link_count,
                    "planned_end": project.planned_end,
                    "is_overdue": is_overdue,
                }
            )

        status_choices = dict(Project.STATUS_CHOICES)
        by_status_list = [
            {"status": key, "status_display": status_choices.get(key, key), "count": value}
            for key, value in sorted(by_status.items())
        ]
        top_projects_by_hours = sorted(rows, key=lambda row: row["worked_hours"], reverse=True)[:10]

        return Response(
            {
                "summary": {
                    "total_projects": len(rows),
                    "overdue_projects": overdue_projects,
                    "avg_progress_percent": round(sum(progress_values) / len(progress_values)) if progress_values else 0,
                    "total_worked_hours": round(total_worked_hours, 2),
                    "total_links": total_links,
                },
                "by_status": by_status_list,
                "top_projects_by_hours": top_projects_by_hours,
                "projects": rows,
            }
        )


class TechnicalPerformanceView(APIView):
    """GET /api/dashboard/technical/

    Filtros (query params, todos opcionais): company, date_from, date_to.
    Quando date_from/date_to são informados, "tarefas concluídas",
    "horas trabalhadas" e "links executados" consideram apenas tarefas
    com término real (actual_end) dentro do período; "tarefas totais"
    sempre reflete todas as tarefas já atribuídas ao colaborador."""

    permission_classes = [TechnicalPerformancePermission]

    def get(self, request):
        company_id = request.query_params.get("company")
        date_from = _parse_date(request.query_params.get("date_from"))
        date_to = _parse_date(request.query_params.get("date_to"))

        collaborators = Collaborator.objects.filter(is_active=True).select_related("company", "job_title")
        if company_id:
            collaborators = collaborators.filter(company_id=company_id)
        collaborators = collaborators.prefetch_related("project_tasks", "project_tasks__rack_positions")

        rows = []
        for collaborator in collaborators:
            tasks = list(collaborator.project_tasks.all())
            tasks_total = len(tasks)

            completed_tasks = [t for t in tasks if t.status == ProjectTask.STATUS_COMPLETED]
            if date_from or date_to:
                def _in_range(task):
                    if not task.actual_end:
                        return False
                    task_date = timezone.localtime(task.actual_end).date() if timezone.is_aware(task.actual_end) else task.actual_end.date()
                    if date_from and task_date < date_from:
                        return False
                    if date_to and task_date > date_to:
                        return False
                    return True

                completed_tasks = [t for t in completed_tasks if _in_range(t)]

            hours_worked = sum(t.worked_hours for t in completed_tasks)
            links_executed = sum(rp.links for t in completed_tasks for rp in t.rack_positions.all())

            rows.append(
                {
                    "collaborator_id": collaborator.pk,
                    "name": collaborator.name,
                    "registration": collaborator.registration,
                    "job_title": str(collaborator.job_title) if collaborator.job_title_id else None,
                    "company": str(collaborator.company) if collaborator.company_id else None,
                    "tasks_total": tasks_total,
                    "tasks_completed": len(completed_tasks),
                    "hours_worked": round(hours_worked, 2),
                    "links_executed": links_executed,
                }
            )

        rows.sort(key=lambda row: row["hours_worked"], reverse=True)

        summary = {
            "total_collaborators": len(rows),
            "total_tasks_completed": sum(row["tasks_completed"] for row in rows),
            "total_hours_worked": round(sum(row["hours_worked"] for row in rows), 2),
            "total_links_executed": sum(row["links_executed"] for row in rows),
        }

        return Response({"summary": summary, "collaborators": rows})
