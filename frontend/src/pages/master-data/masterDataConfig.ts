import { masterDataApi } from "../../api/resources";
import type {
  Activity,
  CableAlias,
  CableFamily,
  CableSpec,
  CertificationType,
  DeviceType,
  Location,
  MasterDataSite,
  Network,
  Path,
  TaskTemplate,
  TaskTemplateStep,
  Workstream,
} from "../../api/types";
import { modelPerms } from "../../utils/permissions";
import type { EntityConfig, ReferenceData } from "../cadastros/registryConfig";

/** Espelha master_data.models.CableAlias.ALIAS_TYPE_SUGGESTIONS no backend —
 * não é um ENUM rígido (o campo é texto livre), só as opções mostradas no
 * filtro e como sugestão no formulário. */
const ALIAS_TYPE_SUGGESTIONS = ["NAME_VARIATION", "PART_NUMBER", "LEGACY_NAME", "SOW_TERM", "INTERNAL_TERM"];

/** Espelha master_data.models.Activity.CATEGORY_SUGGESTIONS/
 * EXECUTION_TYPE_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const ACTIVITY_CATEGORY_SUGGESTIONS = [
  "PREPARATION",
  "INSTALLATION",
  "ORGANIZATION",
  "TERMINATION",
  "CERTIFICATION",
  "QUALITY",
  "DOCUMENTATION",
  "SITE",
  "CLOSURE",
];
const ACTIVITY_EXECUTION_TYPE_SUGGESTIONS = ["MANUAL", "TEST", "DOCUMENTATION", "INSPECTION", "SERVICE"];

/** Espelha master_data.models.Network.DOMAIN_SUGGESTIONS/MEDIUM_SUGGESTIONS
 * no backend — não é ENUM rígido, só as opções mostradas no filtro e como
 * sugestão no formulário. */
const NETWORK_DOMAIN_SUGGESTIONS = ["CORPORATE", "CONSOLE", "MANAGEMENT", "WAP"];
const NETWORK_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER"];

/** Espelha master_data.models.Workstream.CATEGORY_SUGGESTIONS/
 * DEFAULT_MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const WORKSTREAM_CATEGORY_SUGGESTIONS = ["CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE"];
const WORKSTREAM_DEFAULT_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.Path.PATH_GROUP_SUGGESTIONS/
 * PATH_TYPE_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const PATH_GROUP_SUGGESTIONS = ["REDUNDANT_PATH", "INTERNAL", "CROSS_CONNECTION", "DUCT", "UNSPECIFIED"];
const PATH_TYPE_SUGGESTIONS = ["A", "B", "INTER_RACK", "CROSS_CONNECT", "DIRECT", "UNSPECIFIED"];

/** Espelha master_data.models.Site.SITE_TYPE_SUGGESTIONS no backend — não
 * é ENUM rígido, só as opções mostradas no filtro e como sugestão no
 * formulário. */
const SITE_TYPE_SUGGESTIONS = ["DATACENTER", "OPTDC", "OTHER"];

/** Espelha master_data.models.Location.LOCATION_TYPE_SUGGESTIONS no
 * backend — não é ENUM rígido, só as opções mostradas no filtro e como
 * sugestão no formulário. */
const LOCATION_TYPE_SUGGESTIONS = ["RACK_POSITION", "IDF", "MR", "ROW", "ROOM", "PATCH_POINT", "OTHER"];

/** Espelha master_data.models.DeviceType.CATEGORY_SUGGESTIONS/
 * DEFAULT_MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const DEVICE_TYPE_CATEGORY_SUGGESTIONS = ["RACK", "SWITCH", "NETWORK_DEVICE", "PATCHING", "WIRELESS", "INFRASTRUCTURE", "OTHER"];
const DEVICE_TYPE_DEFAULT_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.TaskTemplate.CATEGORY_SUGGESTIONS/
 * MEDIUM_SUGGESTIONS no backend — não é ENUM rígido, só as opções
 * mostradas no filtro e como sugestão no formulário. */
