from django.utils import timezone

from core.email_texts import fmt_date, tr
from core.emailing import branded_subject, build_email, normalize_language, render_html
from core.models import Responsible
from projects.models import ProjectTask

NEWLINE = chr(10)
WORKDAY_START = "07:30"
WORKDAY_END = "16:40"

STATUS_LABELS = {
    ProjectTask.STATUS_NOT_STARTED: "Não Iniciada",
    ProjectTask.STATUS_IN_PROGRESS: "Em Andamento",
    ProjectTask.STATUS_PAUSED: "Pausada",
    ProjectTask.STATUS_COMPLETED: "Concluída",
    ProjectTask.STATUS_CANCELED: "Cancelada",
}


def compute_progress_defaults(project, date):
    """Calcula os valores padrão (percentual, atividades, certificação,
    finalização e colaboradores) a partir das ProjectTask do projeto.
    Usado apenas para preencher automaticamente uma Atualização Diária de
    Projeto recém-criada — depois disso os campos ficam editáveis livremente.
    """
    all_tasks = list(project.project_tasks.select_related("task").prefetch_related("collaborators"))

    total = len(all_tasks)
    completed = [pt for pt in all_tasks if pt.status == ProjectTask.STATUS_COMPLETED]
    percent = round((len(completed) / total) * 100) if total else 0

    def completed_on(pt):
        # `actual_end` só é preenchido quando a tarefa passa pelo fluxo de
        # iniciar/pausar/concluir do técnico (Minhas Tarefas). Tarefas
        # concluídas por edição direta ou ação em massa não têm essa data —
        # nesse caso usamos `updated_at` (quando o status virou "concluída")
        # como aproximação de quando ela foi executada.
        if pt.status != ProjectTask.STATUS_COMPLETED:
            return None
        reference = pt.actual_end or pt.updated_at
        return timezone.localtime(reference).date() if reference else None

    executed_today = [pt for pt in all_tasks if completed_on(pt) == date]
    activities_text = "\n".join(
        f"{pt.display_name} — {STATUS_LABELS.get(pt.status, pt.status)}" for pt in executed_today
    )

    certification_done = any(
        pt.status == ProjectTask.STATUS_COMPLETED and "certifica" in pt.display_name.lower()
        for pt in all_tasks
    )
    project_finished = total > 0 and percent == 100

    collaborator_ids = sorted(
        {collaborator.pk for pt in all_tasks for collaborator in pt.collaborators.all()}
    )

    return {
        "percent": percent,
        "activities_text": activities_text,
        "certification_done": certification_done,
        "project_finished": project_finished,
        "collaborator_ids": collaborator_ids,
    }


def build_project_update_body(project_update):
    project_update.refresh_from_tasks()
    project = project_update.project

    responsible_aws = project.responsible_client.person.name if project.responsible_client_id else "Não informado"
    responsible_cstr = project.responsible_cstr.person.name if project.responsible_cstr_id else "Não informado"
    collaborators_line = (
        ", ".join(project_update.collaborators.order_by("person__name").values_list("person__name", flat=True))
        or "Não informados"
    )

    lines = [
        "📋 Atualização Diária de Projeto",
        "",
        f"Nome do Projeto: {project.name}",
        f"PO: {project.po or 'Não informada'}",
        f"Responsável AWS: {responsible_aws}",
        f"Responsável CSTR: {responsible_cstr}",
        "",
        f"👷 Colaboradores: {collaborators_line}",
        "",
        f"📅 Data: {project_update.date:%d/%m/%Y}",
        f"Hora de início: {WORKDAY_START}",
        f"Hora de término: {WORKDAY_END}",
        "",
        f"📊 Percentual de Conclusão: {project_update.completion_percent}%",
        "",
        "🛠️ Atividades Executadas:",
        project_update.activities_text.strip() or "Nenhuma atividade concluída registrada nesta data.",
        "",
        f"✅ Certificação Finalizada: {'Sim' if project_update.certification_done else 'Não'}",
        f"🏁 Projeto finalizado: {'Sim' if project_update.project_finished else 'Não'}",
        "",
        "⚠️ Observações:",
        project_update.summary.strip() or "Nenhuma observação.",
    ]

    return "\n".join(lines)


