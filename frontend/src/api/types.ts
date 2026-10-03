export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface Me {
  id: number;
  username: string;
  full_name: string;
  email: string;
  company_id: number | null;
  is_superuser: boolean;
  permissions: string[];
  has_collaborator_profile: boolean;
  must_change_password: boolean;
}

export interface Project {
  id: number;
  code: string;
  company: number | null;
  name: string;
  po: string;
  link_count: number;
  has_rack_positions: boolean;
  client: number | null;
  client_name: string | null;
  site: number | null;
  site_name: string | null;
  category: number | null;
  category_name: string | null;
  project_type: number | null;
  responsible_cstr: number | null;
  responsible_cstr_name: string | null;
  responsible_client: number | null;
  responsible_client_name: string | null;
  description: string;
  notes: string;
  status: string;
  status_display: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  is_active: boolean;
  total_tasks: number;
  completed_tasks: number;
  worked_hours: number;
  historical_hours: number;
  progress_percent: number;
}

export interface RackPosition {
  id: number;
  project: number;
  position: string;
  dh: string;
  links: number;
  utp: number;
}

export interface SiteMapProject {
  id: number;
  code: string;
  name: string;
  client: string;
}

export interface SiteMapPoint {
  id: number;
  name: string;
  client: string;
  address: string;
  lat: number;
  lng: number;
  projects: SiteMapProject[];
}

export interface SiteMapData {
  points: SiteMapPoint[];
  points_count: number;
  without_coords: number;
}

export interface AuditLogEntry {
  id: number;
  created_at: string;
  actor: number | null;
  actor_name: string | null;
  app_label: string;
  model_name: string;
  object_pk: string;
  object_repr: string;
  action: string;
  action_display: string;
  field_name: string;
  old_value: string;
  new_value: string;
  origin: string;
  path: string;
  ip_address: string | null;
}

/* ---------- Cadastros Gerais ---------- */

export interface Company {
  id: number;
  legal_name: string;
  trade_name: string;
  tax_id: string;
  email: string;
  phone: string;
  is_active: boolean;
}

export interface Category {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
}

export interface ProjectType {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
}

