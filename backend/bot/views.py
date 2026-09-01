from datetime import date, timedelta

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from api.operations import build_board_data
from core.models import Collaborator, Site
from core.phone_utils import phones_match
from projects.models import Project, ProjectTask
from updates.models import DailyUpdateAllocation, ProjectDailyUpdate
from updates.project_client_mail import WORKDAY_END, WORKDAY_START, compute_progress_defaults

from .models import BotSubscriber
from .permissions import BotSharedSecretPermission


def _find_bot_collaborator(name="", phone=""):
    """Acha o Colaborador ativo correspondente ao nome (busca parcial) ou
    telefone informado pelo técnico no bot do WhatsApp. Retorna uma tupla
    (collaborator, ambiguous_matches) — só um dos dois é preenchido."""
    active_collaborators = Collaborator.objects.filter(is_active=True).select_related("person")

    if name:
        matches = list(active_collaborators.filter(person__name__icontains=name))
        if len(matches) > 1:
            return None, [c.person.name for c in matches]
        return (matches[0] if matches else None), None

    collaborator = next(
        (c for c in active_collaborators if c.person.phone and phones_match(c.person.phone, phone)),
        None,
    )
    return collaborator, None


class BotAllocationView(APIView):
    """GET /api/bot/allocation/?name=<nome>  (ou ?phone=<numero>)

    Usado pelo bot do WhatsApp: dado o nome (ou telefone) digitado pelo
    técnico, acha o Colaborador correspondente e retorna em quais
    projetos/sites ele está alocado na Atualização Diária de hoje."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        name = request.query_params.get("name", "").strip()
        phone = request.query_params.get("phone", "")
        if not name and not phone:
            return Response({"detail": "Informe o parâmetro 'name' ou 'phone'."}, status=400)

        collaborator, ambiguous_matches = _find_bot_collaborator(name, phone)
        if ambiguous_matches is not None:
            return Response({"found": "ambiguous", "matches": ambiguous_matches})

        if not collaborator:
            return Response({"found": False})

        today = timezone.localdate()
        allocations = DailyUpdateAllocation.objects.filter(
            daily_update__allocation_date=today,
            collaborators=collaborator,
        ).select_related("project", "project__site")

        return Response(
            {
                "found": True,
                "collaborator_name": collaborator.person.name,
                "date": today.isoformat(),
                "allocations": [
                    {
                        "project": a.project.name,
                        "code": a.project.code,
                        "site": a.project.site.name if a.project.site_id else None,
                    }
                    for a in allocations
                ],
            }
        )


class BotDailyBroadcastView(APIView):
    """GET /api/bot/daily-broadcast/?date=<AAAA-MM-DD, opcional>

    Usado pelo envio automático diário do bot (não é um técnico chamando):
    lista, para a data informada (padrão: amanhã — as Atualizações Diárias
    já são criadas com essa data por padrão, já que o gestor normalmente
    planeja o dia seguinte à tarde), cada colaborador com alocação
    registrada e telefone cadastrado, para o bot mandar a mensagem
    proativamente, sem o técnico precisar chamar o bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=1)
        if error:
            return error

        allocations = (
            DailyUpdateAllocation.objects.filter(daily_update__allocation_date=target_date)
            .select_related("project", "project__site")
            .prefetch_related("collaborators__person")
        )

        by_collaborator = {}
        for allocation in allocations:
            for collaborator in allocation.collaborators.all():
                if not collaborator.is_active or not collaborator.person.phone:
                    continue
                entry = by_collaborator.setdefault(
                    collaborator.id,
                    {
                        "phone": collaborator.person.phone,
                        "collaborator_name": collaborator.person.name,
                        "allocations": [],
                    },
                )
                entry["allocations"].append(
                    {
                        "project": allocation.project.name,
                        "code": allocation.project.code,
                        "site": allocation.project.site.name if allocation.project.site_id else None,
                    }
                )

        return Response({"date": target_date.isoformat(), "technicians": list(by_collaborator.values())})


