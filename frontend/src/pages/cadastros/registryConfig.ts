import { registryApi } from "../../api/resources";
import type {
  Category,
  ClientFull,
  ClientResponsibleFull,
  CollaboratorFull,
  Company,
  JobTitle,
  Paginated,
  ProjectType,
  ResponsibleFull,
  SiteFull,
  TaskFull,
} from "../../api/types";
import type { FieldConfig } from "../../components/ui/DynamicForm";
import { modelPerms, type ModelPerms } from "../../utils/permissions";

export interface ColumnConfig<T> {
  key: string;
  label: string;
  render?: (row: T) => string;
}

export interface EntityConfig<T extends { id: number; is_active?: boolean }> {
  key: string;
  label: string;
  icon: string;
  singular: string;
  /** Codenames reais do Django (view/add/change/delete) para este model —
   * a UI só mostra o que o Grupo do usuário realmente permite. */
  perms: ModelPerms;
  api: {
    list: (params?: Record<string, string>) => Promise<Paginated<T>>;
    create: (payload: Partial<T>) => Promise<T>;
    update: (id: number, payload: Partial<T>) => Promise<T>;
    remove: (id: number) => Promise<unknown>;
  };
  columns: ColumnConfig<T>[];
  fields: (refs: ReferenceData) => FieldConfig[];
  emptyValues: Partial<T>;
  rowLabel: (row: T) => string;
  createLabel: string;
}

export interface ReferenceData {
  companies: Company[];
  jobTitles: JobTitle[];
  sites: SiteFull[];
  clients: ClientFull[];
  projectTypes: ProjectType[];
  collaborators: CollaboratorFull[];
}

function companyOptions(refs: ReferenceData) {
  return refs.companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }));
}

function clientOptions(refs: ReferenceData) {
  return refs.clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }));
}

