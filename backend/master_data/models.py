from django.conf import settings
from django.db import models

from core.models import TimestampedModel


class MasterDataModel(TimestampedModel):
    """Base para os Cadastros Mestres: além de criado/atualizado em (já
    herdado de TimestampedModel), rastreia QUEM criou/alterou o registro —
    diferente dos Cadastros Gerais existentes (Categoria, Tipo de Projeto
    etc.), que não têm esse rastreamento hoje. Não alteramos
    TimestampedModel para não afetar os cadastros já existentes."""

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="criado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="+",
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="atualizado por",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        editable=False,
        related_name="+",
    )

    class Meta:
        abstract = True


class CableFamily(MasterDataModel):
    """Família de cabo — o "tipo" técnico (ex: 8F LC-LC), sem metragem
    vinculada (metragem é tratada como quantidade de uma Tarefa, em outra
    camada, não como parte da identidade da família)."""

    MEDIUM_FIBER = "FIBER"
    MEDIUM_COPPER = "COPPER"
    MEDIUM_CHOICES = (
        (MEDIUM_FIBER, "Fibra"),
        (MEDIUM_COPPER, "Cobre"),
    )

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    medium = models.CharField("meio", max_length=10, choices=MEDIUM_CHOICES, default=MEDIUM_FIBER)
    fiber_count = models.PositiveIntegerField("nº de fibras", null=True, blank=True)
    connector_a = models.CharField("conector A", max_length=50, blank=True)
    connector_b = models.CharField("conector B", max_length=50, blank=True)
    cable_category = models.CharField("categoria do cabo", max_length=50, blank=True)
    preterminated = models.BooleanField("pré-terminado", default=False)
    description = models.TextField("descrição", blank=True)
    is_active = models.BooleanField("ativa", default=True)

    class Meta:
        verbose_name = "Família de Cabo"
        verbose_name_plural = "Famílias de Cabo"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class CableAlias(TimestampedModel):
    """Forma alternativa de escrita que aponta para uma Família de Cabo
    canônica (ex: "8F LC/LC", "8F LC Trunk Fiber" -> FIB-8F-LCLC) — base
    para a normalização automática de escopos por IA numa fase futura.
    Só o modelo/admin existem por enquanto; sem tela/API dedicada ainda."""

    cable_family = models.ForeignKey(CableFamily, verbose_name="família de cabo", on_delete=models.CASCADE, related_name="aliases")
    alias_text = models.CharField("texto do alias", max_length=150)
    is_active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Alias de Cabo"
        verbose_name_plural = "Aliases de Cabo"
        ordering = ("alias_text",)
        constraints = [
            models.UniqueConstraint(fields=("cable_family", "alias_text"), name="unique_alias_per_family"),
        ]

    def __str__(self):
        return f"{self.alias_text} → {self.cable_family.code}"
