import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000/api";

const ACCESS_TOKEN_KEY = "erp_access_token";
const REFRESH_TOKEN_KEY = "erp_refresh_token";
const REMEMBER_KEY = "erp_remember_me";

// Sessão sem "manter conectado" usa sessionStorage (some ao fechar o navegador/aba);
// com "manter conectado" marcado, usa localStorage (sobrevive a fechar e reabrir).
function activeStore(): Storage {
  return localStorage.getItem(REMEMBER_KEY) === "1" ? localStorage : sessionStorage;
}

export const tokenStorage = {
  getAccess: () => activeStore().getItem(ACCESS_TOKEN_KEY),
  getRefresh: () => activeStore().getItem(REFRESH_TOKEN_KEY),
  set: (access: string, refresh: string, remember = false) => {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
    const store = remember ? localStorage : sessionStorage;
    store.setItem(ACCESS_TOKEN_KEY, access);
    store.setItem(REFRESH_TOKEN_KEY, refresh);
  },
  setAccess: (access: string) => activeStore().setItem(ACCESS_TOKEN_KEY, access),
  clear: () => {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    localStorage.removeItem(REMEMBER_KEY);
    sessionStorage.removeItem(ACCESS_TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  },
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

export async function login(username: string, password: string, remember = false) {
  const { data } = await axios.post(`${API_URL}/token/`, { username, password });
  tokenStorage.set(data.access, data.refresh, remember);
  return data;
}

export function logout() {
  tokenStorage.clear();
}