class BotMyTasksView(APIView):
    """GET /api/bot/my-tasks/?name=<nome>

    Usado pelo bot do WhatsApp: dado o nome digitado pelo técnico, retorna
    as tarefas pendentes (não concluídas/canceladas) atribuídas a ele em
    projetos ativos, agrupadas por projeto."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        name = request.query_params.get("name", "").strip()
        if not name:
            return Response({"detail": "Parâmetro 'name' é obrigatório."}, status=400)

        collaborator, ambiguous_matches = _find_bot_collaborator(name=name)
        if ambiguous_matches is not None:
            return Response({"found": "ambiguous", "matches": ambiguous_matches})

        if not collaborator:
            return Response({"found": False})

        tasks = (
            ProjectTask.objects.filter(collaborators=collaborator, project__is_active=True)
            .exclude(status__in=(ProjectTask.STATUS_COMPLETED, ProjectTask.STATUS_CANCELED))
            .select_related("project", "task")
            .order_by("project__name", "order", "id")
        )
        status_labels = dict(ProjectTask.STATUS_CHOICES)

        return Response(
            {
                "found": True,
                "collaborator_name": collaborator.person.name,
                "tasks": [
                    {
                        "project": t.project.name,
                        "code": t.project.code,
                        "task": t.display_name,
                        "status": status_labels.get(t.status, t.status),
                    }
                    for t in tasks
                ],
            }
        )


class BotSitesView(APIView):
    """GET /api/bot/sites/

    Lista os sites que têm ao menos um projeto ativo, para o técnico
    escolher no fluxo de "Atualização de projetos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        sites = Site.objects.filter(projects__is_active=True).distinct().order_by("name")
        return Response([{"id": s.id, "name": s.name or s.code or f"Site #{s.id}"} for s in sites])


class BotTechStatusSitesView(APIView):
    """GET /api/bot/tech-status/sites/

    Lista os sites que têm ao menos um técnico ativo vinculado, para o
    técnico/gestor escolher no fluxo "Status dos Técnicos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        sites = Site.objects.filter(collaborators__is_active=True).distinct().order_by("name")
        return Response([{"id": s.id, "name": s.name or s.code or f"Site #{s.id}"} for s in sites])


class BotTechStatusView(APIView):
    """GET /api/bot/tech-status/?site_id=<id, opcional>

    Usado pelo bot do WhatsApp: status de presença de cada técnico ativo
    agora — de um site específico, ou de todos (sem 'site_id'). Reaproveita
    build_board_data (mesma lógica da Central de Operações)."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        site_id = request.query_params.get("site_id") or None
        board = build_board_data(site_id)
        technicians = [
            {
                "name": t["name"],
                "site_name": t["site_name"],
                "status": t["presence_status_display"],
                "current_task": t["current_tasks"][0]["name"] if t["current_tasks"] else None,
            }
            for t in board["technicians"]
        ]
        return Response({"technicians": technicians})