export interface CableFamily {
  id: number;
  code: string;
  name: string;
  medium: "FIBER" | "COPPER";
  fiber_count: number | null;
  connector_a: string;
  connector_b: string;
  cable_category: string;
  preterminated: boolean;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface CableAlias {
  id: number;
  cable_family: number | null;
  cable_family_code: string;
  cable_family_name: string;
  alias: string;
  normalized_alias: string;
  alias_type: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface CableSpec {
  id: number;
  cable_family: number | null;
  cable_family_code: string;
  cable_family_name: string;
  code: string;
  name: string;
  manufacturer: string;
  part_number: string;
  fiber_type: string;
  jacket_color: string;
  polarity: string;
  connector_a: string;
  connector_b: string;
  fiber_count: number | null;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface CertificationType {
  id: number;
  code: string;
  name: string;
  medium: "FIBER" | "COPPER" | "GENERAL" | "";
  method: string;
  requires_report: boolean;
  requires_attachment: boolean;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface Activity {
  id: number;
  code: string;
  name: string;
  category: string;
  execution_type: string;
  default_unit: string;
  measurable: boolean;
  requires_quantity: boolean;
  requires_evidence: boolean;
  requires_certification: boolean;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface Network {
  id: number;
  code: string;
  name: string;
  domain: string;
  medium: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface Workstream {
  id: number;
  code: string;
  name: string;
  category: string;
  default_medium: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface Path {
  id: number;
  code: string;
  name: string;
  path_group: string;
  path_type: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

/** Site de Cadastros Mestres (Infraestrutura) — nível mais alto da
 * topologia física de cabeamento (ex: GRU65). Não confundir com `SiteFull`
 * (site do Cliente, usado em Cadastros Gerais) — conceitos diferentes. */
export interface MasterDataSite {
  id: number;
  code: string;
  name: string;
  city: string;
  state: string;
  country: string;
  site_type: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface Location {
  id: number;
  site: number | null;
  site_code: string;
  site_name: string;
  code: string;
  canonical_address: string;
  area: string;
  room: string;
  row: string;
  rack: string;
  position: string;
  ru: string;
  location_type: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface DeviceType {
  id: number;
  code: string;
  name: string;
  category: string;
  default_medium: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface TaskTemplateRuleSimulateRequest {
  cable_family?: number | null;
  cable_spec?: number | null;
  network?: number | null;
  workstream?: number | null;
  medium?: string;
  preterminated?: boolean | null;
}

export interface TaskTemplateRuleMatchCheck {
  criterion: string;
  result: "MATCH" | "IGNORED" | "MISMATCH";
  detail: string;
}

export interface TaskTemplateRuleMatchRuleSummary {
  id: number;
  code: string;
  name: string;
  priority: number;
  specificity_score: number;
  task_template_id: number;
  task_template_code: string;
  task_template_name: string;
}

export interface TaskTemplateRuleMatch {
  rule: TaskTemplateRuleMatchRuleSummary;
  checks: TaskTemplateRuleMatchCheck[];
}

export interface TaskTemplateRuleSimulateStep {
  step_order: number;
  activity_code: string;
  activity_name: string;
  effective_name: string;
  required: boolean;
  repeatable: boolean;
  quantity_source: string;
  unit_override: string;
}

export interface TaskTemplateRuleSimulateTemplate {
  id: number;
  code: string;
  name: string;
  category: string;
  medium: string;
}

export interface TaskTemplateRuleSimulateResult {
  selected_rule: TaskTemplateRuleMatchRuleSummary | null;
  selected_template: TaskTemplateRuleSimulateTemplate | null;
  steps: TaskTemplateRuleSimulateStep[];
  matches: TaskTemplateRuleMatch[];
  derived_fields: Record<string, { value: string; source: string }>;
  warnings: string[];
}

export interface ScopeItemResolutionResult extends TaskTemplateRuleSimulateResult {
  rule_resolution_status: "NOT_RESOLVED" | "RESOLVED" | "NO_MATCH" | "CONFLICT" | "REVIEW_REQUIRED";
  conflict_detail?: string;
}

export interface ScopeItem {
  id: number;
  code: string;
  name: string;
  item_type: string;
  cable_family: number | null;
  cable_family_code: string | null;
  cable_family_name: string | null;
  cable_spec: number | null;
  cable_spec_code: string | null;
  cable_spec_part_number: string | null;
  network: number | null;
  network_code: string | null;
  network_name: string | null;
  workstream: number | null;
  workstream_code: string | null;
  workstream_name: string | null;
  path: number | null;
  path_code: string | null;
  path_name: string | null;
  quantity: number;
  unit: string;
  length_type: string;
  length_m: string | null;
  medium: string;
  preterminated: boolean | null;
  color: string;
  fiber_count: number | null;
  raw_text: string;
  source_type: string;
  source_reference: string;
  confidence_score: string | null;
  requires_review: boolean;
  description: string;
  active: boolean;
  normalization_metadata: Record<string, { source: string; derived: boolean }>;
  resolved_rule_code: string | null;
  resolved_rule_name: string | null;
  resolved_template_code: string | null;
  resolved_template_name: string | null;
  rule_resolution_status: string;
  expansion_mode: string;
  tasks_outdated: boolean;
  /** Rotas adicionais (ScopeItemPath ativos) — lista de ids de Path, não
   * confundir com o campo `path` singular acima (mantido por
   * compatibilidade). */
  paths: number[];
  /** Derivado no backend (não persistido) — resume onde este item está no
   * fluxo SOW -> ScopeItem -> resolução -> Tarefas Geradas. Ver
   * ScopeItemCrudSerializer.get_operational_status. */
  operational_status: "AWAITING_RESOLUTION" | "READY_TO_GENERATE" | "TASKS_GENERATED" | "REQUIRES_REVIEW" | "NO_MATCH";
  has_generated_tasks: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface GeneratedTask {
  id: number;
  code: string;
  scope_item_code: string;
  scope_item_raw_text: string;
  scope_item_source_reference: string;
  task_template_code: string;
  task_template_name: string;
  activity_code: string;
  activity_name: string;
  path_code: string | null;
  path_name: string | null;
  expansion_key: string;
  step_order: number;
  name: string;
  quantity: string | null;
  unit: string;
  required: boolean;
  repeatable: boolean;
  generation_source: string;
  status: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface GeneratedTaskDependency {
  id: number;
  predecessor_task: number;
  predecessor_task_code: string;
  predecessor_task_name: string;
  successor_task: number;
  successor_task_code: string;
  successor_task_name: string;
  dependency_type: string;
  lag_value: string;
  lag_unit: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ScopeItemGenerateTasksResult {
  scope_item_id: number;
  scope_item_code: string;
  resolved_rule_code: string | null;
  resolved_template_code: string | null;
  created_count: number;
  existing_count: number;
  created_tasks: GeneratedTask[];
  existing_tasks: GeneratedTask[];
  tasks: GeneratedTask[];
  created_dependencies: GeneratedTaskDependency[];
  existing_dependencies: GeneratedTaskDependency[];
  warnings: string[];
}

export interface SowWarning {
  code: string;
  field: string;
  message: string;
  critical: boolean;
}

export interface SowImport {
  id: number;
  code: string;
  title: string;
  source_type: string;
  source_file?: File | null;
  source_file_url: string | null;
  source_text: string;
  original_filename: string;
  mime_type: string;
  status: string;
  parser_version: string;
  ai_provider: string;
  ai_model: string;
  ai_mode: string;
  processing_started_at: string | null;
  processing_finished_at: string | null;
  total_items_detected: number;
  total_items_approved: number;
  total_items_rejected: number;
  total_warnings: number;
  error_message: string;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface SowParsedItem {
  id: number;
  sow_import: number;
  sow_import_code: string;
  sequence: number;
  raw_text: string;
  item_type: string;
  suggested_cable_family: number | null;
  suggested_cable_family_code: string | null;
  suggested_cable_family_name: string | null;
  suggested_cable_spec: number | null;
  suggested_cable_spec_code: string | null;
  suggested_network: number | null;
  suggested_network_code: string | null;
  suggested_workstream: number | null;
  suggested_workstream_code: string | null;
  suggested_paths: number[];
  suggested_path_codes: string[];
  quantity: number | null;
  unit: string;
  length_type: string;
  length_m: string | null;
  medium: string;
  preterminated: boolean | null;
  color: string;
  fiber_count: number | null;
  confidence_score: string | null;
  confidence_band: "HIGH" | "MEDIUM" | "LOW" | null;
  review_status: string;
  requires_review: boolean;
  warnings: SowWarning[];
  ai_raw_payload: Record<string, unknown>;
  normalization_metadata: Record<string, unknown>;
  approved_scope_item_id: number | null;
  approved_scope_item_code: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SowApproveSelectedResult {
  approved: { item_id: number; scope_item_code: string }[];
  errors: { item_id: number; detail: string }[];
  sow_import: SowImport;
}

export interface SowRejectSelectedResult {
  rejected: number[];
  errors: { item_id: number; detail: string }[];
  sow_import: SowImport;
}

export interface AiStatus {
  provider: string;
  configured: boolean;
  configured_model: string | null;
  base_url: string;
}

export interface AiTestResult {
  success: boolean;
  provider?: string;
  configured_model?: string | null;
  resolved_model?: string;
  latency_ms?: number;
  retries?: number;
  http_status?: number;
  usage?: Record<string, unknown>;
  structured_json_ok?: boolean;
  error_code?: string;
  detail?: string;
}

export interface SowApproveItemResult {
  scope_item_id: number;
  scope_item_code: string;
  item: SowParsedItem;
}

export interface TaskTemplate {
  id: number;
  code: string;
  name: string;
  category: string;
  medium: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface TaskTemplateStep {
  id: number;
  task_template: number | null;
  task_template_code: string;
  task_template_name: string;
  activity: number | null;
  activity_code: string;
  activity_name: string;
  effective_name: string;
  step_order: number | null;
  name_override: string;
  required: boolean;
  repeatable: boolean;
  quantity_source: string;
  unit_override: string;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface TaskTemplateRule {
  id: number;
  code: string;
  name: string;
  task_template: number | null;
  task_template_code: string;
  task_template_name: string;
  cable_family: number | null;
  cable_family_code: string | null;
  cable_family_name: string | null;
  cable_spec: number | null;
  cable_spec_code: string | null;
  cable_spec_part_number: string | null;
  network: number | null;
  network_code: string | null;
  network_name: string | null;
  workstream: number | null;
  workstream_code: string | null;
  workstream_name: string | null;
  medium: string;
  preterminated: boolean | null;
  priority: number;
  specificity_score: number;
  description: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  created_by_name: string | null;
  updated_by_name: string | null;
}

export interface JobTitle {
  id: number;
  company: number | null;
  company_name: string | null;
  name: string;
  description: string;
  is_active: boolean;
}

export interface Region {
  id: number;
  code: string;
  name: string;
  country: string;
  country_display: string;
}

export interface SiteFull {
  id: number;
  client: number | null;
  client_name: string | null;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
  region: number | null;
  region_name: string | null;
  region_code: string | null;
  country: string | null;
  manual_coordinates: boolean;
  latitude: string | null;
  longitude: string | null;
  is_active: boolean;
}

export interface ClientFull {
  id: number;
  company: number | null;
  company_name: string | null;
  person_type: string;
  legal_name: string;
  trade_name: string;
  tax_id: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  notes: string;
  is_active: boolean;
}

export type ResponsibleKind = "cstr" | "client";

export interface ResponsibleFull {
  id: number;
  kind: ResponsibleKind;
  company: number | null;
  company_name: string | null;
  client: number | null;
  client_name: string | null;
  name: string;
  email: string;
  phone: string;
  job_title: string;
  is_active: boolean;
}

export interface CollaboratorFull {
  id: number;
  company: number | null;
  company_name: string | null;
  name: string;
  registration: string;
  yellow_badge: string;
  job_title: number | null;
  job_title_name: string | null;
  email: string;
  phone: string;
  sites: number[];
  manager: number | null;
  manager_name: string | null;
  is_active: boolean;
}

export interface TaskFull {
  id: number;
  code: string;
  name: string;
  description: string;
  estimated_hours: string | null;
  project_types: number[];
  project_type_names: string[];
  is_active: boolean;
}

export interface ProjectTask {
  id: number;
  project: number;
  project_name?: string;
  project_code?: string;
  task: number | null;
  task_name: string;
  custom_name: string;
  rack_positions: number[];
  rack_position_labels: string[];
  collaborators: Collaborator[];
  collaborator_ids?: number[];
  status: string;
  status_display: string;
  priority: string;
  priority_display: string;
  order: number;
  queue_order: number | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  estimated_hours: string | null;
  actual_hours: string | null;
  worked_hours: number;
  completion_outcome: string;
  quantity_done: string;
  quantity_planned: string | null;
  unit: string;
  requires_evidence: boolean;
  requires_qaqc: boolean;
  instructions: string;
  notes: string;
  /** Rastreabilidade até o SOW/ScopeItem/Template de origem — ver
   * ProjectTask.generated_task (master_data.GeneratedTask). "MANUAL"
   * quando a tarefa não veio do Plano do Projeto. */
  origin: string;
  generated_task: number | null;
  generated_task_code: string | null;
  scope_item_code: string | null;
  sow_import_code: string | null;
  task_template_code: string | null;
  activity_code: string | null;
  path_code: string | null;
  expansion_key: string | null;
  step_order: number | null;
}

export interface TechnicianPresence {
  id: number;
  collaborator: number;
  date: string;
  status: "not_started" | "available" | "in_progress" | "lunch" | "personal" | "site_blocked" | "awaiting_release" | "off_duty";
  status_display: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

export interface StatusEvent {
  status: string;
  status_display: string;
  changed_at: string;
}

export interface PairPartner {
  id: number;
  name: string;
}

export interface TechnicianAbsence {
  id: number;
  collaborator: number;
  collaborator_name: string;
  date_from: string;
  date_to: string;
  reason: string;
  created_by: number | null;
  created_at: string;
}

export interface OperationsBoardCurrentTask {
  id: number;
  name: string;
  project_name: string;
  status: string;
  actual_start: string | null;
}

export interface OperationsBoardQueueItem {
  task_id: number;
  task_name: string;
  project_name: string;
  queue_order: number;
}

export interface OperationsBoardTechnician {
  id: number;
  name: string;
  site_name: string;
  presence_status: string;
  presence_status_display: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
  current_tasks: OperationsBoardCurrentTask[];
  queue: OperationsBoardQueueItem[];
  status_events: StatusEvent[];
  pair_partner: PairPartner | null;
  on_leave: boolean;
  leave_until: string | null;
}

export interface OperationsBoardAssignee {
  collaborator_id: number;
  name: string;
  queue_order: number;
}

export interface OperationsBoardTask {
  id: number;
  name: string;
  project_name: string;
  project_code: string;
  site_name: string;
  estimated_hours: string | null;
  assignees: OperationsBoardAssignee[];
}

export interface OperationsBoardStats {
  planned: number;
  active: number;
  completed: number;
  pending: number;
  technicians_on_site: number;
  technicians_absent: number;
  progress_pct: number;
}

export interface OperationsBoard {
  technicians: OperationsBoardTechnician[];
  pool: OperationsBoardTask[];
  stats: OperationsBoardStats;
}

export interface TimelineBlock {
  id: number;
  name: string;
  project_name: string;
  status: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  estimated_hours: string | null;
}

export interface TimelineTechnician {
  id: number;
  name: string;
  site_name: string;
  blocks: TimelineBlock[];
  queue: OperationsBoardQueueItem[];
  status_events: StatusEvent[];
  pair_partner: PairPartner | null;
}

export interface OperationsTimeline {
  date: string | null;
  is_today: boolean;
  technicians: TimelineTechnician[];
}

/** Faixa de utilização (RN-08). "suspect" = acima de 100% (dado a revisar). */
export type UtilizationBand = "low" | "attention" | "normal" | "suspect";

export interface ReportsStats {
  period_completed_count: number;
  tracked_completed_count: number;
  tracking_rate_pct: number | null;
  man_hours_total: number;
  productive_hours_total: number;
  journey_hours_total: number;
  utilization_pct: number | null;
  utilization_band: UtilizationBand | null;
  external_block_hours: number;
  internal_idle_hours: number;
  incomplete_days: number;
  internal_idle_limit_hours: number;
  technicians_over_idle_limit: number;
  // Campos v1 (legados) — mantidos pelo backend durante a transição.
  avg_utilization_pct?: number;
  productive_hours?: number;
  completed_count?: number;
  today_productive_hours?: number;
  today_unproductive_hours?: number;
  completed_this_month?: number;
}

export interface ReportsToday {
  technicians_checked_in: number;
  productive_hours_total: number;
  productive_hours_avg_per_tech: number | null;
  productive_target_hours: number;
  external_block_hours: number;
  internal_idle_hours: number;
  internal_idle_limit_hours: number;
  technicians_over_idle_limit: number;
}

export interface ReportsTechnician {
  id: number;
  name: string;
  site_name: string;
  productive_hours: number;
  /** @deprecated v1 — usar productive_hours. */
  worked_hours?: number;
  man_hours: number;
  journey_hours: number;
  utilization_pct: number | null;
  utilization_band: UtilizationBand | null;
  completed_count: number;
  untracked_count: number;
  tracking_rate_pct: number | null;
  external_block_hours: number;
  internal_idle_hours: number;
  internal_idle_avg_per_day: number | null;
  idle_limit_exceeded: boolean;
  incomplete_days: number;
}

/** @deprecated v1 — usar ReportsActivityProductivity. */
export interface ReportsActivity {
  name: string;
  executions: number;
  avg_hours: number;
  best_hours: number;
  ignored_count?: number;
}

export interface ReportsDistribution {
  median: number;
  p25: number;
  p75: number;
}

export interface ReportsActivityProductivity {
  activity_code: string;
  activity_name: string;
  cable_family_code: string | null;
  cable_family_name: string | null;
  unit: string;
  executions_total: number;
  executions_used: number;
  excluded: { untracked: number; partial_or_blocked: number; no_quantity: number };
  sufficient_sample: boolean;
  median_man_hours: number | null;
  median_duration_hours: number | null;
  avg_crew_size: number | null;
  total_quantity: number;
  hh_per_unit: ReportsDistribution | null;
  hh_per_meter: (ReportsDistribution & { total_meters: number }) | null;
}

export interface ReportsTechnicianToday {
  id: number;
  name: string;
  site_name: string;
  journey_hours: number;
  active_hours: number;
  available_hours: number;
  internal_idle_hours: number;
  idle_limit_exceeded: boolean;
  break_hours: number;
  external_block_hours: number;
  /** @deprecated v1 — igual a external_block_hours. */
  unproductive_hours?: number;
  utilization_pct: number | null;
  utilization_band: UtilizationBand | null;
}

export interface ReportsUnproductiveReason {
  status: string;
  status_display: string;
  category: "external" | "internal";
  hours: number;
}

export type ReportsLogType = "dispatch" | "start" | "complete" | "pause" | "available" | "checkin" | "status";

export interface ReportsLogEntry {
  at: string;
  name: string;
  type: ReportsLogType;
  text: string;
}

export interface OperationsReports {
  date_from: string;
  date_to: string;
  stats: ReportsStats;
  today: ReportsToday;
  technicians: ReportsTechnician[];
  activity_productivity: ReportsActivityProductivity[];
  activity_excluded_no_catalog: number;
  /** @deprecated v1 — usar activity_productivity. */
  activities?: ReportsActivity[];
  today_technicians: ReportsTechnicianToday[];
  unproductive_by_reason: ReportsUnproductiveReason[];
  log_entries: ReportsLogEntry[];
}

export interface ProjectOccurrence {
  id: number;
  project: number;
  title: string;
  description: string;
  responsible: number | null;
  responsible_name: string | null;
  severity: string;
  severity_display: string;
  status: string;
  status_display: string;
  occurred_at: string;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAttachment {
  id: number;
  project: number;
  file: string;
  file_name: string;
  file_size: number | null;
  description: string;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface ProjectPerformanceRow {
  id: number;
  code: string;
  name: string;
  status: string;
  status_display: string;
  company: string | null;
  client: string | null;
  total_tasks: number;
  completed_tasks: number;
  progress_percent: number;
  worked_hours: number;
  link_count: number;
  planned_end: string | null;
  is_overdue: boolean;
}

export interface ProjectsPerformanceData {
  summary: {
    total_projects: number;
    overdue_projects: number;
    avg_progress_percent: number;
    total_worked_hours: number;
    total_links: number;
  };
  by_status: { status: string; status_display: string; count: number }[];
  top_projects_by_hours: ProjectPerformanceRow[];
  projects: ProjectPerformanceRow[];
}

export interface CollaboratorPerformanceRow {
  collaborator_id: number;
  name: string;
  registration: string;
  job_title: string | null;
  company: string | null;
  tasks_total: number;
  tasks_completed: number;
  hours_worked: number;
  links_executed: number;
}

export interface TechnicalPerformanceData {
  summary: {
    total_collaborators: number;
    total_tasks_completed: number;
    total_hours_worked: number;
    total_links_executed: number;
  };
  collaborators: CollaboratorPerformanceRow[];
}

export interface UserOption {
  id: number;
  name: string;
  email: string;
}

export interface Notification {
  id: number;
  title: string;
  message: string;
  url: string;
  project_id: number | null;
  project_code: string;
  is_read: boolean;
  created_at: string;
}

export interface CollaboratorHours {
  collaborator_id: number;
  collaborator_name: string;
  hours: number;
}

export interface ProjectTaskBulkPayload {
  action: "update" | "delete" | "add";
  task_ids?: number[];
  add_task_ids?: number[];
  status?: string;
  planned_start?: string | null;
  planned_end?: string | null;
  estimated_hours?: number | string | null;
  priority?: string;
  collaborator_ids?: number[];
  rack_position_ids?: number[];
}

export interface ProjectPlanScopeItem {
  id: number;
  code: string;
  raw_text: string;
  rule_resolution_status: string;
  resolved_template_code: string | null;
  requires_review: boolean;
  generated_tasks_count: number;
  project_tasks_existing_count: number;
}

export interface ProjectPlan {
  project: { id: number; code: string; name: string };
  sow_import: { id: number; code: string; title: string } | null;
  scope_items: ProjectPlanScopeItem[];
  totals: {
    scope_items_total: number;
    scope_items_ready: number;
    scope_items_pending_resolution: number;
    generated_tasks_total: number;
    project_tasks_to_create: number;
    project_tasks_existing: number;
    paths_involved: string[];
    warnings: string[];
  };
}

export interface ProjectPlanCreateResult {
  project_id: number;
  project_name: string;
  created_count: number;
  existing_count: number;
  created_tasks: ProjectTask[];
  existing_tasks: ProjectTask[];
}

export interface ProjectTaskCreatePayload {
  task: number;
  rack_position_ids?: number[];
  status?: string;
  planned_start?: string | null;
  planned_end?: string | null;
  estimated_hours?: number | string | null;
  collaborator_ids?: number[];
  notes?: string;
}

export interface Collaborator {
  id: number;
  name: string;
  registration?: string;
  email?: string;
  is_active: boolean;
}

export interface DailyUpdateAllocation {
  id?: number;
  project: number;
  project_name?: string;
  collaborators?: Collaborator[];
  collaborator_ids: number[];
}

export interface DailyUpdate {
  id: number;
  allocation_date: string;
  description: string;
  created_by: number | null;
  created_by_name: string | null;
  allocations: DailyUpdateAllocation[];
  created_at: string;
  updated_at: string;
}

export interface ProjectDailyUpdate {
  id: number;
  project: number;
  project_name: string;
  project_code: string;
  client_name: string | null;
  date: string;
  collaborators: Collaborator[];
  collaborator_ids: number[];
  completion_percent: number;
  activities_text: string;
  certification_done: boolean;
  project_finished: boolean;
  summary: string;
  preview: string | null;
  is_sent: boolean;
  sent_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Painel de Gestão de Sites (GET /api/dashboard/sites/)
// ---------------------------------------------------------------------------

export type SitesPanelGroupBy = "site" | "region" | "client" | "responsible";
export type SitesPanelHealth = "late" | "risk" | "ok" | "no_data";
export type SitesPanelTechCategory = "executing" | "unproductive" | "break" | "off_duty" | "on_leave" | "no_checkin";

export interface SitesPanelTechCounts {
  total: number;
  present: number;
  executing: number;
  unproductive: number;
  break: number;
  off_duty: number;
  on_leave: number;
  no_checkin: number;
  no_dispatch: number;
}

export interface SitesPanelReason {
  level: "late" | "risk" | "no_data";
  code: string;
  text: string;
}

export interface SitesPanelProject {
  id: number;
  code: string;
  name: string;
  status: string;
  status_display: string;
  group_key: string;
  group_label: string;
  site: { id: number; name: string; code: string } | null;
  region: { id: number; name: string; country: string } | null;
  client: { id: number; name: string } | null;
  responsible_cstr: { id: number; name: string } | null;
  project_type: string;
  planned_start: string | null;
  planned_end: string | null;
  real_pct: number | null;
  planned_pct: number | null;
  deviation_pp: number | null;
  tasks_total: number;
  tasks_completed: number;
  tasks_overdue: number;
  health: SitesPanelHealth;
  reasons: SitesPanelReason[];
  occurrences_open: number;
  occurrences_severe: number;
  update_status: "sent" | "draft" | "missing" | null;
  trend: { date: string; percent: number }[];
  technicians_today: { id: number; name: string; category: SitesPanelTechCategory; status_display: string }[];
}

export interface SitesPanelGroup {
  key: string;
  label: string;
  sublabel: string;
  health: SitesPanelHealth;
  projects: { in_progress: number; paused: number; planning: number; finished: number };
  alerts: { late: number; risk: number; no_data: number };
  technicians: SitesPanelTechCounts | null;
  occurrences_open: number;
  updates_pending: number;
  responsibles: string[];
  project_ids: number[];
}

export interface SitesPanelSitePoint {
  id: number;
  label: string;
  lat: number;
  lng: number;
  region: string;
  health: SitesPanelHealth;
  in_execution: number;
  planning: number;
  late: number;
  risk: number;
  technicians_present: number;
  technicians_total: number;
}

export interface SitesPanelException {
  level: "late" | "risk" | "info" | "neutral";
  kind: "deadline" | "team" | "client" | "mobilization";
  title: string;
  detail: string;
  action: { type: "project" | "operations" | "updates"; project_id?: number };
}

export interface SitesPanelData {
  date: string;
  group_by: SitesPanelGroupBy;
  status_filters: string[];
  include_technicians: boolean;
  summary: {
    in_progress: number;
    paused: number;
    planning: number;
    finished: number;
    starting_soon: number;
    late: number;
    risk: number;
    no_data: number;
    groups_with_late: number;
    start_late: number;
    occurrences_open: number;
    updates_pending: number;
    technicians: SitesPanelTechCounts | null;
    data_quality: {
      sites_without_region: number;
      projects_without_end: number;
      projects_without_site: number;
      executing_without_tasks: number;
      technicians_without_job_title: number | null;
      total: number;
    };
  };
  groups: SitesPanelGroup[];
  projects: SitesPanelProject[];
  sites: SitesPanelSitePoint[];
  unplaced_technicians: unknown[];
  exceptions: SitesPanelException[];
}
