import { apiClient } from "./client";
import type {
  ActivityType,
  AuditLogEntry,
  Category,
  ClientFull,
  Collaborator,
  CollaboratorFull,
  CollaboratorHours,
  Company,
  DailyUpdate,
  JobTitle,
  Me,
  Notification,
  OperationsBoard,
  OperationsReports,
  OperationsTimeline,
  Paginated,
  PlanningSummaryRow,
  Project,
  ProjectAttachment,
  ProjectDailyUpdate,
  ProjectItem,
  ProjectItemType,
  ProjectOccurrence,
  ProjectsPerformanceData,
  ProjectTask,
  ProjectTaskBulkPayload,
  ProjectTaskCreatePayload,
  ProjectType,
  RackPosition,
  ResponsibleFull,
  ScopeImport,
  ScopeImportConfirmResult,
  ScopeImportPayload,
  TechnicalPerformanceData,
  TechnicianPresence,
  UserOption,
  SiteFull,
  SiteMapData,
  TaskFull,
  WorkBlock,
} from "./types";

function crud<T extends { id: number }>(basePath: string) {
  return {
    list: (params?: Record<string, string>) =>
      apiClient.get<Paginated<T>>(`${basePath}/`, { params }).then((r) => r.data),
    get: (id: number) => apiClient.get<T>(`${basePath}/${id}/`).then((r) => r.data),
    create: (payload: Partial<T>) => apiClient.post<T>(`${basePath}/`, payload).then((r) => r.data),
    update: (id: number, payload: Partial<T>) => apiClient.patch<T>(`${basePath}/${id}/`, payload).then((r) => r.data),
    remove: (id: number) => apiClient.delete(`${basePath}/${id}/`),
    exportCsv: () => apiClient.get<Blob>(`${basePath}/export-csv/`, { responseType: "blob" }).then((r) => r.data),
    importCsv: (file: File) => {
      const form = new FormData();
      form.append("csv_file", file);
      return apiClient
        .post<{ created: number; errors: string[] }>(`${basePath}/import-csv/`, form, {
          headers: { "Content-Type": "multipart/form-data" },
        })
        .then((r) => r.data);
    },
  };
}

export const registryApi = {
  companies: crud<Company>("/registry/companies"),
  categories: crud<Category>("/registry/categories"),
  projectTypes: crud<ProjectType>("/registry/project-types"),
  jobTitles: crud<JobTitle>("/registry/job-titles"),
  sites: crud<SiteFull>("/registry/sites"),
  clients: crud<ClientFull>("/registry/clients"),
  responsibles: crud<ResponsibleFull>("/registry/responsibles"),
  collaborators: crud<CollaboratorFull>("/registry/collaborators"),
  tasks: crud<TaskFull>("/registry/tasks"),
  activityTypes: crud<ActivityType>("/registry/activity-types"),
  projectItemTypes: crud<ProjectItemType>("/registry/project-item-types"),
};

export const workBlocksApi = crud<WorkBlock>("/work-blocks");
export const projectItemsApi = crud<ProjectItem>("/project-items");

export const scopeImportsApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<ScopeImport>>("/scope-imports/", { params: { project: String(projectId) } }).then((r) => r.data),
  get: (id: number) => apiClient.get<ScopeImport>(`/scope-imports/${id}/`).then((r) => r.data),
  create: (projectId: number, rawText: string) =>
    apiClient.post<ScopeImport>("/scope-imports/", { project: projectId, raw_text: rawText }).then((r) => r.data),
  retry: (id: number) => apiClient.post<ScopeImport>(`/scope-imports/${id}/retry/`).then((r) => r.data),
  confirm: (id: number, reviewedPayload: ScopeImportPayload) =>
    apiClient.post<ScopeImportConfirmResult>(`/scope-imports/${id}/confirm/`, { reviewed_payload: reviewedPayload }).then((r) => r.data),
  discard: (id: number) => apiClient.post<ScopeImport>(`/scope-imports/${id}/discard/`).then((r) => r.data),
};

export const auditLogApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<AuditLogEntry>>("/audit-logs/", { params }).then((r) => r.data),
};

export const sitesMapApi = {
  mapData: () => apiClient.get<SiteMapData>("/registry/sites/map-data/").then((r) => r.data),
  regeocode: (id: number) => apiClient.post<SiteFull>(`/registry/sites/${id}/regeocode/`).then((r) => r.data),
  regeocodeBulk: (ids?: number[]) =>
    apiClient
      .post<{ updated: number; failed: number; skipped_manual: number }>("/registry/sites/regeocode-bulk/", ids ? { ids } : {})
      .then((r) => r.data),
};

export const bulkCreateApi = {
  projectTypes: (names: string[], extra: Record<string, unknown>) =>
    apiClient.post<{ created: number }>("/registry/project-types/bulk-create/", { names, ...extra }).then((r) => r.data),
  tasks: (names: string[], extra: Record<string, unknown>) =>
    apiClient.post<{ created: number }>("/registry/tasks/bulk-create/", { names, ...extra }).then((r) => r.data),
};

