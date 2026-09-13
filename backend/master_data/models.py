import re

from django.conf import settings
from django.core.exceptions import ValidationError
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


def find_conflicting_part_number_alias(part_number, cable_family):
    """Se `part_number` bater com o alias normalizado de um CableAlias que
    aponta para uma família DIFERENTE de `cable_family`, retorna esse alias
    (o conflito) — usado por CableSpec.clean() para impedir cadastrar uma
    especificação cujo part number já é reconhecido como referência textual
    de outra família de cabo. Retorna None quando não há alias com esse
    texto, ou quando o alias existente aponta para a mesma família (sem
    conflito, é o caso normal e esperado)."""
    if not part_number or cable_family is None:
        return None
    normalized = normalize_alias_text(part_number)
    return CableAlias.objects.filter(normalized_alias=normalized).exclude(cable_family_id=cable_family.pk).first()


class CableSpec(MasterDataModel):
    """Especificação técnica/comercial concreta de uma Família de Cabo —
    fabricante, part number e características físicas de um item real de
    catálogo (ex: FIB-8F-LCLC -> CX1A0012R6C03-XXXM). Uma família pode ter
    vários specs (fabricantes/modelos/revisões diferentes do mesmo tipo
    canônico). Campos técnicos (connector_a/connector_b/fiber_count) também
    existem em CableFamily; aqui funcionam como OVERRIDE opcional por spec
    — quando preenchidos, prevalecem sobre o valor da família (o motor de
    herança em si — "se nulo, usar o da família" — fica para quando algum
    consumidor real precisar resolver o valor efetivo; o modelo já está
    preparado, só não há ainda esse resolver)."""

    cable_family = models.ForeignKey(
        CableFamily, verbose_name="família de cabo", on_delete=models.PROTECT, related_name="specs"
    )
    code = models.CharField("código", max_length=100, unique=True)
    name = models.CharField("nome", max_length=200)
    manufacturer = models.CharField("fabricante", max_length=150, blank=True)
    part_number = models.CharField("part number", max_length=150, blank=True)
    fiber_type = models.CharField("tipo de fibra", max_length=50, blank=True)
    jacket_color = models.CharField("cor da capa", max_length=50, blank=True)
    polarity = models.CharField("polaridade", max_length=50, blank=True)
    connector_a = models.CharField("conector A", max_length=50, blank=True)
    connector_b = models.CharField("conector B", max_length=50, blank=True)
    fiber_count = models.PositiveIntegerField("nº de fibras", null=True, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Especificação de Cabo"
        verbose_name_plural = "Especificações de Cabo"
        ordering = ("code",)
        constraints = [
            # Índice único parcial: só entre specs ATIVOS e com part_number
            # preenchido — "" (sem part number) não deve colidir consigo
            # mesmo, e um spec inativado (ex: revisão descontinuada) não deve
            # travar o cadastro de um novo spec ativo com o mesmo número.
            # Rede de segurança no banco; a checagem "de fato" (com mensagem
            # legível e case-insensitive) é feita em clean().
            models.UniqueConstraint(
                fields=("part_number",),
                condition=models.Q(active=True) & ~models.Q(part_number=""),
                name="unique_active_part_number",
            ),
        ]

    def __str__(self):
        return f"{self.code} — {self.name}"

    def clean(self):
        super().clean()
        if not self.part_number:
            return
        errors = {}
        if self.active:
            duplicate = (
                CableSpec.objects.filter(part_number__iexact=self.part_number, active=True)
                .exclude(pk=self.pk)
                .first()
            )
            if duplicate is not None:
                errors["part_number"] = (
                    f'Já existe uma especificação ativa com este part number ("{duplicate.code}").'
                )
        conflicting_alias = find_conflicting_part_number_alias(self.part_number, self.cable_family)
        if conflicting_alias is not None:
            errors["part_number"] = (
                "Part number possui alias associado a outra família de cabo "
                f"({conflicting_alias.cable_family.code})."
            )
        if errors:
            raise ValidationError(errors)


class CertificationType(MasterDataModel):
    """Catálogo de MÉTODOS de certificação/validação usados na operação
    (ex: OTDR, certificação de cobre, validação QA/QC) — representa o
    método em si, não o tipo de cabo/conector; regras de aplicabilidade por
    família/conector ficam para uma fase futura, deliberadamente fora do
    escopo aqui (ver `method`)."""

    MEDIUM_FIBER = "FIBER"
    MEDIUM_COPPER = "COPPER"
    MEDIUM_GENERAL = "GENERAL"
    MEDIUM_CHOICES = (
        (MEDIUM_FIBER, "Fibra"),
        (MEDIUM_COPPER, "Cobre"),
        (MEDIUM_GENERAL, "Geral"),
    )

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    medium = models.CharField("meio", max_length=10, choices=MEDIUM_CHOICES, blank=True)
    # Texto livre (não ENUM/choices) de propósito — "controlado pela
    # aplicação" nesta fase significa apenas convenção de nomenclatura
    # (ex: OTDR, COPPER_CERTIFIER, FIBER_CERTIFICATION, QA_QC), não uma
    # lista fechada travada no banco.
    method = models.CharField("método", max_length=50)
    requires_report = models.BooleanField("exige relatório", default=False)
    requires_attachment = models.BooleanField("exige anexo", default=False)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Tipo de Certificação"
        verbose_name_plural = "Tipos de Certificação"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"