const TASK_TEMPLATE_CATEGORY_SUGGESTIONS = ["CABLING", "HARDWARE", "WIRELESS", "SERVICE", "CLOSURE"];
const TASK_TEMPLATE_MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED", "GENERAL"];

/** Espelha master_data.models.TaskTemplateStep.QUANTITY_SOURCE_SUGGESTIONS
 * no backend — não é ENUM rígido (o seed real usa até um valor fora dessa
 * lista, CONNECTION_COUNT, para CAB-CRIMP), só sugestões no formulário. */
const QUANTITY_SOURCE_SUGGESTIONS = ["SCOPE_ITEM", "CABLE_COUNT", "LINK_COUNT", "METERAGE", "PROJECT", "MANUAL", "NONE"];

function cableFamilyOptions(refs: ReferenceData) {
  return refs.cableFamilies.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }));
}

function masterDataSiteOptions(refs: ReferenceData) {
  return refs.masterDataSites.map((s) => ({ value: s.id, label: `${s.code} — ${s.name}` }));
}

function taskTemplateOptions(refs: ReferenceData) {
  return refs.taskTemplates.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }));
}

function activityOptions(refs: ReferenceData) {
  return refs.activities.map((a) => ({ value: a.id, label: `${a.code} — ${a.name}` }));
}

/** Cadastros Mestres: catálogo técnico/operacional normalizado (famílias
 * de cabo, futuramente conectores, certificações, dispositivos etc.) —
 * separado dos Cadastros Gerais (empresas, sites, colaboradores...),
 * pensado para alimentar automações futuras (geração de escopo/tarefas
 * por IA a partir de um SOW). Reaproveita o mesmo `EntityConfig` e o
 * mesmo `EntityCrudPanel` dos Cadastros Gerais — só muda o agrupamento
 * por categoria na navegação.
 *
 * Para adicionar um novo cadastro mestre no futuro: criar o model em
 * `backend/master_data`, o serializer/ViewSet em `api/` (mesmo padrão de
 * `CableFamilyViewSet`), registrar a rota em `api/urls.py` sob
 * `master-data/<algo>`, e adicionar um `EntityConfig` aqui, na categoria
 * correta — nenhum componente de tela novo é necessário.
 */

export interface MasterDataCategory {
  key: string;
  label: string;
  icon: string;
  entities: EntityConfig<any>[];
}

/** "TRUNK" -> "Trunk" — só para exibição; o valor canônico (uppercase)
 * continua sendo o que é salvo e editado no formulário. */
function titleCase(value: string) {
  if (!value) return value;
  return value.charAt(0) + value.slice(1).toLowerCase();
}

/** "LC ↔ LC" quando os dois conectores são iguais, "MPO → LC" quando são
 * diferentes, "—" quando nenhum dos dois está preenchido. */
function connectorsDisplay(a: string, b: string) {
  if (!a && !b) return "—";
  if (a && b) return a === b ? `${a} ↔ ${b}` : `${a} → ${b}`;
  return a || b;
}

/** Opções de filtro derivadas dos valores já cadastrados (ex: part numbers,
 * tipos de fibra, polaridades) — não têm uma lista fixa como alias_type,
 * então em vez de inventar valores, o filtro só oferece o que já existe. */
function distinctOptions(rows: Record<string, unknown>[], key: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string" && value) seen.add(value);
  }
  return Array.from(seen)
    .sort()
    .map((value) => ({ value, label: value }));
}

