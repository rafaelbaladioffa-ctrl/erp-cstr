import re
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import IntegrityError, models, transaction

from core.models import TimestampedModel
from master_data.services.scope_item_normalizer import ScopeItemNormalizationError, normalize_scope_item

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


class Activity(MasterDataModel):
    """Catálogo canônico de atividades operacionais — ações padronizadas
    executadas nos projetos (ex: CAB-RUN = "Lançar cabeamento"). Existe para
    impedir que a mesma ação seja cadastrada com nomes diferentes ("Lançar
    cabo", "Passar cabo", "Run cable" etc.); a normalização de texto livre
    por alias/IA fica para uma fase futura — aqui é só o catálogo em si,
    sem relação com CableFamily, sem template de tarefas."""

    # Sugestões (não é ENUM/choices — texto livre para não travar valores
    # novos que apareçam na prática).
    CATEGORY_SUGGESTIONS = (
        "PREPARATION",
        "INSTALLATION",
        "ORGANIZATION",
        "TERMINATION",
        "CERTIFICATION",
        "QUALITY",
        "DOCUMENTATION",
        "SITE",
        "CLOSURE",
    )
    EXECUTION_TYPE_SUGGESTIONS = ("MANUAL", "TEST", "DOCUMENTATION", "INSPECTION", "SERVICE")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    category = models.CharField("categoria", max_length=50)
    execution_type = models.CharField("tipo de execução", max_length=50, blank=True)
    default_unit = models.CharField("unidade padrão", max_length=50, blank=True)
    measurable = models.BooleanField("mensurável", default=False)
    requires_quantity = models.BooleanField("exige quantidade", default=False)
    requires_evidence = models.BooleanField("exige evidência", default=False)
    # Indica que a ATIVIDADE (ex: CAB-RUN) depende de uma certificação
    # técnica ser feita em algum momento do fluxo — não que a atividade em
    # si seja uma certificação (esse é o caso de CERTIFY, que também tem
    # requires_certification=False, pois ela é quem certifica, não quem
    # depende de certificação).
    requires_certification = models.BooleanField("exige certificação", default=False)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Atividade"
        verbose_name_plural = "Atividades"
        ordering = ("code",)

    def __str__(self):
        # Só o código (não "código — nome") pelo mesmo motivo de Site: a
        # importação de CSV de TaskTemplateStep resolve a FK `activity`
        # comparando por igualdade de texto contra str(candidato) — para
        # aceitar só o código ("CAB-RUN"), sem exigir ID interno.
        return self.code