export const ENTITIES: EntityConfig<any>[] = [
  {
    key: "companies",
    label: "Empresas",
    icon: "apartment",
    singular: "Empresa",
    createLabel: "Nova Empresa",
    perms: modelPerms("core", "company"),
    api: registryApi.companies,
    columns: [
      { key: "trade_name", label: "Nome Fantasia" },
      { key: "legal_name", label: "Razão Social" },
      { key: "tax_id", label: "CNPJ/CPF" },
      { key: "email", label: "E-mail" },
    ],
    fields: () => [
      { name: "trade_name", label: "Nome Fantasia", type: "text", required: true },
      { name: "legal_name", label: "Razão Social", type: "text", span: 2 },
      { name: "tax_id", label: "CNPJ/CPF", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "text" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { trade_name: "", legal_name: "", tax_id: "", email: "", phone: "", is_active: true },
    rowLabel: (row: Company) => row.trade_name || row.legal_name,
  } as EntityConfig<Company>,
  {
    key: "clients",
    label: "Clientes",
    icon: "handshake",
    singular: "Cliente",
    createLabel: "Novo Cliente",
    perms: modelPerms("core", "client"),
    api: registryApi.clients,
    columns: [
      { key: "trade_name", label: "Nome Fantasia" },
      { key: "company_name", label: "Empresa" },
      { key: "tax_id", label: "CNPJ/CPF" },
      { key: "city", label: "Cidade" },
    ],
    fields: (refs) => [
      { name: "trade_name", label: "Nome Fantasia", type: "text", required: true },
      { name: "legal_name", label: "Razão Social", type: "text", span: 2 },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      {
        name: "person_type",
        label: "Tipo de Pessoa",
        type: "select",
        options: [
          { value: "company", label: "Pessoa jurídica" },
          { value: "person", label: "Pessoa física" },
        ],
      },
      { name: "tax_id", label: "CNPJ/CPF", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "text" },
      { name: "city", label: "Cidade", type: "text" },
      { name: "state", label: "UF", type: "text" },
      { name: "address", label: "Endereço", type: "text", span: 2 },
      { name: "notes", label: "Observações", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      trade_name: "", legal_name: "", company: null, person_type: "company", tax_id: "",
      email: "", phone: "", city: "", state: "", address: "", notes: "", is_active: true,
    },
    rowLabel: (row: ClientFull) => row.trade_name || row.legal_name,
  } as EntityConfig<ClientFull>,
  {
    key: "sites",
    label: "Sites",
    icon: "location_on",
    singular: "Site",
    createLabel: "Novo Site",
    perms: modelPerms("core", "site"),
    api: registryApi.sites,
    columns: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "client_name", label: "Cliente" },
      { key: "city", label: "Cidade" },
    ],
    fields: (refs) => [
      { name: "code", label: "Código", type: "text", required: true },
      { name: "name", label: "Nome", type: "text" },
      { name: "client", label: "Cliente", type: "select", required: true, options: clientOptions(refs) },
      { name: "city", label: "Cidade", type: "text" },
      { name: "state", label: "UF", type: "text" },
      { name: "address", label: "Endereço", type: "text", span: 2 },
      {
        name: "manual_coordinates",
        label: "Coordenadas Manuais",
        type: "checkbox",
        placeholder: "Informar latitude/longitude manualmente (sem geocodificação automática)",
        span: 2,
      },
      { name: "latitude", label: "Latitude", type: "text" },
      { name: "longitude", label: "Longitude", type: "text" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      code: "", name: "", client: null, city: "", state: "", address: "",
      manual_coordinates: false, latitude: null, longitude: null, is_active: true,
    },
    rowLabel: (row: SiteFull) => row.code || row.name,
  } as EntityConfig<SiteFull>,
  {
    key: "categories",
    label: "Categorias",
    icon: "sell",
    singular: "Categoria",
    createLabel: "Nova Categoria",
    perms: modelPerms("core", "category"),
    api: registryApi.categories,
    columns: [
      { key: "name", label: "Nome" },
      { key: "description", label: "Descrição" },
    ],
    fields: () => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { name: "", description: "", is_active: true },
    rowLabel: (row: Category) => row.name,
  } as EntityConfig<Category>,
  {
    key: "project-types",
    label: "Tipos de Projeto",
    icon: "category",
    singular: "Tipo de Projeto",
    createLabel: "Novo Tipo de Projeto",
    perms: modelPerms("core", "projecttype"),
    api: registryApi.projectTypes,
    columns: [
      { key: "name", label: "Nome" },
      { key: "description", label: "Descrição" },
    ],
    fields: () => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", description: "", is_active: true },
    rowLabel: (row: ProjectType) => row.name,
  } as EntityConfig<ProjectType>,
  {
    key: "job-titles",
    label: "Cargos",
    icon: "badge",
    singular: "Cargo",
    createLabel: "Novo Cargo",
    perms: modelPerms("core", "jobtitle"),
    api: registryApi.jobTitles,
    columns: [
      { key: "name", label: "Nome" },
      { key: "company_name", label: "Empresa" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", company: null, description: "", is_active: true },
    rowLabel: (row: JobTitle) => row.name,
  } as EntityConfig<JobTitle>,
  {
    key: "collaborators",
    label: "Colaboradores",
    icon: "groups",
    singular: "Colaborador",
    createLabel: "Novo Colaborador",
    perms: modelPerms("core", "collaborator"),
    api: registryApi.collaborators,
    columns: [
      { key: "name", label: "Nome" },
      { key: "registration", label: "Matrícula" },
      { key: "job_title_name", label: "Cargo" },
      { key: "company_name", label: "Empresa" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      { name: "registration", label: "Matrícula", type: "text" },
      { name: "yellow_badge", label: "Yellow Badge", type: "text" },
      { name: "job_title", label: "Cargo", type: "select", options: refs.jobTitles.map((j) => ({ value: j.id, label: j.name })) },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "text" },
      {
        name: "manager",
        label: "Gestor",
        type: "select",
        options: refs.collaborators.map((c) => ({ value: c.id, label: c.name })),
      },
      { name: "sites", label: "Sites", type: "multiselect", span: 2, options: refs.sites.map((s) => ({ value: s.id, label: s.code || s.name })) },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: {
      name: "", company: null, registration: "", yellow_badge: "", job_title: null,
      email: "", phone: "", manager: null, sites: [], is_active: true,
    },
    rowLabel: (row: CollaboratorFull) => row.name,
  } as EntityConfig<CollaboratorFull>,
  {
    key: "responsibles",
    label: "Responsáveis",
    icon: "assignment_ind",
    singular: "Responsável",
    createLabel: "Novo Responsável",
    perms: modelPerms("core", "responsible"),
    api: registryApi.responsibles,
    columns: [
      { key: "name", label: "Nome" },
      { key: "company_name", label: "Empresa" },
      { key: "email", label: "E-mail" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "company", label: "Empresa", type: "select", required: true, options: companyOptions(refs) },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "text" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", company: null, email: "", phone: "", is_active: true },
    rowLabel: (row: ResponsibleFull) => row.name,
  } as EntityConfig<ResponsibleFull>,
  {
    key: "client-responsibles",
    label: "Responsáveis do Cliente",
    icon: "contact_page",
    singular: "Responsável do Cliente",
    createLabel: "Novo Responsável do Cliente",
    perms: modelPerms("core", "clientresponsible"),
    api: registryApi.clientResponsibles,
    columns: [
      { key: "name", label: "Nome" },
      { key: "client_name", label: "Cliente" },
      { key: "job_title", label: "Cargo" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "client", label: "Cliente", type: "select", required: true, options: refs.clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name })) },
      { name: "job_title", label: "Cargo", type: "text" },
      { name: "email", label: "E-mail", type: "email" },
      { name: "phone", label: "Telefone", type: "text" },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ],
    emptyValues: { name: "", client: null, job_title: "", email: "", phone: "", is_active: true },
    rowLabel: (row: ClientResponsibleFull) => row.name,
  } as EntityConfig<ClientResponsibleFull>,
  {
    key: "tasks",
    label: "Tarefas",
    icon: "task",
    singular: "Tarefa",
    createLabel: "Nova Tarefa",
    perms: modelPerms("core", "task"),
    api: registryApi.tasks,
    columns: [
      { key: "code", label: "Código" },
      { key: "name", label: "Nome" },
      { key: "estimated_hours", label: "Horas Estimadas" },
    ],
    fields: (refs) => [
      { name: "name", label: "Nome", type: "text", required: true },
      { name: "estimated_hours", label: "Horas Estimadas", type: "number" },
      {
        name: "project_types",
        label: "Tipos de Projeto",
        type: "multiselect",
        span: 2,
        options: refs.projectTypes.map((pt) => ({ value: pt.id, label: pt.name })),
      },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativa", span: 2 },
    ],
    emptyValues: { name: "", estimated_hours: null, project_types: [], description: "", is_active: true },
    rowLabel: (row: TaskFull) => row.name || row.code,
  } as EntityConfig<TaskFull>,
];
