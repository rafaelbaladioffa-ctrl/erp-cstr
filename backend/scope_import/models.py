from django.conf import settings
from django.db import models

from core.models import TimestampedModel


class ScopeImport(TimestampedModel):
    """Uma tentativa de importar o escopo de um projeto via IA: o usuário
    cola um texto livre (`raw_text`), uma IA propõe uma estrutura de Blocos/
    Itens/Tarefas (`ai_raw_response`, nunca editado), o usuário revisa e
    ajusta essa prévia na tela, e só quando confirma é que os registros reais
    (WorkBlock/ProjectItem/ProjectTask) são criados — nesse momento a versão
    final usada fica em `reviewed_payload`. Nada é gravado automaticamente:
    a IA só propõe, o usuário sempre decide o que entra."""

    STATUS_DRAFT = "draft"
    STATUS_PROCESSING = "processing"
    STATUS_READY = "ready"
    STATUS_FAILED = "failed"
    STATUS_CONFIRMED = "confirmed"
    STATUS_DISCARDED = "discarded"
    STATUS_CHOICES = (
        (STATUS_DRAFT, "Rascunho"),
        (STATUS_PROCESSING, "Processando"),
        (STATUS_READY, "Pronto para revisão"),
        (STATUS_FAILED, "Falhou"),
        (STATUS_CONFIRMED, "Confirmado"),
        (STATUS_DISCARDED, "Descartado"),
    )

    project = models.ForeignKey(
        "projects.Project", verbose_name="projeto", on_delete=models.CASCADE, related_name="scope_imports"
    )
    raw_text = models.TextField("escopo colado")
    status = models.CharField("status", max_length=20, choices=STATUS_CHOICES, default=STATUS_DRAFT)
    ai_provider = models.CharField("provedor de IA", max_length=50, blank=True)
    ai_model = models.CharField("modelo de IA", max_length=100, blank=True)
    ai_raw_response = models.JSONField("resposta bruta da IA", null=True, blank=True)
    reviewed_payload = models.JSONField("versão revisada (usada na confirmação)", null=True, blank=True)
    error_message = models.TextField("mensagem de erro", blank=True)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="solicitado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scope_imports_requested",
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="confirmado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="scope_imports_reviewed",
    )
    confirmed_at = models.DateTimeField("confirmado em", null=True, blank=True)

    class Meta:
        verbose_name = "Importação de Escopo"
        verbose_name_plural = "Importações de Escopo"
        ordering = ("-created_at",)

    def __str__(self):
        return f"Importação #{self.pk} — {self.project} ({self.get_status_display()})"