class Network(MasterDataModel):
    """Catálogo canônico das redes/tipos de serviço de cabeamento — a
    FUNÇÃO lógica/operacional da conexão (ex: MN_FIBER = "Management
    Network Fiber"), não o tipo físico do cabo (isso é CableFamily) nem a
    frente de execução do projeto (isso será Workstream, numa fase
    futura). Uma mesma rede pode usar famílias físicas de cabo diferentes
    ao longo do tempo — por isso não guarda metragem, origem, destino ou
    quantidade, e não tem relação com CableFamily nesta etapa."""

    # Sugestões (não é ENUM/choices — texto livre para não travar valores
    # novos que apareçam na prática; domain em especial deve poder crescer
    # sem exigir migration).
    DOMAIN_SUGGESTIONS = ("CORPORATE", "CONSOLE", "MANAGEMENT", "WAP")
    MEDIUM_SUGGESTIONS = ("FIBER", "COPPER")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    domain = models.CharField("domínio", max_length=50)
    medium = models.CharField("meio", max_length=50)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Rede"
        verbose_name_plural = "Redes"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class Workstream(MasterDataModel):
    """Catálogo canônico de frentes operacionais de execução — COMO o
    escopo é agrupado dentro de um projeto para planejamento/tarefas/
    acompanhamento (ex: "Management Fibers", "BFC Brick Fibers", "Smart
    Hands"). Não confundir com Network: Network é a função lógica/técnica
    da conexão (ex: MN_FIBER), Workstream é a frente operacional — uma
    frente pode não ter nenhuma Network associada, ter uma só, ou várias
    (ex: WS-CONSOLE pode envolver CONSOLE_FIBER e CONSOLE_COPPER). Essa
    relação (e a prioridade/ordem de execução, que é específica de cada
    projeto) fica para uma fase futura (project_workstreams); esta tabela
    é só o catálogo, sem FK para Network e sem priority/sequence/
    execution_order."""

    # Sugestões (não é ENUM/choices — texto livre para não travar valores
    # novos que apareçam na prática).
    CATEGORY_SUGGESTIONS = ("CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE")
    DEFAULT_MEDIUM_SUGGESTIONS = ("FIBER", "COPPER", "MIXED", "GENERAL")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    category = models.CharField("categoria", max_length=50)
    default_medium = models.CharField("meio padrão", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Workstream"
        verbose_name_plural = "Workstreams"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class Path(MasterDataModel):
    """Catálogo canônico dos tipos de caminho/rota usados na execução de
    cabeamento — o tipo lógico/operacional do caminho (ex: PATH-A), não uma
    rota física concreta de um projeto. Existe para padronizar termos
    equivalentes encontrados em SOWs ("Route A", "Path A", "Rota A" devem
    todos apontar para o mesmo registro canônico PATH-A); a normalização
    de texto livre por alias fica preparada para uma fase futura
    (path_aliases), mas não é criada nesta etapa — aqui é só o catálogo,
    sem relação com CableFamily, Network ou scope_connections."""

    # Sugestões (não é ENUM/choices — texto livre para não travar valores
    # novos que apareçam na prática).
    PATH_GROUP_SUGGESTIONS = ("REDUNDANT_PATH", "INTERNAL", "CROSS_CONNECTION", "DUCT", "UNSPECIFIED")
    PATH_TYPE_SUGGESTIONS = ("A", "B", "INTER_RACK", "CROSS_CONNECT", "DIRECT", "UNSPECIFIED")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    path_group = models.CharField("grupo", max_length=50)
    path_type = models.CharField("tipo", max_length=50)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Rota/Caminho"
        verbose_name_plural = "Rotas/Caminhos"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class Site(MasterDataModel):
    """Catálogo canônico de sites/datacenters — o nível mais alto da
    topologia física (ex: GRU65, GRU60, VCP1). `locations` (fase futura)
    terá uma FK para este model (ex: Location "GRU65.01-01-010-55" ->
    Site "GRU65"); esta tabela NÃO guarda room/row/rack/position/RU/device
    nem a string completa de location — isso é responsabilidade de
    `locations`/`devices`.

    Nome propositalmente igual ao de `core.models.Site` (o site do
    Cliente, usado em Cadastros Gerais) — são conceitos DIFERENTES
    (aquele é "onde o cliente está", este é "datacenter/site físico da
    topologia de cabeamento"); convivem em apps diferentes sem colidir no
    banco (tabelas `core_site` x `master_data_site`), só exigindo import
    com alias (`Site as MasterDataSite`) nos arquivos que já importam
    `core.models.Site`."""

    SITE_TYPE_SUGGESTIONS = ("DATACENTER", "OPTDC", "OTHER")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    city = models.CharField("cidade", max_length=100, blank=True)
    state = models.CharField("estado", max_length=100, blank=True)
    country = models.CharField("país", max_length=100, blank=True)
    # Texto livre (não ENUM/choices) de propósito — sugestões: DATACENTER,
    # OPTDC, OTHER. Não inferir OPTDC automaticamente pelo código; só
    # preencher com informação explícita/cadastro manual.
    site_type = models.CharField("tipo de site", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Site"
        verbose_name_plural = "Sites"
        ordering = ("code",)

    def __str__(self):
        # Só o código (diferente de CableFamily/CableSpec, que usam
        # "código — nome") de propósito: core.csv_io resolve FK em CSV
        # comparando por igualdade de texto contra str(candidato) — para
        # que a importação de Location possa identificar o Site só pelo
        # código ("GRU65"), sem exigir "GRU65 — GRU65" nem o ID interno.
        return self.code


def find_conflicting_site_for_address(canonical_address, site):
    """Se `canonical_address` começar explicitamente com o código de um
    site DIFERENTE de `site` (com um limite claro logo depois — fim da
    string ou um caractere não alfanumérico como "." ou "-"), retorna esse
    outro site (o conflito). Retorna None quando o endereço não começa com
    nenhum código de site conhecido (ex: "MR01-01-018-99" — aceito sem
    checagem) ou quando começa com o código do próprio `site` informado
    (caso normal)."""
    if not canonical_address or site is None:
        return None
    normalized = canonical_address.strip().upper()
    for other in Site.objects.exclude(pk=site.pk):
        prefix = (other.code or "").strip().upper()
        if not prefix:
            continue
        if normalized == prefix or (
            normalized.startswith(prefix) and not normalized[len(prefix) : len(prefix) + 1].isalnum()
        ):
            return other
    return None


class Location(MasterDataModel):
    """Catálogo canônico de localizações físicas dentro de um Site — ONDE
    algo está fisicamente (ex: GRU65.01-01-010-55), não O QUE está lá
    (isso é Device, fase futura) nem uma conexão entre dois pontos (isso é
    Connection, fase futura). Os formatos de endereço encontrados em SOWs/
    cutsheets não são uniformes, por isso `canonical_address` é sempre a
    fonte da verdade (preservada exatamente como encontrada) e os campos
    estruturais (area/room/row/rack/position/ru) são só atributos opcionais
    — nenhum parser automático tenta decompor o endereço nesta etapa."""

    LOCATION_TYPE_SUGGESTIONS = ("RACK_POSITION", "IDF", "MR", "ROW", "ROOM", "PATCH_POINT", "OTHER")

    site = models.ForeignKey(Site, verbose_name="site", on_delete=models.PROTECT, related_name="locations")
    code = models.CharField("código", max_length=100, unique=True)
    canonical_address = models.CharField("endereço canônico", max_length=255, unique=True)
    area = models.CharField("área", max_length=50, blank=True)
    room = models.CharField("room", max_length=50, blank=True)
    row = models.CharField("row", max_length=50, blank=True)
    rack = models.CharField("rack", max_length=50, blank=True)
    position = models.CharField("posição", max_length=50, blank=True)
    ru = models.CharField("RU", max_length=50, blank=True)
    # Texto livre (não ENUM/choices) de propósito — sugestões: RACK_POSITION,
    # IDF, MR, ROW, ROOM, PATCH_POINT, OTHER.
    location_type = models.CharField("tipo de localização", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Localização"
        verbose_name_plural = "Localizações"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.canonical_address}"

    def clean(self):
        super().clean()
        if not self.site_id:
            return
        conflicting_site = find_conflicting_site_for_address(self.canonical_address, self.site)
        if conflicting_site is not None:
            raise ValidationError(
                {
                    "canonical_address": (
                        f'O endereço "{self.canonical_address}" começa com o código de outro site '
                        f"({conflicting_site.code}), diferente do site selecionado ({self.site.code})."
                    )
                }
            )


class DeviceType(MasterDataModel):
    """Catálogo canônico dos TIPOS de dispositivo/equipamento encontrados em
    SOWs e cutsheets — representa o tipo (ex: EUCLID_SPINE, MGMT_SWITCH),
    não a instância física real (ex: "gru4-65-es-e1-s9-r[1-16]"); a
    instância concreta será `Device`, numa fase futura, com FK para este
    catálogo e para `Location`. Sem relação com Location nesta etapa."""

    CATEGORY_SUGGESTIONS = ("RACK", "SWITCH", "NETWORK_DEVICE", "PATCHING", "WIRELESS", "INFRASTRUCTURE", "OTHER")
    DEFAULT_MEDIUM_SUGGESTIONS = ("FIBER", "COPPER", "MIXED", "GENERAL")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    category = models.CharField("categoria", max_length=50)
    default_medium = models.CharField("meio padrão", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Tipo de Dispositivo"
        verbose_name_plural = "Tipos de Dispositivo"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}"


class TaskTemplate(MasterDataModel):
    """Cabeçalho/classificação de uma 'receita' de execução padronizada
    para um tipo de escopo (ex: TPL-FIBER-ROBUST). Ainda NÃO contém as
    etapas detalhadas da receita — isso será `task_template_steps`, numa
    fase futura, junto com as regras de aplicabilidade e as relações com
    CableFamily/Network/Workstream/Path/Activity (nenhuma dessas relações
    existe aqui de propósito)."""

    CATEGORY_SUGGESTIONS = ("CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE")
    MEDIUM_SUGGESTIONS = ("FIBER", "COPPER", "MIXED", "GENERAL")

    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    category = models.CharField("categoria", max_length=50)
    medium = models.CharField("meio", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Template de Tarefa"
        verbose_name_plural = "Templates de Tarefa"
        ordering = ("code",)

    def __str__(self):
        # Só o código — mesmo motivo de Activity/Site: permite que a
        # importação de CSV de TaskTemplateStep resolva `task_template`
        # pelo código, via o mecanismo genérico de core.csv_io.
        return self.code


class TaskTemplateStep(MasterDataModel):
    """Uma etapa (uma Activity, em uma ordem) dentro da 'receita' de um
    TaskTemplate — ex: TPL-FIBER-PRETERMINATED tem as etapas MAT-SEP(10),
    MAT-CHECK(20), CAB-LABEL(30) etc. Sem `code` próprio (não é um
    catálogo, é uma linha de composição de outro catálogo). Não implementa
    ainda geração automática de tarefas nem cálculo de quantidade — isso
    fica para quando o motor de regras/produtividade existir."""

    QUANTITY_SOURCE_SUGGESTIONS = (
        "SCOPE_ITEM",
        "CABLE_COUNT",
        "LINK_COUNT",
        "METERAGE",
        "PROJECT",
        "MANUAL",
        "NONE",
    )

    task_template = models.ForeignKey(
        TaskTemplate, verbose_name="template", on_delete=models.PROTECT, related_name="steps"
    )
    activity = models.ForeignKey(
        Activity, verbose_name="atividade", on_delete=models.PROTECT, related_name="template_steps"
    )
    step_order = models.PositiveIntegerField("ordem", validators=[MinValueValidator(1)])
    # Se vazio, o nome efetivo da etapa é activity.name (ver
    # `effective_name`) — permite um rótulo mais específico só dentro
    # deste template, sem alterar o catálogo canônico da Activity.
    name_override = models.CharField("nome personalizado", max_length=150, blank=True)
    required = models.BooleanField("obrigatória", default=True)
    repeatable = models.BooleanField("repetível", default=False)
    # Texto livre (não ENUM/choices) de propósito — sugestões: SCOPE_ITEM,
    # CABLE_COUNT, LINK_COUNT, METERAGE, PROJECT, MANUAL, NONE.
    quantity_source = models.CharField("origem da quantidade", max_length=50, blank=True)
    unit_override = models.CharField("unidade sobrescrita", max_length=50, blank=True)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Etapa de Template de Tarefa"
        verbose_name_plural = "Etapas de Template de Tarefa"
        ordering = ("task_template", "step_order")
        constraints = [
            # Também cobre, por consequência estrutural, a unicidade mais
            # ampla pedida (task_template + activity + step_order): se
            # (task_template, step_order) já é único, não há como duas
            # linhas colidirem nos três campos ao mesmo tempo.
            models.UniqueConstraint(
                fields=("task_template", "step_order"),
                name="unique_step_order_per_template",
            ),
        ]

    def __str__(self):
        return f"{self.task_template.code} #{self.step_order} — {self.effective_name}"

    @property
    def effective_name(self):
        return self.name_override or self.activity.name


class TaskTemplateRule(MasterDataModel):
    """Regra de seleção de TaskTemplate para um item de escopo — a base do
    futuro motor de geração automática de tarefas (Rules Engine). Uma regra
    associa um TaskTemplate obrigatório a um conjunto de critérios
    OPCIONAIS (família de cabo, especificação, rede, workstream, meio,
    pré-terminado); um critério deixado em branco/nulo significa "não
    restringir por este atributo" — uma regra com todos os critérios
    vazios é um fallback totalmente genérico (ex: qualquer item de meio
    FIBER usa TPL-FIBER-PRETERMINATED). `cable_family`/`cable_spec`/
    `network`/`workstream` resolvem em CSV pelo __str__ padrão desses
    models ("código — nome", já usado por CableAlias/CableSpec há mais
    tempo) — não alteramos esses __str__ para bare code, ao contrário do
    que foi feito para Site/Activity/TaskTemplate, porque isso quebraria o
    formato de CSV já em uso por CableAlias/CableSpec; só `task_template`
    resolve por código puro, pois TaskTemplate.__str__ já é bare code.

    Esta etapa cria só o CATÁLOGO de regras e a métrica de especificidade
    (`specificity_score`); a seleção automática de fato (comparar um
    ScopeItem real contra as regras, aplicar priority/specificity_score
    para desempate) fica para uma fase futura — ScopeItem ainda não existe
    no sistema."""

    task_template = models.ForeignKey(
        TaskTemplate, verbose_name="template", on_delete=models.PROTECT, related_name="rules"
    )
    cable_family = models.ForeignKey(
        CableFamily,
        verbose_name="família de cabo",
        on_delete=models.PROTECT,
        related_name="task_template_rules",
        null=True,
        blank=True,
    )
    cable_spec = models.ForeignKey(
        CableSpec,
        verbose_name="especificação de cabo",
        on_delete=models.PROTECT,
        related_name="task_template_rules",
        null=True,
        blank=True,
    )
    network = models.ForeignKey(
        Network,
        verbose_name="rede",
        on_delete=models.PROTECT,
        related_name="task_template_rules",
        null=True,
        blank=True,
    )
    workstream = models.ForeignKey(
        Workstream,
        verbose_name="workstream",
        on_delete=models.PROTECT,
        related_name="task_template_rules",
        null=True,
        blank=True,
    )
    code = models.CharField("código", max_length=50, unique=True)
    name = models.CharField("nome", max_length=150)
    # Texto livre (não ENUM/choices) de propósito — sugestões: FIBER,
    # COPPER, MIXED. "" (vazio) significa "não restringir por meio".
    medium = models.CharField("meio", max_length=50, blank=True)
    # Nullable de propósito — tri-state: True/False restringem a regra a
    # itens pré-terminados ou terminados em campo; None significa "não
    # restringir por este atributo" (diferente de False, que EXIGE que o
    # item NÃO seja pré-terminado).
    preterminated = models.BooleanField("pré-terminado", null=True, blank=True, default=None)
    # Menor valor = maior prioridade (ex: 10 = regra específica, 100 =
    # genérica, 500 = fallback). Usado pelo futuro Rules Engine para
    # desempate entre regras compatíveis — não implementado ainda.
    priority = models.PositiveIntegerField("prioridade", default=100)
    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    class Meta:
        verbose_name = "Regra de Template de Tarefa"
        verbose_name_plural = "Regras de Template de Tarefa"
        ordering = ("priority", "code")

    def __str__(self):
        return f"{self.code} — {self.name}"

    @property
    def specificity_score(self):
        """Quantidade de critérios OPCIONAIS preenchidos nesta regra —
        cable_family, cable_spec, network, workstream, medium,
        preterminated. Quanto maior, mais específica a regra (usado pelo
        futuro Rules Engine, junto com `priority`, para desempate)."""
        score = 0
        if self.cable_family_id:
            score += 1
        if self.cable_spec_id:
            score += 1
        if self.network_id:
            score += 1
        if self.workstream_id:
            score += 1
        if self.medium:
            score += 1
        if self.preterminated is not None:
            score += 1
        return score

    def clean(self):
        super().clean()
        errors = {}
        if self.cable_spec_id and self.cable_family_id and self.cable_spec.cable_family_id != self.cable_family_id:
            errors["cable_spec"] = (
                f'A especificação "{self.cable_spec.code}" pertence à família '
                f'"{self.cable_spec.cable_family.code}", diferente da família selecionada nesta regra '
                f'("{self.cable_family.code}").'
            )
        if not errors and self.active:
            duplicate = (
                TaskTemplateRule.objects.filter(
                    active=True,
                    task_template_id=self.task_template_id,
                    cable_family_id=self.cable_family_id,
                    cable_spec_id=self.cable_spec_id,
                    network_id=self.network_id,
                    workstream_id=self.workstream_id,
                    medium=self.medium or "",
                    preterminated=self.preterminated,
                    priority=self.priority,
                )
                .exclude(pk=self.pk)
                .first()
            )
            if duplicate is not None:
                # Chave "non_field_errors" (não "__all__") de propósito: é o
                # que o frontend (EntityCrudPanel) já procura para mostrar
                # um erro de formulário que não pertence a um campo
                # específico (ver formErrors.non_field_errors).
                errors["non_field_errors"] = (
                    f'Já existe uma regra ativa idêntica nos critérios, template e prioridade ("{duplicate.code}").'
                )
        if errors:
            raise ValidationError(errors)


class ScopeItemSequence(models.Model):
    """Contador atômico para gerar ScopeItem.code (SCOPE-ITEM-NNNNNN) —
    mesmo padrão de core.models.TaskSequence, com select_for_update() para
    evitar colisão de código sob concorrência. Uma única linha (pk=1)."""

    id = models.PositiveIntegerField(primary_key=True, default=1, editable=False)
    last_number = models.PositiveIntegerField("último número", default=0)

    class Meta:
        verbose_name = "sequência de itens de escopo"
        verbose_name_plural = "sequências de itens de escopo"


class ScopeItem(MasterDataModel):
    """Item técnico extraído de um SOW/cutsheet/escopo — o elo
    intermediário entre texto livre e execução real:

    SOW/Texto Livre -> ScopeItem -> Task Rule Resolver -> TaskTemplate ->
    TaskTemplateSteps -> Tasks (futuras).

    Representa O QUE O ESCOPO PEDE — nunca O QUE PRECISAMOS FAZER (isso
    continua sendo responsabilidade de Task, numa fase futura). Por isso
    NENHUMA Task é criada a partir daqui, mesmo depois de resolvido: os
    campos `resolved_rule`/`resolved_template`/`rule_resolution_status`
    só registram o RESULTADO da última resolução (para consulta/auditoria
    e para uma fase futura de geração de Tasks), nunca uma execução real.
    Cadastro manual nesta etapa; o preenchimento por IA é uma fase futura
    que vai gravar exatamente os mesmos campos, através do mesmo
    mecanismo de normalização/resolução."""

    ITEM_TYPE_SUGGESTIONS = ("CABLE", "HARDWARE", "SERVICE", "OTHER")
    LENGTH_TYPE_SUGGESTIONS = ("EXACT", "MAXIMUM", "MINIMUM", "RANGE", "UNKNOWN")
    SOURCE_TYPE_SUGGESTIONS = ("SOW", "CUTSHEET", "MANUAL", "AI", "IMPORT")
    RULE_RESOLUTION_STATUS_SUGGESTIONS = ("NOT_RESOLVED", "RESOLVED", "NO_MATCH", "CONFLICT", "REVIEW_REQUIRED")

    # Gerado automaticamente em save() (ver abaixo) — não editável
    # diretamente, mesmo padrão de core.models.Task.code. blank=True (ao
    # contrário de Task.code) de propósito: permite que
    # core.csv_io.import_csv_rows() chame obj.full_clean() com o código
    # ainda vazio (a coluna não existe no CSV — é gerada só em save());
    # sem isso, clean_fields() rejeitaria o valor vazio antes mesmo de
    # save() ter a chance de gerar o código.
    code = models.CharField("código", max_length=30, unique=True, blank=True, editable=False)
    name = models.CharField("nome", max_length=200, blank=True)
    # Texto livre (não ENUM/choices) de propósito — sugestões: CABLE,
    # HARDWARE, SERVICE, OTHER. Nesta primeira etapa o foco real é CABLE.
    item_type = models.CharField("tipo", max_length=50)

    cable_family = models.ForeignKey(
        CableFamily,
        verbose_name="família de cabo",
        on_delete=models.PROTECT,
        related_name="scope_items",
        null=True,
        blank=True,
    )
    cable_spec = models.ForeignKey(
        CableSpec,
        verbose_name="especificação de cabo",
        on_delete=models.PROTECT,
        related_name="scope_items",
        null=True,
        blank=True,
    )
    network = models.ForeignKey(
        Network, verbose_name="rede", on_delete=models.PROTECT, related_name="scope_items", null=True, blank=True
    )
    workstream = models.ForeignKey(
        Workstream,
        verbose_name="workstream",
        on_delete=models.PROTECT,
        related_name="scope_items",
        null=True,
        blank=True,
    )
    path = models.ForeignKey(
        Path,
        verbose_name="rota/caminho",
        on_delete=models.PROTECT,
        related_name="scope_items",
        null=True,
        blank=True,
    )

    quantity = models.PositiveIntegerField("quantidade", default=1, validators=[MinValueValidator(1)])
    # Texto livre (não ENUM/choices) de propósito — sugestões: CABLE,
    # LINK, UNIT, HOUR. Não cria tabela de unidades ainda.
    unit = models.CharField("unidade", max_length=50, blank=True)

    # Texto livre (não ENUM/choices) de propósito — sugestões: EXACT,
    # MAXIMUM, MINIMUM, RANGE, UNKNOWN.
    length_type = models.CharField("tipo de metragem", max_length=50, blank=True)
    # DecimalField (não PositiveIntegerField) de propósito — precisa
    # permitir metragem fracionada (ex: 2.5m).
    length_m = models.DecimalField(
        "metragem (m)",
        max_digits=9,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0"))],
    )

    # Texto livre (não ENUM/choices) de propósito — sugestões: FIBER,
    # COPPER. Derivado de cable_family.medium quando vazio (ver
    # master_data.services.scope_item_normalizer).
    medium = models.CharField("meio", max_length=50, blank=True)
    # Nullable de propósito — tri-state: True/False/None ("não
    # informado"). NUNCA derivado silenciosamente de
    # CableFamily.preterminated (ver docstring do normalizer) — uma
    # mesma família pode ser usada terminada em campo OU pré-terminada
    # dependendo do item real de escopo.
    preterminated = models.BooleanField("pré-terminado", null=True, blank=True, default=None)
    color = models.CharField("cor", max_length=50, blank=True)
    fiber_count = models.PositiveIntegerField("nº de fibras", null=True, blank=True)

    # Preserva EXATAMENTE o trecho original do SOW/cutsheet que originou
    # o item — crítico para auditoria, nunca reescrito automaticamente.
    raw_text = models.TextField("texto original")
    # Texto livre (não ENUM/choices) de propósito — sugestões: SOW,
    # CUTSHEET, MANUAL, AI, IMPORT.
    source_type = models.CharField("tipo de fonte", max_length=50, blank=True)
    source_reference = models.CharField("referência da fonte", max_length=255, blank=True)

    confidence_score = models.DecimalField(
        "confiança",
        max_digits=3,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0")), MaxValueValidator(Decimal("1"))],
    )
    requires_review = models.BooleanField("exige revisão", default=False)

    description = models.TextField("descrição", blank=True)
    active = models.BooleanField("ativo", default=True)

    # Só para auditoria da normalização (ver normalize_scope_item) — NUNCA
    # substitui os campos estruturados (cable_family/medium), só registra
    # de onde o valor final veio. editable=False: preenchido só por
    # normalize_scope_item, nunca diretamente pelo usuário/API.
    normalization_metadata = models.JSONField(
        "metadados de normalização", default=dict, blank=True, editable=False
    )

    # Resultado da ÚLTIMA resolução (ver task_rule_resolver.
    # apply_resolution_to_scope_item) — nunca preenchido manualmente,
    # nunca usado para criar uma Task (essa etapa não existe ainda).
    resolved_rule = models.ForeignKey(
        TaskTemplateRule,
        verbose_name="regra resolvida",
        on_delete=models.PROTECT,
        related_name="resolved_scope_items",
        null=True,
        blank=True,
        editable=False,
    )
    resolved_template = models.ForeignKey(
        TaskTemplate,
        verbose_name="template resolvido",
        on_delete=models.PROTECT,
        related_name="resolved_scope_items",
        null=True,
        blank=True,
        editable=False,
    )
    # Texto livre (não ENUM/choices) de propósito — sugestões:
    # NOT_RESOLVED, RESOLVED, NO_MATCH, CONFLICT, REVIEW_REQUIRED.
    rule_resolution_status = models.CharField(
        "status da resolução", max_length=30, default="NOT_RESOLVED", editable=False
    )

    class Meta:
        verbose_name = "Item de Escopo"
        verbose_name_plural = "Itens de Escopo"
        ordering = ("code",)

    def __str__(self):
        return f"{self.code} — {self.name}" if self.name else self.code

    def clean(self):
        super().clean()
        try:
            normalize_scope_item(self)
        except ScopeItemNormalizationError as exc:
            raise ValidationError({"cable_spec": str(exc)})

    def save(self, *args, **kwargs):
        if self.code:
            return super().save(*args, **kwargs)

        with transaction.atomic():
            try:
                sequence = ScopeItemSequence.objects.select_for_update().get(pk=1)
            except ScopeItemSequence.DoesNotExist:
                try:
                    with transaction.atomic():
                        sequence = ScopeItemSequence.objects.create(pk=1)
                except IntegrityError:
                    sequence = ScopeItemSequence.objects.select_for_update().get(pk=1)

            sequence.last_number += 1
            sequence.save(update_fields=("last_number",))
            self.code = f"SCOPE-ITEM-{sequence.last_number:06d}"
            return super().save(*args, **kwargs)
