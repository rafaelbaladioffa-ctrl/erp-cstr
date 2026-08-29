from core.models import PhoneNormalizedModel, TimestampedModel
from django.db import models


class BotSubscriber(PhoneNormalizedModel, TimestampedModel):
    """Destinatário dos envios automáticos do bot do WhatsApp (não precisa
    ser um Colaborador cadastrado — normalmente é um gestor que quer
    acompanhar o dia a dia dos projetos)."""

    name = models.CharField("nome", max_length=150)
    phone = models.CharField("telefone", max_length=20, help_text="Com DDD, ex: +55 (11) 99999-9999.")
    receives_daily_tasks = models.BooleanField(
        "recebe tarefas do dia (10h)",
        default=True,
        help_text="Envio automático às 10h com projetos/técnicos/tarefas alocados para hoje.",
    )
    receives_project_updates = models.BooleanField(
        "recebe atualização de projetos (17h)",
        default=True,
        help_text="Envio automático às 17h com as tarefas concluídas no dia em cada projeto.",
    )
    receives_operations_print = models.BooleanField(
        "recebe print da Operação do Dia (8h, 10h, 12h, 14h, 16h, 18h)",
        default=True,
        help_text="Envio automático de uma imagem com o painel da Central de Operações (Operação do Dia).",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Destinatário do Bot"
        verbose_name_plural = "Destinatários do Bot"
        ordering = ("name",)

    def __str__(self):
        return f"{self.name} ({self.phone})"
