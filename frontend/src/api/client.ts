import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const ACCESS_TOKEN_KEY = "erp_access_token";
const REFRESH_TOKEN_KEY = "erp_refresh_token";
const SAVED_USERNAME_KEY = "erp_saved_username";

// Sempre em sessionStorage: a sessão nunca sobrevive a fechar o navegador/aba,
// login e senha são exigidos de novo a cada abertura.
export const tokenStorage = {
  getAccess: () => sessionStorage.getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => sessionStorage.getItem(REFRESH_TOKEN_KEY),
  set: (access: string, refresh: string) => {
    sessionStorage.setItem(ACCESS_TOKEN_KEY, access);
    sessionStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  setAccess: (access: string) => sessionStorage.setItem(ACCESS_TOKEN_KEY, access),
  clear: () => {
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// Apenas o nome de usuário (nunca a senha) pode ficar salvo entre sessões,
// só para preencher o campo automaticamente na tela de login.
export const savedUsername = {
  get: () => localStorage.getItem(SAVED_USERNAME_KEY) || "",
  set: (username: string) => localStorage.setItem(SAVED_USERNAME_KEY, username),
  clear: () => localStorage.removeItem(SAVED_USERNAME_KEY),
};

export const apiClient = axios.create({ baseURL: API_URL });

apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStorage.getAccess();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = tokenStorage.getRefresh();
  if (!refresh) return null;
  try {
    const { data } = await axios.post(`${API_URL}/token/refresh/`, { refresh });
    tokenStorage.setAccess(data.access);
    return data.access as string;
  } catch {
    tokenStorage.clear();
    return null;
  }
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccess = await refreshPromise;
      if (newAccess) {
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccess}`;
        return apiClient(originalRequest);
      }
      window.location.href = "/login";
    }
    return Promise.reject(error);
  },
);

export async function login(username: string, password: string) {
  const { data } = await axios.post(`${API_URL}/token/`, { username, password });
  tokenStorage.set(data.access, data.refresh);
  return data;
}

export function logout() {
  tokenStorage.clear();
}
