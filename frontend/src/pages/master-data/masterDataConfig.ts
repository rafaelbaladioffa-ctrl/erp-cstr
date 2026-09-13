import { masterDataApi } from "../../api/resources";
import type { CableAlias, CableFamily } from "../../api/types";
import { modelPerms } from "../../utils/permissions";
import type { EntityConfig, ReferenceData } from "../cadastros/registryConfig";

/** Espelha master_data.models.CableAlias.ALIAS_TYPE_SUGGESTIONS no backend —
 * não é um ENUM rígido (o campo é texto livre), só as opções mostradas no
 * filtro e como sugestão no formulário. */
const ALIAS_TYPE_SUGGESTIONS = ["NAME_VARIATION", "PART_NUMBER", "LEGACY_NAME", "SOW_TERM", "INTERNAL_TERM"];

function cableFamilyOptions(refs: ReferenceData) {
  return refs.cableFamilies.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` }));
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

export const MASTER_DATA_CATEGORIES: MasterDataCategory[] = [
  { key: "engenharia", label: "Engenharia", icon: "cable", entities: [cableFamilyEntity, cableAliasEntity] },
  { key: "operacao", label: "Operação", icon: "engineering", entities: [] },
  { key: "infraestrutura", label: "Infraestrutura", icon: "lan", entities: [] },
  { key: "planejamento", label: "Planejamento", icon: "insights", entities: [] },
];
