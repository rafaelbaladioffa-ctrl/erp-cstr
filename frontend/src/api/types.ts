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
  name: string;
  po: string;
  client: number | null;
  client_name: string | null;
  site: number | null;
  site_name: string | null;
  status: string;
  status_display: string;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
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
