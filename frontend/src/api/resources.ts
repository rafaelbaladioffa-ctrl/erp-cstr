import { apiClient } from "./client";
import type { Collaborator, DailyUpdate, Me, Paginated, Project, ProjectDailyUpdate, ProjectTask } from "./types";

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