const cableFamilyEntity: EntityConfig<CableFamily> = {
  key: "cable-families",
  label: "Famílias de Cabos",
  icon: "cable",
  singular: "Família de Cabo",
  description: "Catálogo padronizado de famílias de cabo (sem metragem) usado em escopos e tarefas.",
  createLabel: "Nova Família de Cabo",
  perms: modelPerms("master_data", "cablefamily"),
  api: masterDataApi.cableFamilies,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "medium", label: "Meio", render: (row) => (row.medium === "COPPER" ? "Cobre" : "Fibra") },
    { key: "fiber_count", label: "Fibras", render: (row) => (row.fiber_count == null ? "—" : String(row.fiber_count)) },
    { key: "connectors", label: "Conectores", render: (row) => connectorsDisplay(row.connector_a, row.connector_b) },
    { key: "cable_category", label: "Categoria", render: (row) => (row.cable_category ? titleCase(row.cable_category) : "—") },
    { key: "preterminated", label: "Pré-terminado", render: (row) => (row.preterminated ? "Sim" : "Não") },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: FIB-8F-LCLC" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: 8F LC-LC" },
    {
      name: "medium",
      label: "Meio",
      type: "select",
      required: true,
      options: [
        { value: "FIBER", label: "Fibra" },
        { value: "COPPER", label: "Cobre" },
      ],
    },
    { name: "fiber_count", label: "Nº de Fibras", type: "number" },
    { name: "connector_a", label: "Conector A", type: "text" },
    { name: "connector_b", label: "Conector B", type: "text" },
    { name: "cable_category", label: "Categoria do Cabo", type: "text", placeholder: "Ex: TRUNK, PATCH, BREAKOUT" },
    { name: "preterminated", label: "Pré-terminado", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    medium: "FIBER",
    fiber_count: null,
    connector_a: "",
    connector_b: "",
    cable_category: "",
    preterminated: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const cableAliasEntity: EntityConfig<CableAlias> = {
  key: "cable-aliases",
  label: "Aliases de Cabos",
  icon: "alt_route",
  singular: "Alias de Cabo",
  description: "Formas alternativas de escrita (SOWs, cutsheets, documentos) que apontam para uma Família de Cabo canônica.",
  createLabel: "Novo Alias de Cabo",
  perms: modelPerms("master_data", "cablealias"),
  api: masterDataApi.cableAliases,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "alias", label: "Alias" },
    { key: "cable_family_name", label: "Família Canônica" },
    { key: "cable_family_code", label: "Código da Família" },
    { key: "alias_type", label: "Tipo", render: (row) => row.alias_type || "—" },
  ],
  filters: [
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "alias_type", label: "Todos os Tipos", options: () => ALIAS_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })) },
  ],
  fields: (refs) => [
    { name: "cable_family", label: "Família de Cabo", type: "select", required: true, span: 2, options: cableFamilyOptions(refs) },
    { name: "alias", label: "Alias", type: "text", required: true, span: 2, placeholder: "Ex: 8F LC Trunk Fiber" },
    {
      name: "alias_type",
      label: "Tipo do Alias",
      type: "text",
      placeholder: "Ex: NAME_VARIATION, PART_NUMBER, LEGACY_NAME, SOW_TERM, INTERNAL_TERM",
    },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
  ],
  emptyValues: { cable_family: null, alias: "", alias_type: "", description: "", active: true },
  rowLabel: (row) => `${row.alias} → ${row.cable_family_code}`,
};