class BotProjectsView(APIView):
    """GET /api/bot/projects/?site_id=<id>

    Lista os projetos ativos de um site, para o técnico escolher no fluxo
    de "Atualização de projetos" do bot."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        site_id = request.query_params.get("site_id")
        if not site_id:
            return Response({"detail": "Parâmetro 'site_id' é obrigatório."}, status=400)

        projects = Project.objects.filter(is_active=True, site_id=site_id).order_by("name")
        return Response([{"id": p.id, "code": p.code, "name": p.name} for p in projects])


def _serialize_project_update(project):
    today = timezone.localdate()
    today_update = ProjectDailyUpdate.objects.filter(project=project, date=today).first()
    if today_update:
        today_update.refresh_from_tasks()

    client = str(project.client) if project.client_id else (str(project.site.client) if project.site_id else None)
    status_label = dict(Project.STATUS_CHOICES).get(project.status, project.status)
    responsible_client = project.responsible_client.person.name if project.responsible_client_id else None
    # Percentual geral de conclusão do projeto (todas as tarefas, não só as
    # de hoje) — independe de existir uma Atualização de Projeto para hoje.
    completion_percent = compute_progress_defaults(project, today)["percent"]

    return {
        "code": project.code,
        "name": project.name,
        "client": client,
        "site": project.site.name if project.site_id else None,
        "status": status_label,
        "po": project.po or None,
        "responsible_client": responsible_client,
        "completion_percent": completion_percent,
        "planned_start": project.planned_start.isoformat() if project.planned_start else None,
        "planned_end": project.planned_end.isoformat() if project.planned_end else None,
        "description": project.description or None,
        "today_update": (
            {
                "completion_percent": today_update.completion_percent,
                "activities_text": today_update.activities_text or None,
                "certification_done": today_update.certification_done,
                "project_finished": today_update.project_finished,
                "summary": today_update.summary or None,
                "collaborators": list(
                    today_update.collaborators.order_by("person__name").values_list("person__name", flat=True)
                ),
            }
            if today_update
            else None
        ),
    }


class BotProjectUpdateView(APIView):
    """GET /api/bot/project-update/?project_id=<id>
    GET /api/bot/project-update/?site_id=<id>  (todos os projetos ativos do site)

    Usado pelo bot do WhatsApp para trazer a atualização do dia e um
    overview geral de um projeto (ou de todos os projetos ativos de um
    site)."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        project_id = request.query_params.get("project_id")
        site_id = request.query_params.get("site_id")
        if not project_id and not site_id:
            return Response({"detail": "Informe 'project_id' ou 'site_id'."}, status=400)

        if project_id:
            projects = Project.objects.filter(pk=project_id, is_active=True).select_related(
                "client", "site", "site__client", "responsible_client__person"
            )
        else:
            projects = (
                Project.objects.filter(site_id=site_id, is_active=True)
                .select_related("client", "site", "site__client", "responsible_client__person")
                .order_by("name")
            )

        return Response([_serialize_project_update(p) for p in projects])


def _parse_target_date(request, default_days_ahead=0):
    """Lê o parâmetro 'date' (AAAA-MM-DD) da query string, com padrão de
    hoje + `default_days_ahead` dias. Retorna (data, None) ou (None,
    Response de erro)."""
    date_str = request.query_params.get("date")
    if not date_str:
        return timezone.localdate() + timedelta(days=default_days_ahead), None
    try:
        return date.fromisoformat(date_str), None
    except ValueError:
        return None, Response({"detail": "Parâmetro 'date' inválido, use AAAA-MM-DD."}, status=400)


def _active_subscribers(flag):
    return list(
        BotSubscriber.objects.filter(is_active=True, **{flag: True})
        .order_by("name")
        .values("name", "phone")
    )


