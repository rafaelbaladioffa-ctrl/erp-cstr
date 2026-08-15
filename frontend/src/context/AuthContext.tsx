import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, tokenStorage } from "../api/client";
import { meApi } from "../api/resources";
import type { Me } from "../api/types";

interface AuthContextValue {
  user: Me | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = tokenStorage.getAccess();
    if (!token) {
      setLoading(false);
      return;
    }
    meApi
      .get()
      .then(setUser)
      .catch(() => {
        tokenStorage.clear();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    await apiLogin(username, password);
    const me = await meApi.get();
    setUser(me);
  }

  function logout() {
    apiLogout();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider");
  return ctx;
}
