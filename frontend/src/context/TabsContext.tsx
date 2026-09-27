import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

export interface AppTab {
  id: string;
  label: string;
  path: string;
  icon: string;
}

interface TabsContextValue {
  tabs: AppTab[];
  openTab: (tab: AppTab) => void;
  closeTab: (id: string) => void;
  clearTabs: () => void;
}

const TabsContext = createContext<TabsContextValue>({
  tabs: [],
  openTab: () => {},
  closeTab: () => {},
  clearTabs: () => {},
});

export function useTabs() {
  return useContext(TabsContext);
}

function storageKey(userId: number | string) {
  return `erp_tabs_${userId}`;
}

export function TabsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();

  const [tabs, setTabs] = useState<AppTab[]>(() => {
    if (!user?.id) return [];
    try {
      return JSON.parse(localStorage.getItem(storageKey(user.id)) || "[]");
    } catch {
      return [];
    }
  });

  // Persist whenever tabs change
  useEffect(() => {
    if (!user?.id) return;
    try {
      localStorage.setItem(storageKey(user.id), JSON.stringify(tabs));
    } catch {}
  }, [tabs, user?.id]);

  // Keep active tab in sync with current location
  useEffect(() => {
    const fullPath = location.pathname + location.search;
    setTabs((prev) => prev.map((t) => (t.path === fullPath ? t : t)));
  }, [location]);

  const openTab = useCallback((tab: AppTab) => {
    setTabs((prev) => {
      const existing = prev.find((t) => t.id === tab.id);
      if (existing) return prev;
      return [...prev, tab];
    });
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearTabs = useCallback(() => {
    setTabs([]);
    if (user?.id) {
      try { localStorage.removeItem(storageKey(user.id)); } catch {}
    }
  }, [user?.id]);

  return (
    <TabsContext.Provider value={{ tabs, openTab, closeTab, clearTabs }}>
      {children}
    </TabsContext.Provider>
  );
}