class BotOperationsPrintRecipientsView(APIView):
    """GET /api/bot/broadcasts/operations-print-recipients/

    Lista quem deve receber o print da Operação do Dia (8h/10h/12h/14h/16h/
    18h) — o bot captura a imagem (via /api/bot/operations-print/) e manda
    pra cada telefone daqui."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        return Response({"recipients": _active_subscribers("receives_operations_print")})


class BotDailyTasksBroadcastView(APIView):
    """GET /api/bot/broadcasts/daily-tasks/?date=<AAAA-MM-DD, opcional>

    Envio automático das 10h: para os projetos com alocação registrada na
    data informada (padrão: hoje), lista as tarefas pendentes, os técnicos
    alocados e o projeto/site — para os destinatários cadastrados com
    receives_daily_tasks=True."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        allocations = (
            DailyUpdateAllocation.objects.filter(daily_update__allocation_date=target_date)
            .select_related("project", "project__site")
            .prefetch_related("collaborators__person")
        )

        status_labels = dict(ProjectTask.STATUS_CHOICES)
        projects = []
        for allocation in allocations:
            project = allocation.project
            allocated_collaborators = list(allocation.collaborators.all())
            # Só tarefas pendentes explicitamente atribuídas a um dos técnicos
            # alocados hoje nesse projeto — não entra tarefa sem responsável
            # nem tarefa de outra pessoa que não está no time de hoje.
            pending_tasks = (
                ProjectTask.objects.filter(project=project, collaborators__in=allocated_collaborators)
                .exclude(status__in=(ProjectTask.STATUS_COMPLETED, ProjectTask.STATUS_CANCELED))
                .distinct()
                .order_by("order", "id")
            )
            projects.append(
                {
                    "project": project.name,
                    "code": project.code,
                    "site": project.site.name if project.site_id else None,
                    "collaborators": [
                        c.person.name for c in allocation.collaborators.order_by("person__name")
                    ],
                    "tasks": [
                        f"{t.display_name} ({status_labels.get(t.status, t.status)})" for t in pending_tasks
                    ],
                }
            )

        return Response(
            {
                "date": target_date.isoformat(),
                "projects": projects,
                "recipients": _active_subscribers("receives_daily_tasks"),
            }
        )


class BotProjectUpdatesBroadcastView(APIView):
    """GET /api/bot/broadcasts/project-updates/?date=<AAAA-MM-DD, opcional>

    Envio automático das 17h: para os mesmos projetos alocados na data
    informada (padrão: hoje), traz o mesmo conteúdo da Atualização Diária de
    Projeto enviada por e-mail (ver updates/project_client_mail.py) — para os
    destinatários cadastrados com receives_project_updates=True."""

    permission_classes = [BotSharedSecretPermission]
    authentication_classes = []

    def get(self, request):
        target_date, error = _parse_target_date(request, default_days_ahead=0)
        if error:
            return error

        project_ids = (
            DailyUpdateAllocation.objects.filter(daily_update__allocation_date=target_date)
            .values_list("project_id", flat=True)
            .distinct()
        )
        projects_qs = Project.objects.filter(pk__in=project_ids).select_related(
            "responsible_client__person", "responsible_cstr__person"
        )
        # Se já existe uma Atualização de Projeto registrada pra essa data,
        # usa os colaboradores e a observação que a pessoa responsável
        # digitou lá — só o percentual/atividades/certificação continuam
        # sempre recalculados ao vivo (mesmo critério de refresh_from_tasks()).
        existing_updates = {
            u.project_id: u
            for u in ProjectDailyUpdate.objects.filter(
                project_id__in=project_ids, date=target_date
            ).prefetch_related("collaborators__person")
        }

        projects = []
        for project in projects_qs:
            defaults = compute_progress_defaults(project, target_date)
            existing = existing_updates.get(project.id)

            if existing:
                collaborator_names = list(
                    existing.collaborators.order_by("person__name").values_list("person__name", flat=True)
                )
                summary = existing.summary or None
            else:
                collaborator_names = list(
                    Collaborator.objects.filter(pk__in=defaults["collaborator_ids"])
                    .select_related("person")
                    .order_by("person__name")
                    .values_list("person__name", flat=True)
                )
                summary = None

            projects.append(
                {
                    "project": project.name,
                    "po": project.po or None,
                    "responsible_client": project.responsible_client.person.name if project.responsible_client_id else None,
                    "responsible_cstr": project.responsible_cstr.person.name if project.responsible_cstr_id else None,
                    "collaborators": collaborator_names,
                    "completion_percent": defaults["percent"],
                    "activities_text": defaults["activities_text"] or None,
                    "certification_done": defaults["certification_done"],
                    "project_finished": defaults["project_finished"],
                    "summary": summary,
                }
            )

        return Response(
            {
                "date": target_date.isoformat(),
                "workday_start": WORKDAY_START,
                "workday_end": WORKDAY_END,
                "projects": projects,
                "recipients": _active_subscribers("receives_project_updates"),
            }
        )
