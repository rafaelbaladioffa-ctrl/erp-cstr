from django.conf import settings
from django.core.mail import EmailMessage

from .pdf import build_daily_updates_pdf


def send_daily_update_emails(daily_update):
    """Envia o descritivo completo da Atualização Diária para cada colaborador
    alocado (e-mail individual, mesmo conteúdo e PDF anexado para todos).

    Retorna uma tupla (enviados, sem_email) com a lista de nomes em cada caso.
    """
    daily_update.refresh_description()

    collaborators = {
        collaborator
        for allocation in daily_update.allocations.all()
        for collaborator in allocation.collaborators.all()
    }

    subject = f"Atualização Diária — {daily_update.allocation_date:%d/%m/%Y}"
    body = daily_update.description or daily_update.build_description()

    pdf_bytes = build_daily_updates_pdf([daily_update], daily_update.allocation_date).read()
    pdf_filename = f"atualizacao-diaria-{daily_update.allocation_date:%Y-%m-%d}.pdf"

    sent, skipped = [], []
    for collaborator in sorted(collaborators, key=lambda c: c.person.name):
        if not collaborator.person.email:
            skipped.append(collaborator.person.name)
            continue
        email = EmailMessage(
            subject=subject,
            body=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            to=[collaborator.person.email],
        )
        email.attach(pdf_filename, pdf_bytes, "application/pdf")
        email.send(fail_silently=False)
        sent.append(collaborator.person.name)

    return sent, skipped
