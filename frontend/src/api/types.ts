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

export interface JobTitle {
  id: number;
  company: number | null;
  company_name: string | null;
  name: string;
  description: string;
  is_active: boolean;
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
  notes: string;
  activity_type: number | null;
  project_item: number | null;
  work_block: number | null; // somente leitura — sincronizado a partir de project_item.work_block
  quantity_planned: string | null;
  quantity_completed: string | null;
  unit: string;
  priority: string;
  sequence: number;
  complexity: string;
  instructions: string;
}

export interface WorkBlock {
  id: number;
  project: number;
  name: string;
  code: string;
  description: string;
  order: number;
}

export interface ProjectItem {
  id: number;
  project: number;
  work_block: number | null;
  work_block_name?: string;
  internal_code: string;
  item_type: number;
  item_type_name?: string;
  technology: string;
  fiber_count: number | null;
  connector_type_a: string;
  connector_type_b: string;
  part_number: string;
  length_meters: string | null;
  origin: string;
  destination: string;
  route: string;
  priority: string;
  complexity: string;
  metadata: Record<string, unknown>;
  status: "not_started" | "in_progress" | "completed" | "canceled";
  status_display: string;
  order: number;
  notes: string;
}

export interface ActivityType {
  id: number;
  name: string;
  code: string;
  description: string;
  default_unit: string;
  is_active: boolean;
  order: number;
}

export interface ProjectItemType {
  id: number;
  name: string;
  description: string;
  is_active: boolean;
  order: number;
}

export interface PlanningSummaryRow {
  work_block_id: number | null;
  work_block_name: string | null;
  activity_type_id: number | null;
  activity_type_name: string | null;
  quantity_planned: string;
  quantity_completed: string;
  task_count: number;
  completed_task_count: number;
}

export interface GenerationRuleStep {
  id: number;
  activity_type: number;
  activity_type_name: string;
  sequence: number;
}

export interface GenerationRule {
  id: number;
  technology: string;
  name: string;
  is_active: boolean;
  steps: GenerationRuleStep[];
}

export interface ScopeImportTaskDraft {
  activity_type_id: number | null;
  activity_type_name: string;
  activity_type_unmatched: boolean;
  quantity_planned: number | string | null;
  unit: string;
}

export interface ScopeImportItemDraft {
  internal_code: string;
  item_type_id: number | null;
  item_type_name: string;
  item_type_unmatched: boolean;
  technology: string;
  fiber_count: number | null;
  length_meters: number | string | null;
  origin: string;
  destination: string;
  route: string;
  priority: string;
  complexity: string;
  tasks: ScopeImportTaskDraft[];
}

export interface ScopeImportBlockDraft {
  name: string;
  items: ScopeImportItemDraft[];
}

export interface ScopeImportPayload {
  work_blocks: ScopeImportBlockDraft[];
}

export interface ScopeImport {
  id: number;
  project: number;
  raw_text: string;
  status: "draft" | "processing" | "ready" | "failed" | "confirmed" | "discarded";
  status_display: string;
  ai_provider: string;
  ai_model: string;
  ai_raw_response: ScopeImportPayload | null;
  reviewed_payload: ScopeImportPayload | null;
  error_message: string;
  requested_by: number | null;
  requested_by_name: string;
  reviewed_by: number | null;
  reviewed_by_name: string;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScopeImportConfirmResult {
  scope_import: ScopeImport;
  counts: { work_blocks: number; items: number; tasks: number };
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
}

export interface OperationsBoardAssignee {
  collaborator_id: number;
  name: string;
  queue_order: number;
}

export interface OperationsBoardBlockingTask {
  task_id: number;
  name: string;
}

export interface OperationsBoardTask {
  id: number;
  name: string;
  project_name: string;
  project_code: string;
  site_name: string;
  estimated_hours: string | null;
  assignees: OperationsBoardAssignee[];
  blocked_by: OperationsBoardBlockingTask[];
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

export interface ReportsStats {
  avg_utilization_pct: number;
  productive_hours: number;
  completed_count: number;
  today_productive_hours: number;
  today_unproductive_hours: number;
  completed_this_month: number;
}

export interface ReportsTechnician {
  id: number;
  name: string;
  site_name: string;
  worked_hours: number;
  completed_count: number;
  journey_hours: number;
  utilization_pct: number | null;
}

export interface ReportsActivity {
  name: string;
  executions: number;
  avg_hours: number;
  best_hours: number;
}

export interface ReportsTechnicianToday {
  id: number;
  name: string;
  site_name: string;
  journey_hours: number;
  active_hours: number;
  available_hours: number;
  break_hours: number;
  utilization_pct: number | null;
}

export interface ReportsUnproductiveReason {
  status: string;
  status_display: string;
  hours: number;
}

export interface ReportsLogEntry {
  at: string;
  name: string;
  text: string;
}

export interface OperationsReports {
  date_from: string;
  date_to: string;
  stats: ReportsStats;
  technicians: ReportsTechnician[];
  activities: ReportsActivity[];
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

export interface ActivityProductivityRow {
  activity_type_id: number;
  activity_type_name: string;
  technology: string;
  complexity: string;
  complexity_display: string;
  sample_count: number;
  avg_hours_per_unit: number;
  total_hours: number;
  total_quantity: string;
}

export interface ActivityProductivityData {
  rows: ActivityProductivityRow[];
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
  collaborator_ids?: number[];
  rack_position_ids?: number[];
  work_block?: number | null;
  activity_type?: number | null;
  quantity_planned?: number | string | null;
  quantity_completed?: number | string | null;
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
  registration: string;
  email: string;
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
