from core.models import PhoneNormalizedModel, TimestampedModel
from django.core.exceptions import ValidationError
from django.db import models


class BotSubscriber(PhoneNormalizedModel, TimestampedModel):
    """Destinatário dos envios automáticos do bot do WhatsApp (não precisa
    ser um Colaborador cadastrado — normalmente é um gestor que quer
    acompanhar o dia a dia dos projetos)."""

    name = models.CharField("nome", max_length=150)
    phone = models.CharField(
        "telefone",
        max_length=20,
        blank=True,
        help_text="Com DDD, ex: +55 (11) 99999-9999. Deixe em branco se for um grupo.",
    )
    # Grupo do WhatsApp em vez de um telefone individual. Fica num campo
    # próprio (e não em `phone`) porque PhoneNormalizedModel.save() reformata
    # `phone` pro padrão brasileiro, o que destruiria o JID do grupo.
    group_jid = models.CharField(
        "ID do grupo do WhatsApp",
        max_length=100,
        blank=True,
        help_text='Identificador do grupo (termina em "@g.us"). Quando preenchido, o telefone é ignorado '
        "e o envio vai para o grupo. O bot precisa ser membro do grupo.",
    )
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
    receives_daily_project_report = models.BooleanField(
        "recebe atualização diária de projeto (15h)",
        default=True,
        help_text="Envio automático às 15h com o relatório completo de cada projeto ativo (uma mensagem por projeto).",
    )
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Destinatário do Bot"
        verbose_name_plural = "Destinatários do Bot"
        ordering = ("name",)

    def clean(self):
        super().clean()
        if not self.phone and not self.group_jid:
            raise ValidationError({"phone": "Informe um telefone ou o ID de um grupo do WhatsApp."})
        if self.group_jid and not self.group_jid.endswith("@g.us"):
            raise ValidationError({"group_jid": 'O ID de grupo do WhatsApp precisa terminar em "@g.us".'})

    def __str__(self):
        return f"{self.name} ({self.group_jid or self.phone})"
