import { apiClient } from "./client";
import type {
  Category,
  ClientFull,
  ClientResponsibleFull,
  Collaborator,
  CollaboratorFull,
  Company,
  DailyUpdate,
  JobTitle,
  Me,
  Paginated,
  Project,
  ProjectDailyUpdate,
  ProjectTask,
  ProjectType,
  ResponsibleFull,
  SiteFull,
  TaskFull,
} from "./types";

function crud<T extends { id: number }>(basePath: string) {
  return {
    list: (params?: Record<string, string>) =>
      apiClient.get<Paginated<T>>(`${basePath}/`, { params }).then((r) => r.data),
    get: (id: number) => apiClient.get<T>(`${basePath}/${id}/`).then((r) => r.data),
    create: (payload: Partial<T>) => apiClient.post<T>(`${basePath}/`, payload).then((r) => r.data),
    update: (id: number, payload: Partial<T>) => apiClient.patch<T>(`${basePath}/${id}/`, payload).then((r) => r.data),
    remove: (id: number) => apiClient.delete(`${basePath}/${id}/`),
  };
}

export const registryApi = {
  companies: crud<Company>("/registry/companies"),
  categories: crud<Category>("/registry/categories"),
  projectTypes: crud<ProjectType>("/registry/project-types"),
  jobTitles: crud<JobTitle>("/registry/job-titles"),
  sites: crud<SiteFull>("/registry/sites"),
  clients: crud<ClientFull>("/registry/clients"),
  clientResponsibles: crud<ClientResponsibleFull>("/registry/client-responsibles"),
  responsibles: crud<ResponsibleFull>("/registry/responsibles"),
  collaborators: crud<CollaboratorFull>("/registry/collaborators"),
  tasks: crud<TaskFull>("/registry/tasks"),
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
};

export const projectsApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<Project>>("/projects/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<Project>(`/projects/${id}/`).then((r) => r.data),
  create: (payload: Partial<Project>) => apiClient.post<Project>("/projects/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<Project>) =>
    apiClient.patch<Project>(`/projects/${id}/`, payload).then((r) => r.data),
  tasks: (id: number) => apiClient.get<ProjectTask[]>(`/projects/${id}/tasks/`).then((r) => r.data),
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
  pdfUrl: (id: number) => `${apiClient.defaults.baseURL}/daily-updates/${id}/pdf/`,
};

export const projectUpdatesApi = {
  list: (params?: Record<string, string>) =>
    apiClient.get<Paginated<ProjectDailyUpdate>>("/project-updates/", { params }).then((r) => r.data),
  get: (id: number) => apiClient.get<ProjectDailyUpdate>(`/project-updates/${id}/`).then((r) => r.data),
  create: (payload: { project: number; date: string; summary?: string }) =>
    apiClient.post<ProjectDailyUpdate>("/project-updates/", payload).then((r) => r.data),
  update: (id: number, payload: Partial<ProjectDailyUpdate>) =>
    apiClient.patch<ProjectDailyUpdate>(`/project-updates/${id}/`, payload).then((r) => r.data),
  sendEmail: (id: number) =>
    apiClient
      .post<{ sent: string[]; skipped: string[]; detail?: string }>(`/project-updates/${id}/send-email/`)
      .then((r) => r.data),
  pdfUrl: (id: number) => `${apiClient.defaults.baseURL}/project-updates/${id}/pdf/`,
};

export const myTasksApi = {
  list: () => apiClient.get<Paginated<ProjectTask>>("/my-tasks/").then((r) => r.data),
  update: (id: number, payload: Partial<ProjectTask>) =>
    apiClient.patch<ProjectTask>(`/my-tasks/${id}/`, payload).then((r) => r.data),
};
