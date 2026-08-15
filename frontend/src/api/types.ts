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
  client: number | null;
  client_name: string | null;
  site: number | null;
  site_name: string | null;
  category: number | null;
  category_name: string | null;
  project_type: number | null;
  responsible_cstr: number | null;
  responsible_client: number | null;
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
  company: number | null;
  company_name: string | null;
  name: string;
  code: string;
  address: string;
  city: string;
  state: string;
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

export interface ClientResponsibleFull {
  id: number;
  client: number | null;
  client_name: string | null;
  name: string;
  email: string;
  phone: string;
  job_title: string;
  is_active: boolean;
}

export interface ResponsibleFull {
  id: number;
  company: number | null;
  company_name: string | null;
  name: string;
  email: string;
  phone: string;
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
  task: number;
  task_name: string;
  collaborators: Collaborator[];
  status: string;
  status_display: string;
  order: number;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  estimated_hours: string | null;
  actual_hours: string | null;
  notes: string;
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