const cableSpecEntity: EntityConfig<CableSpec> = {
  key: "cable-specs",
  label: "Especificações de Cabos",
  icon: "settings_ethernet",
  singular: "Especificação de Cabo",
  description: "Fabricante, part number e características físicas concretas de uma Família de Cabo canônica.",
  createLabel: "Nova Especificação de Cabo",
  perms: modelPerms("master_data", "cablespec"),
  api: masterDataApi.cableSpecs,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "cable_family_code", label: "Família" },
    { key: "part_number", label: "Part Number", render: (row) => row.part_number || "—" },
    { key: "fiber_type", label: "Tipo de Fibra", render: (row) => row.fiber_type || "—" },
    { key: "jacket_color", label: "Cor", render: (row) => (row.jacket_color ? titleCase(row.jacket_color) : "—") },
    { key: "polarity", label: "Polaridade", render: (row) => row.polarity || "—" },
    { key: "connectors", label: "Conectores", render: (row) => connectorsDisplay(row.connector_a, row.connector_b) },
    { key: "fiber_count", label: "Fibras", render: (row) => (row.fiber_count == null ? "—" : String(row.fiber_count)) },
  ],
  filters: [
    { key: "cable_family", label: "Todas as Famílias", options: cableFamilyOptions },
    { key: "part_number", label: "Todos os Part Numbers", options: (_refs, rows) => distinctOptions(rows, "part_number") },
    { key: "fiber_type", label: "Todos os Tipos de Fibra", options: (_refs, rows) => distinctOptions(rows, "fiber_type") },
    { key: "polarity", label: "Todas as Polaridades", options: (_refs, rows) => distinctOptions(rows, "polarity") },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: SPEC-72F-MPOB-0072X6P64" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: 72F OS2 Yellow MPO/MPO MPO-B" },
    { name: "cable_family", label: "Família de Cabo", type: "select", required: true, span: 2, options: cableFamilyOptions(refs) },
    { name: "manufacturer", label: "Fabricante", type: "text" },
    { name: "part_number", label: "Part Number", type: "text" },
    { name: "fiber_type", label: "Tipo de Fibra", type: "text", placeholder: "Ex: OS2, OM3, OM4" },
    { name: "jacket_color", label: "Cor da Capa", type: "text", placeholder: "Ex: YELLOW" },
    { name: "polarity", label: "Polaridade", type: "text", placeholder: "Ex: A, B" },
    { name: "connector_a", label: "Conector A", type: "text" },
    { name: "connector_b", label: "Conector B", type: "text" },
    { name: "fiber_count", label: "Nº de Fibras", type: "number" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    cable_family: null,
    manufacturer: "",
    part_number: "",
    fiber_type: "",
    jacket_color: "",
    polarity: "",
    connector_a: "",
    connector_b: "",
    fiber_count: null,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const certificationTypeEntity: EntityConfig<CertificationType> = {
  key: "certification-types",
  label: "Tipos de Certificação",
  icon: "verified",
  singular: "Tipo de Certificação",
  description: "Métodos de certificação/validação usados na operação (OTDR, cobre, QA/QC etc.).",
  createLabel: "Novo Tipo de Certificação",
  perms: modelPerms("master_data", "certificationtype"),
  api: masterDataApi.certificationTypes,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    {
      key: "medium",
      label: "Meio",
      render: (row) => (row.medium === "FIBER" ? "Fibra" : row.medium === "COPPER" ? "Cobre" : row.medium === "GENERAL" ? "Geral" : "—"),
    },
    { key: "method", label: "Método" },
    { key: "requires_report", label: "Exige Relatório", render: (row) => (row.requires_report ? "Sim" : "Não") },
    { key: "requires_attachment", label: "Exige Anexo", render: (row) => (row.requires_attachment ? "Sim" : "Não") },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: CERT-OTDR" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Certificação OTDR" },
    {
      name: "medium",
      label: "Meio",
      type: "select",
      options: [
        { value: "FIBER", label: "Fibra" },
        { value: "COPPER", label: "Cobre" },
        { value: "GENERAL", label: "Geral" },
      ],
    },
    { name: "method", label: "Método", type: "text", required: true, placeholder: "Ex: OTDR, COPPER_CERTIFIER, QA_QC" },
    { name: "requires_report", label: "Exige Relatório", type: "checkbox", placeholder: "Sim" },
    { name: "requires_attachment", label: "Exige Anexo", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    medium: "",
    method: "",
    requires_report: false,
    requires_attachment: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const activityEntity: EntityConfig<Activity> = {
  key: "activities",
  label: "Atividades",
  icon: "checklist",
  singular: "Atividade",
  description: "Catálogo canônico de ações operacionais padronizadas executadas nos projetos.",
  createLabel: "Nova Atividade",
  perms: modelPerms("master_data", "activity"),
  api: masterDataApi.activities,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "execution_type", label: "Tipo de Execução", render: (row) => row.execution_type || "—" },
    { key: "default_unit", label: "Unidade Padrão", render: (row) => row.default_unit || "—" },
    { key: "measurable", label: "Mensurável", render: (row) => (row.measurable ? "Sim" : "Não") },
    { key: "requires_evidence", label: "Exige Evidência", render: (row) => (row.requires_evidence ? "Sim" : "Não") },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => ACTIVITY_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "execution_type",
      label: "Todos os Tipos de Execução",
      options: () => ACTIVITY_EXECUTION_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "measurable",
      label: "Todas (Mensurável)",
      options: () => [
        { value: "true", label: "Mensurável" },
        { value: "false", label: "Não mensurável" },
      ],
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: CAB-RUN" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Lançar cabeamento" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: PREPARATION, INSTALLATION, CERTIFICATION" },
    { name: "execution_type", label: "Tipo de Execução", type: "text", placeholder: "Ex: MANUAL, TEST, INSPECTION" },
    { name: "default_unit", label: "Unidade Padrão", type: "text", placeholder: "Ex: CABLE, METER, UNIT, HOUR, PROJECT" },
    { name: "measurable", label: "Mensurável", type: "checkbox", placeholder: "Sim" },
    { name: "requires_quantity", label: "Exige Quantidade", type: "checkbox", placeholder: "Sim" },
    { name: "requires_evidence", label: "Exige Evidência", type: "checkbox", placeholder: "Sim" },
    { name: "requires_certification", label: "Exige Certificação", type: "checkbox", placeholder: "Sim" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    code: "",
    name: "",
    category: "",
    execution_type: "",
    default_unit: "",
    measurable: false,
    requires_quantity: false,
    requires_evidence: false,
    requires_certification: false,
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const networkEntity: EntityConfig<Network> = {
  key: "networks",
  label: "Redes",
  icon: "hub",
  singular: "Rede",
  description: "Função lógica/operacional da conexão (não o tipo físico do cabo, não a frente de execução do projeto).",
  createLabel: "Nova Rede",
  perms: modelPerms("master_data", "network"),
  api: masterDataApi.networks,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "domain", label: "Domínio" },
    { key: "medium", label: "Meio" },
  ],
  filters: [
    {
      key: "domain",
      label: "Todos os Domínios",
      options: () => NETWORK_DOMAIN_SUGGESTIONS.map((d) => ({ value: d, label: d })),
    },
    {
      key: "medium",
      label: "Todos os Meios",
      options: () => NETWORK_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: MN_FIBER" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Management Network Fiber" },
    { name: "domain", label: "Domínio", type: "text", required: true, placeholder: "Ex: CORPORATE, CONSOLE, MANAGEMENT, WAP" },
    { name: "medium", label: "Meio", type: "text", required: true, placeholder: "Ex: FIBER, COPPER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", domain: "", medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const workstreamEntity: EntityConfig<Workstream> = {
  key: "workstreams",
  label: "Workstreams",
  icon: "route",
  singular: "Workstream",
  description: "Frente operacional de execução — como o escopo é agrupado para planejamento, tarefas e acompanhamento.",
  createLabel: "Novo Workstream",
  perms: modelPerms("master_data", "workstream"),
  api: masterDataApi.workstreams,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "default_medium", label: "Meio Padrão", render: (row) => row.default_medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => WORKSTREAM_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "default_medium",
      label: "Todos os Meios Padrão",
      options: () => WORKSTREAM_DEFAULT_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: WS-MGMT-FIBER" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Management Fibers" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: CABLING, HARDWARE, WIRELESS, SERVICE, CLOSURE" },
    { name: "default_medium", label: "Meio Padrão", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", default_medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const pathEntity: EntityConfig<Path> = {
  key: "paths",
  label: "Rotas / Caminhos",
  icon: "alt_route",
  singular: "Rota/Caminho",
  description: "Tipo lógico/operacional de caminho usado na execução de cabeamento (ex: Path A, Path B, Cross Connection).",
  createLabel: "Nova Rota/Caminho",
  perms: modelPerms("master_data", "path"),
  api: masterDataApi.paths,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "path_group", label: "Grupo" },
    { key: "path_type", label: "Tipo" },
  ],
  filters: [
    {
      key: "path_group",
      label: "Todos os Grupos",
      options: () => PATH_GROUP_SUGGESTIONS.map((g) => ({ value: g, label: g })),
    },
    {
      key: "path_type",
      label: "Todos os Tipos",
      options: () => PATH_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: PATH-A" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Path A" },
    { name: "path_group", label: "Grupo", type: "text", required: true, placeholder: "Ex: REDUNDANT_PATH, INTERNAL, CROSS_CONNECTION, DUCT" },
    { name: "path_type", label: "Tipo", type: "text", required: true, placeholder: "Ex: A, B, INTER_RACK, CROSS_CONNECT, DIRECT" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: { code: "", name: "", path_group: "", path_type: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const masterDataSiteEntity: EntityConfig<MasterDataSite> = {
  key: "master-data-sites",
  label: "Sites",
  icon: "domain",
  singular: "Site",
  description: "Catálogo canônico de sites/datacenters — o nível mais alto da topologia física (ex: GRU65).",
  createLabel: "Novo Site",
  perms: modelPerms("master_data", "site"),
  api: masterDataApi.sites,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "city", label: "Cidade", render: (row) => row.city || "—" },
    { key: "state", label: "Estado", render: (row) => row.state || "—" },
    { key: "country", label: "País", render: (row) => row.country || "—" },
    { key: "site_type", label: "Tipo", render: (row) => row.site_type || "—" },
  ],
  filters: [
    {
      key: "country",
      label: "Todos os Países",
      options: (_refs, rows) => distinctOptions(rows, "country"),
    },
    {
      key: "state",
      label: "Todos os Estados",
      options: (_refs, rows) => distinctOptions(rows, "state"),
    },
    {
      key: "site_type",
      label: "Todos os Tipos",
      options: () => SITE_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: GRU65" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: GRU65" },
    { name: "city", label: "Cidade", type: "text" },
    { name: "state", label: "Estado", type: "text" },
    { name: "country", label: "País", type: "text", placeholder: "Ex: BRAZIL" },
    { name: "site_type", label: "Tipo de Site", type: "text", placeholder: "Ex: DATACENTER, OPTDC, OTHER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", city: "", state: "", country: "", site_type: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const locationEntity: EntityConfig<Location> = {
  key: "locations",
  label: "Localizações",
  icon: "my_location",
  singular: "Localização",
  description: "Localização física dentro de um Site (ex: GRU65.01-01-010-55) — só ONDE algo está, não o quê.",
  createLabel: "Nova Localização",
  perms: modelPerms("master_data", "location"),
  api: masterDataApi.locations,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "canonical_address", label: "Endereço" },
    { key: "site_code", label: "Site" },
    { key: "location_type", label: "Tipo", render: (row) => row.location_type || "—" },
    { key: "area", label: "Área", render: (row) => row.area || "—" },
    { key: "room", label: "Room", render: (row) => row.room || "—" },
    { key: "row", label: "Row", render: (row) => row.row || "—" },
    { key: "position", label: "Posição", render: (row) => row.position || "—" },
  ],
  filters: [
    {
      key: "site",
      label: "Todos os Sites",
      options: masterDataSiteOptions,
    },
    {
      key: "location_type",
      label: "Todos os Tipos",
      options: () => LOCATION_TYPE_SUGGESTIONS.map((t) => ({ value: t, label: t })),
    },
    {
      key: "room",
      label: "Todos os Rooms",
      options: (_refs, rows) => distinctOptions(rows, "room"),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "site", label: "Site", type: "select", required: true, span: 2, options: masterDataSiteOptions(refs) },
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: LOC-GRU65-000001" },
    {
      name: "canonical_address",
      label: "Endereço Canônico",
      type: "text",
      required: true,
      span: 2,
      placeholder: "Ex: GRU65.01-01-010-55",
    },
    { name: "location_type", label: "Tipo de Localização", type: "text", placeholder: "Ex: RACK_POSITION, IDF, MR, ROW, ROOM, PATCH_POINT" },
    { name: "area", label: "Área", type: "text", placeholder: "Ex: ROOM1, MR, IDF" },
    { name: "room", label: "Room", type: "text", placeholder: "Ex: 01-01" },
    { name: "row", label: "Row", type: "text", placeholder: "Ex: 010" },
    { name: "rack", label: "Rack", type: "text" },
    { name: "position", label: "Posição", type: "text", placeholder: "Ex: 55" },
    { name: "ru", label: "RU", type: "text", placeholder: "Ex: RU45" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    site: null,
    code: "",
    canonical_address: "",
    area: "",
    room: "",
    row: "",
    rack: "",
    position: "",
    ru: "",
    location_type: "",
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.code} — ${row.canonical_address}`,
};

const deviceTypeEntity: EntityConfig<DeviceType> = {
  key: "device-types",
  label: "Tipos de Dispositivos",
  icon: "router",
  singular: "Tipo de Dispositivo",
  description: "Catálogo canônico dos tipos de dispositivo/equipamento (ex: EUCLID_SPINE, MGMT_SWITCH) — não a instância física.",
  createLabel: "Novo Tipo de Dispositivo",
  perms: modelPerms("master_data", "devicetype"),
  api: masterDataApi.deviceTypes,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "default_medium", label: "Meio Padrão", render: (row) => row.default_medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => DEVICE_TYPE_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "default_medium",
      label: "Todos os Meios Padrão",
      options: () => DEVICE_TYPE_DEFAULT_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: EUCLID_SPINE" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Euclid Spine" },
    {
      name: "category",
      label: "Categoria",
      type: "text",
      required: true,
      placeholder: "Ex: RACK, SWITCH, NETWORK_DEVICE, PATCHING, WIRELESS, INFRASTRUCTURE",
    },
    { name: "default_medium", label: "Meio Padrão", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", default_medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const taskTemplateEntity: EntityConfig<TaskTemplate> = {
  key: "task-templates",
  label: "Templates de Tarefas",
  icon: "assignment",
  singular: "Template de Tarefa",
  description: "Cabeçalho/classificação de uma receita de execução padronizada para um tipo de escopo (ex: Fibra Robust).",
  createLabel: "Novo Template de Tarefa",
  perms: modelPerms("master_data", "tasktemplate"),
  api: masterDataApi.taskTemplates,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "code", label: "Código" },
    { key: "name", label: "Nome" },
    { key: "category", label: "Categoria" },
    { key: "medium", label: "Meio", render: (row) => row.medium || "—" },
  ],
  filters: [
    {
      key: "category",
      label: "Todas as Categorias",
      options: () => TASK_TEMPLATE_CATEGORY_SUGGESTIONS.map((c) => ({ value: c, label: c })),
    },
    {
      key: "medium",
      label: "Todos os Meios",
      options: () => TASK_TEMPLATE_MEDIUM_SUGGESTIONS.map((m) => ({ value: m, label: m })),
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: () => [
    { name: "code", label: "Código", type: "text", required: true, placeholder: "Ex: TPL-FIBER-ROBUST" },
    { name: "name", label: "Nome", type: "text", required: true, placeholder: "Ex: Fibra Robust" },
    { name: "category", label: "Categoria", type: "text", required: true, placeholder: "Ex: CABLING, HARDWARE, WIRELESS, SERVICE, CLOSURE" },
    { name: "medium", label: "Meio", type: "text", placeholder: "Ex: FIBER, COPPER, MIXED, GENERAL" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
  ],
  emptyValues: { code: "", name: "", category: "", medium: "", description: "", active: true },
  rowLabel: (row) => `${row.code} — ${row.name}`,
};

const taskTemplateStepEntity: EntityConfig<TaskTemplateStep> = {
  key: "task-template-steps",
  label: "Etapas dos Templates",
  icon: "list_alt",
  singular: "Etapa de Template",
  description: "Uma atividade, em uma ordem, dentro da receita de um Template de Tarefa.",
  createLabel: "Nova Etapa de Template",
  perms: modelPerms("master_data", "tasktemplatestep"),
  api: masterDataApi.taskTemplateSteps,
  statusField: "active",
  disableHardDelete: true,
  columns: [
    { key: "task_template_code", label: "Template" },
    { key: "step_order", label: "Ordem" },
    { key: "activity_code", label: "Atividade" },
    { key: "effective_name", label: "Nome da Etapa" },
    { key: "required", label: "Obrigatória", render: (row) => (row.required ? "Sim" : "Não") },
    { key: "repeatable", label: "Repetível", render: (row) => (row.repeatable ? "Sim" : "Não") },
    { key: "quantity_source", label: "Origem da Quantidade", render: (row) => row.quantity_source || "—" },
    { key: "unit_override", label: "Unidade", render: (row) => row.unit_override || "—" },
  ],
  filters: [
    {
      key: "task_template",
      label: "Todos os Templates",
      options: taskTemplateOptions,
    },
    {
      key: "activity",
      label: "Todas as Atividades",
      options: activityOptions,
    },
    {
      key: "active",
      label: "Todas as Situações",
      options: () => [
        { value: "true", label: "Ativo" },
        { value: "false", label: "Inativo" },
      ],
    },
  ],
  fields: (refs) => [
    { name: "task_template", label: "Template", type: "select", required: true, span: 2, options: taskTemplateOptions(refs) },
    { name: "activity", label: "Atividade", type: "select", required: true, span: 2, options: activityOptions(refs) },
    { name: "step_order", label: "Ordem", type: "number", required: true, placeholder: "Ex: 10, 20, 30..." },
    { name: "name_override", label: "Nome Personalizado", type: "text", placeholder: "Ex: Lançar fibra Route A/B" },
    { name: "required", label: "Obrigatória", type: "checkbox", placeholder: "Sim" },
    { name: "repeatable", label: "Repetível", type: "checkbox", placeholder: "Sim" },
    {
      name: "quantity_source",
      label: "Origem da Quantidade",
      type: "text",
      placeholder: `Ex: ${QUANTITY_SOURCE_SUGGESTIONS.join(", ")}`,
    },
    { name: "unit_override", label: "Unidade Sobrescrita", type: "text", placeholder: "Ex: METER" },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
  ],
  emptyValues: {
    task_template: null,
    activity: null,
    step_order: null,
    name_override: "",
    required: true,
    repeatable: false,
    quantity_source: "",
    unit_override: "",
    description: "",
    active: true,
  },
  rowLabel: (row) => `${row.task_template_code} #${row.step_order} — ${row.effective_name}`,
};

export const MASTER_DATA_CATEGORIES: MasterDataCategory[] = [
  {
    key: "engenharia",
    label: "Engenharia",
    icon: "cable",
    entities: [cableFamilyEntity, cableAliasEntity, cableSpecEntity, certificationTypeEntity],
  },
  {
    key: "operacao",
    label: "Operação",
    icon: "engineering",
    entities: [activityEntity, networkEntity, workstreamEntity, pathEntity, taskTemplateEntity, taskTemplateStepEntity],
  },
  {
    key: "infraestrutura",
    label: "Infraestrutura",
    icon: "lan",
    entities: [masterDataSiteEntity, locationEntity, deviceTypeEntity],
  },
  { key: "planejamento", label: "Planejamento", icon: "insights", entities: [] },
];
