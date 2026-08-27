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
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  estimated_hours: string | null;
  actual_hours: string | null;
  worked_hours: number;
  notes: string;
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
  collaborator_ids?: number[];
  rack_position_ids?: number[];
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
