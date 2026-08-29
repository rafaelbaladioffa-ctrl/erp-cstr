from django.db import models
from django.utils import timezone

from core.models import Collaborator, TimestampedModel


class TechnicianDailyPresence(TimestampedModel):
    """Status de presença do técnico no site, por dia — separado do cadastro
    do Collaborator (que é permanente) porque esse estado é efêmero e reseta
    a cada dia. STATUS_IN_PROGRESS é definido automaticamente pelo sistema
    (não pelo dropdown do técnico) sempre que ele inicia uma ProjectTask —
    ver MyTaskViewSet._sync_presence_with_task em api/views.py — e volta pra
    STATUS_AVAILABLE quando ele pausa/finaliza sem iniciar outra em seguida."""

    STATUS_NOT_STARTED = "not_started"
    STATUS_AVAILABLE = "available"
    STATUS_IN_PROGRESS = "in_progress"
    STATUS_LUNCH = "lunch"
    STATUS_PERSONAL = "personal"
    STATUS_SITE_BLOCKED = "site_blocked"
    STATUS_AWAITING_RELEASE = "awaiting_release"
    STATUS_OFF_DUTY = "off_duty"
    STATUS_CHOICES = (
        (STATUS_NOT_STARTED, "Não chegou"),
        (STATUS_AVAILABLE, "Disponível"),
        (STATUS_IN_PROGRESS, "Em Execução"),
        (STATUS_LUNCH, "Horário de Almoço"),
        (STATUS_PERSONAL, "Particular"),
        (STATUS_SITE_BLOCKED, "Sem Acesso ao Site"),
        (STATUS_AWAITING_RELEASE, "Aguardando Liberações"),
        (STATUS_OFF_DUTY, "Fim de Expediente"),
    )
    # Estados que o técnico pode escolher livremente pelo dropdown (antes do
    # primeiro deles, só existe STATUS_NOT_STARTED; o primeiro que ele
    # escolher já funciona como o check-in — ver TechnicianPresenceViewSet.
    # set_status). Reabre normalmente mesmo depois de STATUS_OFF_DUTY —
    # escolher qualquer um de novo (ex: Disponível) volta a contar o dia.
    # STATUS_IN_PROGRESS fica de fora de propósito: só o sistema pode setar.
    SELECTABLE_STATUSES = (
        STATUS_AVAILABLE,
        STATUS_LUNCH,
        STATUS_PERSONAL,
        STATUS_SITE_BLOCKED,
        STATUS_AWAITING_RELEASE,
        STATUS_OFF_DUTY,
    )

    # Classificação de produtividade do status de PRESENÇA — não confundir
    # com "produtivo" de verdade, que é derivado de ter uma ProjectTask
    # in_progress (ver dispatch touchpoints em api/operations.py). Isso aqui
    # só serve pra separar, dentro do tempo em que o técnico NÃO está
    # executando tarefa, o que é tempo ocioso "cobrável" (improdutivo) do
    # que é pausa do próprio técnico (neutro, não entra na conta de
    # nenhum dos dois lados).
    PRODUCTIVITY_UNPRODUCTIVE = "unproductive"
    PRODUCTIVITY_NEUTRAL = "neutral"
    PRESENCE_PRODUCTIVITY = {
        STATUS_AVAILABLE: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_SITE_BLOCKED: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_AWAITING_RELEASE: PRODUCTIVITY_UNPRODUCTIVE,
        STATUS_LUNCH: PRODUCTIVITY_NEUTRAL,
        STATUS_PERSONAL: PRODUCTIVITY_NEUTRAL,
    }

    # Jornada padrão usada nos relatórios de utilização — fixa, não é
    # calculada a partir de checked_in_at/checked_out_at (o técnico pode
    # esquecer de marcar Fim de Expediente, ou sair e voltar várias vezes
    # no dia, o que distorceria a duração real).
    STANDARD_WORKDAY_HOURS = 8

    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="daily_presences"
    )
    date = models.DateField("data", default=timezone.localdate)
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_NOT_STARTED)
    checked_in_at = models.DateTimeField("check-in em", null=True, blank=True)
    checked_out_at = models.DateTimeField("encerrado em", null=True, blank=True)

    class Meta:
        verbose_name = "Presença do Técnico"
        verbose_name_plural = "Presenças dos Técnicos"
        ordering = ("-date", "collaborator__person__name")
        constraints = [
            models.UniqueConstraint(fields=("collaborator", "date"), name="unique_presence_per_day")
        ]

    def __str__(self):
        return f"{self.collaborator} — {self.date}"


class TechnicianStatusEvent(models.Model):
    """Registro histórico de cada troca de status de presença do técnico no
    dia — ao contrário de TechnicianDailyPresence (que só guarda o status
    ATUAL), isso permite reconstruir a timeline mostrando todas as trocas
    que aconteceram, não só a última."""

    collaborator = models.ForeignKey(
        Collaborator, verbose_name="técnico", on_delete=models.CASCADE, related_name="status_events"
    )
    date = models.DateField("data", default=timezone.localdate)
    status = models.CharField("status", max_length=20, choices=TechnicianDailyPresence.STATUS_CHOICES)
    changed_at = models.DateTimeField("alterado em", default=timezone.now)

    class Meta:
        verbose_name = "Troca de Status do Técnico"
        verbose_name_plural = "Trocas de Status dos Técnicos"
        ordering = ("changed_at",)

    def __str__(self):
        return f"{self.collaborator} — {self.get_status_display()} em {self.changed_at:%d/%m %H:%M}"