export interface Client {
  id: number;
  name: string;
  tax_id: string;
  email: string;
  phone: string;
}

export interface Site {
  id: number;
  name: string;
  code: string;
  city: string;
  state: string;
}

export const meApi = {
  get: () => apiClient.get<Me>("/me/").then((r) => r.data),
  changePassword: (old_password: string, new_password: string) =>
    apiClient.post<{ detail: string }>("/me/change-password/", { old_password, new_password }).then((r) => r.data),
};

export interface GlobalSearchResult {
  projects: { id: number; code: string; name: string; po: string; client: string; site: string }[];
  sites: { id: number; code: string; name: string; client: string; city: string }[];
  tasks: {
    id: number;
    task_name: string;
    project_id: number;
    project_name: string;
    project_code: string;
    status: string;
    status_display: string;
  }[];
}

export const searchApi = {
  search: (q: string) => apiClient.get<GlobalSearchResult>("/search/", { params: { q } }).then((r) => r.data),
};

export const projectsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<Project>>("/projects/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<Project>(`/projects/${id}/`).then((r) => r.data),
  create: (payload: Partial<Project>) => apiClient.post<Project>("/projects/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<Project>) =>
    apiClient.patch<Project>(`/projects/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/projects/${id}/`),
  tasks: (id: number) => apiClient.get<ProjectTask[]>(`/projects/${id}/tasks/`).then((r) => r.data),
  rackPositions: (id: number) => apiClient.get<RackPosition[]>(`/projects/${id}/rack-positions/`).then((r) => r.data),
  rackPositionsBulk: (id: number, text: string) =>
    apiClient
      .post<{ created: number; skipped: number }>(`/projects/${id}/rack-positions/bulk/`, { text })
      .then((r) => r.data),
  importTasks: (id: number) =>
    apiClient.post<{ created: number }>(`/projects/${id}/import-tasks/`).then((r) => r.data),
  tasksBulk: (id: number, payload: ProjectTaskBulkPayload) =>
    apiClient
      .post<{ updated?: number; created?: number; deleted?: number }>(`/projects/${id}/tasks/bulk/`, payload)
      .then((r) => r.data),
  createTasks: (id: number, payload: ProjectTaskCreatePayload) =>
    apiClient
      .post<{ created: number; skipped: number; tasks: ProjectTask[] }>(`/projects/${id}/tasks/create/`, payload)
      .then((r) => r.data),
  createCustomTasks: (id: number, names: string[]) =>
    apiClient
      .post<{ created: number; tasks: ProjectTask[] }>(`/projects/${id}/tasks/create-custom/`, { names })
      .then((r) => r.data),
  hoursByCollaborator: (id: number) =>
    apiClient.get<CollaboratorHours[]>(`/projects/${id}/hours-by-collaborator/`).then((r) => r.data),
  workBlocks: (id: number) => apiClient.get<WorkBlock[]>(`/projects/${id}/work-blocks/`).then((r) => r.data),
  items: (id: number, workBlockId?: number) =>
    apiClient
      .get<ProjectItem[]>(`/projects/${id}/items/`, { params: workBlockId ? { work_block: String(workBlockId) } : undefined })
      .then((r) => r.data),
  planningSummary: (id: number) =>
    apiClient.get<PlanningSummaryRow[]>(`/projects/${id}/planning-summary/`).then((r) => r.data),
};

export const rackPositionsApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<RackPosition>>("/rack-positions/", { params: { project: String(projectId) } }).then((r) => r.data),
  create: (payload: Partial<RackPosition>) =>
    apiClient.post<RackPosition>("/rack-positions/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<RackPosition>) =>
    apiClient.patch<RackPosition>(`/rack-positions/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/rack-positions/${id}/`),
};

export const projectTasksApi = {
  create: (payload: Partial<ProjectTask>) => apiClient.post<ProjectTask>("/project-tasks/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectTask>) =>
    apiClient.patch<ProjectTask>(`/project-tasks/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/project-tasks/${id}/`),
};

export const notificationsApi = {
  list: () => apiClient.get<Paginated<Notification>>("/notifications/").then((r) => r.data),
  unreadCount: () => apiClient.get<{ count: number }>("/notifications/unread_count/").then((r) => r.data),
  markRead: (id: number) => apiClient.post<Notification>(`/notifications/${id}/mark-read/`).then((r) => r.data),
  markAllRead: () => apiClient.post("/notifications/mark-all-read/"),
};

export const projectOccurrencesApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<ProjectOccurrence>>("/project-occurrences/", { params: { project: String(projectId) } }).then((r) => r.data),
  create: (payload: Partial<ProjectOccurrence>) =>
    apiClient.post<ProjectOccurrence>("/project-occurrences/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectOccurrence>) =>
    apiClient.patch<ProjectOccurrence>(`/project-occurrences/${id}/`, payload).then((r) => r.data),
  remove: (id: number) => apiClient.delete(`/project-occurrences/${id}/`),
};

export const projectAttachmentsApi = {
  list: (projectId: number) =>
    apiClient.get<Paginated<ProjectAttachment>>("/project-attachments/", { params: { project: String(projectId) } }).then((r) => r.data),
  upload: (projectId: number, file: File, description: string) => {
    const form = new FormData();
    form.append("project", String(projectId));
    form.append("file", file);
    if (description) form.append("description", description);
    return apiClient
      .post<ProjectAttachment>("/project-attachments/", form, { headers: { "Content-Type": "multipart/form-data" } })
      .then((r) => r.data);
  },
  remove: (id: number) => apiClient.delete(`/project-attachments/${id}/`),
  downloadUrl: (id: number) => `/project-attachments/${id}/download/`,
};

export const dashboardApi = {
  projects: (params?: Record<string, string>) =>
    apiClient.get<ProjectsPerformanceData>("/dashboard/projects/", { params }).then((r) => r.data),
  technical: (params?: Record<string, string>) =>
    apiClient.get<TechnicalPerformanceData>("/dashboard/technical/", { params }).then((r) => r.data),
};

export const clientsApi = {
  list: () => apiClient.get<Paginated<Client>>("/clients/").then((r) => r.data),
};

export const sitesApi = {
  list: () => apiClient.get<Paginated<Site>>("/sites/").then((r) => r.data),
};

export const collaboratorsApi = {
  list: () => apiClient.get<Paginated<Collaborator>>("/collaborators/").then((r) => r.data),
};

export const dailyUpdatesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<DailyUpdate>>("/daily-updates/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<DailyUpdate>(`/daily-updates/${id}/`).then((r) => r.data),
  create: (payload: Partial<DailyUpdate>) =>
    apiClient.post<DailyUpdate>("/daily-updates/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<DailyUpdate>) =>
    apiClient.put<DailyUpdate>(`/daily-updates/${id}/`, payload).then((r) => r.data),
  sendEmail: (id: number) =>
    apiClient.post<{ sent: string[]; skipped: string[] }>(`/daily-updates/${id}/send-email/`).then((r) => r.data),
  pdfPath: (id: number) => `/daily-updates/${id}/pdf/`,
  consolidatedPdfPath: (date: string) => `/daily-updates/pdf-consolidado/?date=${date}`,
};

export const projectUpdatesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<ProjectDailyUpdate>>("/project-updates/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<ProjectDailyUpdate>(`/project-updates/${id}/`).then((r) => r.data),
  create: (payload: { project: number; date: string; summary?: string }) =>
    apiClient.post<ProjectDailyUpdate>("/project-updates/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectDailyUpdate>) =>
    apiClient.patch<ProjectDailyUpdate>(`/project-updates/${id}/`, payload).then((r) => r.data),
  sendEmail: (id: number, payload?: { user_ids?: number[]; emails?: string[] }) =>
    apiClient
      .post<{ sent: string[]; skipped: string[]; detail?: string }>(`/project-updates/${id}/send-email/`, payload || {})
      .then((r) => r.data),
  pdfPath: (id: number) => `/project-updates/${id}/pdf/`,
};

export const usersApi = {
  options: () => apiClient.get<UserOption[]>("/user-options/").then((r) => r.data),
};

export const myTasksApi = {
  list: () => apiClient.get<Paginated<ProjectTask>>("/my-tasks/").then((r) => r.data),
  update: (id: number, payload: Partial<ProjectTask>) =>
    apiClient.patch<ProjectTask>(`/my-tasks/${id}/`, payload).then((r) => r.data),
};

export const presenceApi = {
  me: () => apiClient.get<TechnicianPresence>("/technician-presence/me/").then((r) => r.data),
  setStatus: (status: string) =>
    apiClient.post<TechnicianPresence>("/technician-presence/set-status/", { status }).then((r) => r.data),
};

export const operationsApi = {
  board: (siteId: number | "all") =>
    apiClient.get<OperationsBoard>("/operations/board/", { params: { site: String(siteId) } }).then((r) => r.data),
  dispatch: (taskId: number, collaboratorIds: number[]) =>
    apiClient
      .post<ProjectTask>(`/project-tasks/${taskId}/dispatch/`, { collaborator_ids: collaboratorIds })
      .then((r) => r.data),
  timeline: (siteId: number | "all", date?: string) =>
    apiClient
      .get<OperationsTimeline>("/operations/timeline/", { params: { site: String(siteId), ...(date ? { date } : {}) } })
      .then((r) => r.data),
  reports: (siteId: number | "all", dateFrom?: string, dateTo?: string) =>
    apiClient
      .get<OperationsReports>("/operations/reports/", {
        params: { site: String(siteId), ...(dateFrom ? { date_from: dateFrom } : {}), ...(dateTo ? { date_to: dateTo } : {}) },
      })
      .then((r) => r.data),
};