def build_project_update_message(project_update, recipient_email, pdf_bytes, pdf_filename, lang="pt"):
    """Monta o e-mail corporativo (HTML + texto) da Atualização de Projeto."""
    lang = normalize_language(lang)
    project_update.refresh_from_tasks()
    project = project_update.project

    client_label = (
        (project.client.trade_name or project.client.legal_name) if project.client_id else tr(lang, "client_fallback")
    )
    responsible_client = (
        project.responsible_client.person.name if project.responsible_client_id else tr(lang, "not_informed")
    )
    responsible_cstr = project.responsible_cstr.person.name if project.responsible_cstr_id else tr(lang, "not_informed")
    collaborators = ", ".join(
        project_update.collaborators.order_by("person__name").values_list("person__name", flat=True)
    ) or tr(lang, "not_informed_pl")
    yes_no = lambda value: tr(lang, "yes" if value else "no")  # noqa: E731
    summary = [
        (tr(lang, "project"), project.name),
        (tr(lang, "code"), project.code or "—"),
        (tr(lang, "site"), (project.site.name or project.site.code) if project.site_id else tr(lang, "not_informed")),
        (tr(lang, "po"), project.po or tr(lang, "po_missing")),
        (tr(lang, "responsible", client=client_label), responsible_client),
        (tr(lang, "responsible_company"), responsible_cstr),
        (tr(lang, "date"), fmt_date(lang, project_update.date)),
        (tr(lang, "team"), collaborators),
        (tr(lang, "certification"), yes_no(project_update.certification_done)),
        (tr(lang, "finished"), yes_no(project_update.project_finished)),
    ]
    activities = project_update.activities_text.strip() or tr(lang, "no_activities")
    observations = project_update.summary.strip() or tr(lang, "no_observations")
    sections = [(tr(lang, "activities"), activities), (tr(lang, "observations"), observations)]
    percent = f"{project_update.completion_percent}%"

    html = render_html(
        title=tr(lang, "project_title"),
        intro=tr(lang, "project_intro"),
        highlight=(tr(lang, "completion"), percent),
        summary=summary,
        sections=sections,
        lang=lang,
    )
    text_lines = [tr(lang, "project_title").upper(), ""]
    text_lines += [f"{label}: {value}" for label, value in summary]
    text_lines += ["", f"{tr(lang, 'completion')}: {percent}", ""]
    for heading, body in sections:
        text_lines += [heading.upper(), body, ""]
    text_lines.append(f"Consultimer — {tr(lang, 'attachment_note')}")
    subject = branded_subject(
        tr(lang, "project_subject"), project.code or project.name, fmt_date(lang, project_update.date)
    )
    return build_email(
        subject=subject,
        to=[recipient_email],
        text=NEWLINE.join(text_lines),
        html=html,
        attachments=[(pdf_filename, pdf_bytes, "application/pdf")],
    )


def send_project_daily_update_email(project_update, extra_recipients=None, lang="pt"):
    """Envia a Atualização Diária de Projeto para todos os ClientResponsible
    ativos do cliente vinculado ao projeto, mais quaisquer destinatários
    extras informados (usuários do sistema escolhidos ou e-mails avulsos
    digitados na tela) via `extra_recipients` — lista de tuplas (nome, e-mail).

    Retorna uma tupla (enviados, sem_email) com os nomes em cada caso.
    """
    project = project_update.project
    responsibles = []
    if project.client_id:
        responsibles = list(
            Responsible.objects.filter(
                kind=Responsible.KIND_CLIENT, client_id=project.client_id, is_active=True
            ).select_related("person")
        )

    recipients = [(r.person.name, r.person.email) for r in responsibles]
    recipients += list(extra_recipients or [])

    # Deduplica por e-mail (case-insensitive), preservando a primeira ocorrência.
    seen_emails = set()
    deduped = []
    for name, email in recipients:
        key = (email or "").strip().lower()
        if key and key not in seen_emails:
            seen_emails.add(key)
            deduped.append((name, email))
        elif not key:
            deduped.append((name, email))

    # Import tardio para evitar import circular (project_pdf importa deste módulo).
    from .project_pdf import build_project_daily_update_pdf

    pdf_bytes = build_project_daily_update_pdf(project_update).read()
    pdf_filename = f"atualizacao-projeto-{project.code or project.pk}-{project_update.date:%Y-%m-%d}.pdf"

    sent, skipped = [], []
    for name, recipient_email in deduped:
        if not recipient_email:
            skipped.append(name)
            continue
        build_project_update_message(project_update, recipient_email, pdf_bytes, pdf_filename, lang).send(
            fail_silently=False
        )
        sent.append(name)

    if sent:
        type(project_update).objects.filter(pk=project_update.pk).update(sent_at=timezone.now())
        project_update.sent_at = timezone.now()

    return sent, skipped
