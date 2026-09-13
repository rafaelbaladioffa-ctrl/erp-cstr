import re

from django.conf import settings
from django.db import models

from core.models import TimestampedModel

# Variantes tipográficas de traço (en-dash, em-dash, sinal de menos etc.)
# que devem virar o hífen ASCII comum na normalização — diferente de "/" e
# "<>", que são separadores com significado técnico distinto e não são
# alterados (ver normalize_alias_text).
_DASH_VARIANTS = str.maketrans({"–": "-", "—": "-", "−": "-", "‐": "-", "‑": "-"})


def normalize_alias_text(value: str) -> str:
    """Normaliza um alias de cabo para fins de deduplicação/comparação:
    remove espaços nas pontas, converte para maiúsculas, colapsa espaços
    internos repetidos em um único espaço, e converte variantes tipográficas
    de traço para o hífen ASCII comum. NÃO unifica separadores com
    significado técnico distinto ("-", "/", "<>") — "8F LC-LC", "8F LC/LC" e
    "8F LC<>LC" são grafias igualmente válidas e devem continuar existindo
    como aliases separados apontando para a mesma família."""
    if not value:
        return ""
    text = value.strip().upper().translate(_DASH_VARIANTS)
    return re.sub(r"\s+", " ", text)


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
    active = models.BooleanField("ativa", default=True)

    class Meta:
        verbose_name = "Família de Cabo"
        verbose_name_plural = "Famílias de Cabo"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class CableAlias(MasterDataModel):
    """Forma alternativa de escrita (encontrada em SOWs, cutsheets e outros
    documentos) que aponta para uma Família de Cabo canônica — ex: "8F LC/LC",
    "8F LC Trunk Fiber" -> FIB-8F-LCLC. Base para a normalização automática
    de texto livre por uma IA numa fase futura; nesta etapa só cadastro e
    consulta (Cadastros Mestres > Engenharia > Aliases de Cabos)."""

    # Sugestões de uso (não é ENUM/choices — texto livre para não travar
    # tipos novos que apareçam na prática): NAME_VARIATION, PART_NUMBER,
    # LEGACY_NAME, SOW_TERM, INTERNAL_TERM.
    ALIAS_TYPE_SUGGESTIONS = (
        "NAME_VARIATION",
        "PART_NUMBER",
        "LEGACY_NAME",
        "SOW_TERM",
        "INTERNAL_TERM",
    )

    cable_family = models.ForeignKey(
        CableFamily, verbose_name="família de cabo", on_delete=models.PROTECT, related_name="aliases"
    )
    alias = models.CharField("alias", max_length=200)
    # Preenchido automaticamente em clean()/save() a partir de `alias` — não
    # é editável diretamente (nem pela API, nem pelo Admin).
    normalized_alias = models.CharField(
        "alias normalizado", max_length=200, unique=True, editable=False, blank=True
    )
    alias_type = models.CharField("tipo do alias", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Alias de Cabo"
        verbose_name_plural = "Aliases de Cabo"
        ordering = ("alias",)

    def __str__(self):
        return f"{self.alias} → {self.cable_family.code}"

    def clean(self):
        super().clean()
        self.normalized_alias = normalize_alias_text(self.alias)

    def save(self, *args, **kwargs):
        # Recalculado aqui também (e não só em clean()) para cobrir todo
        # caminho de gravação que não passe por full_clean() — seeds via
        # update_or_create/admin/API (a API valida duplicidade de forma
        # explícita em CableAliasCrudSerializer.validate(), não depende de
        # full_clean() ser chamado).
        self.normalized_alias = normalize_alias_text(self.alias)
        super().save(*args, **kwargs)
