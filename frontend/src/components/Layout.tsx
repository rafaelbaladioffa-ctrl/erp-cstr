import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { notificationsApi, searchApi, type GlobalSearchResult } from "../api/resources";
import type { Notification } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { CADASTROS_PERMS, PERMS, hasAnyPerm, hasPerm } from "../utils/permissions";
import AccountModal from "./AccountModal";
import Icon from "./ui/Icon";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  permissions?: string[];
  superuserOnly?: boolean;
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Central de Operações",
    items: [
      { to: "/operacao-do-dia", label: "Operação do Dia", icon: "alt_route", permission: PERMS.viewOperationsBoard },
      { to: "/timeline-operacional", label: "Timeline Operacional", icon: "schedule", permission: PERMS.viewOperationsBoard },
      { to: "/relatorios-indicadores", label: "Relatórios e Indicadores", icon: "bar_chart", permission: PERMS.viewOperationsBoard },
    ],
  },
  {
    title: "Projeto",
    items: [
      { to: "/projetos", label: "Projetos Ativos", icon: "folder", permission: PERMS.viewProject },
      { to: "/projetos?tab=history", label: "Histórico de Projetos", icon: "history_edu", permission: PERMS.viewProject },
    ],
  },
  {
    title: "Atualizações",
    items: [
      { to: "/atualizacoes-diarias", label: "Atualizações Diárias", icon: "event_note", permission: PERMS.viewDailyUpdate },
      { to: "/atualizacoes-projeto", label: "Atualizações de Projetos", icon: "description", permission: PERMS.viewProjectUpdate },
    ],
  },
  {
    title: "Sistema",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: "dashboard", permissions: [PERMS.viewProject, PERMS.viewCollaborator] },
      { to: "/cadastros", label: "Cadastros Gerais", icon: "inventory_2", permissions: CADASTROS_PERMS },
      { to: "/regras-de-geracao", label: "Regras de Geração", icon: "rule", permission: PERMS.viewGenerationRule },
    ],
  },
  {
    title: "Técnico",
    items: [{ to: "/minhas-tarefas", label: "Minhas Tarefas", icon: "checklist", permission: PERMS.viewMyTasks }],
  },
  {
    title: "Segurança",
    items: [{ to: "/auditoria", label: "Log", icon: "history", superuserOnly: true }],
  },
];

const AREA_LABELS: Record<string, { area: string; page: string }> = {
  "/operacao-do-dia": { area: "Central de Operações", page: "Operação do Dia" },
  "/timeline-operacional": { area: "Central de Operações", page: "Timeline Operacional" },
  "/relatorios-indicadores": { area: "Central de Operações", page: "Relatórios e Indicadores" },
  "/dashboard": { area: "Sistema", page: "Dashboard" },
  "/atualizacoes-diarias": { area: "Atualizações", page: "Atualizações Diárias" },
  "/atualizacoes-projeto": { area: "Atualizações", page: "Atualizações de Projetos" },
  "/cadastros": { area: "Sistema", page: "Cadastros Gerais" },
  "/regras-de-geracao": { area: "Sistema", page: "Regras de Geração" },
  "/minhas-tarefas": { area: "Técnico", page: "Minhas Tarefas" },
  "/auditoria": { area: "Segurança", page: "Log" },
};

function currentBreadcrumb(pathname: string, search: string) {
  if (pathname === "/projetos") {
    const tab = new URLSearchParams(search).get("tab");
    return { area: "Projeto", page: tab === "history" ? "Histórico de Projetos" : "Projetos Ativos" };
  }
  const match = Object.keys(AREA_LABELS).find((key) => pathname.startsWith(key));
  if (match) return AREA_LABELS[match];
  if (pathname.startsWith("/projetos/")) return { area: "Projeto", page: "Detalhe do Projeto" };
  return { area: "ERP CSTR", page: "" };
}

function isItemActive(item: NavItem, pathname: string, search: string): boolean {
  const [itemPath, itemQuery] = item.to.split("?");
  if (pathname !== itemPath) return false;
  const tab = new URLSearchParams(search).get("tab") || "";
  const itemTab = new URLSearchParams(itemQuery || "").get("tab") || "";
  return tab === itemTab;
}

type Theme = "light" | "dark";

function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return (localStorage.getItem("erp_theme") as Theme) || "light";
}

const EMPTY_RESULTS: GlobalSearchResult = { projects: [], sites: [], tasks: [] };

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const breadcrumb = currentBreadcrumb(location.pathname, location.search);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [theme, setTheme] = useState<Theme>(getStoredTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GlobalSearchResult>(EMPTY_RESULTS);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("erp_theme", theme);
  }, [theme]);

  useEffect(() => {
    function loadUnreadCount() {
      notificationsApi.unreadCount().then((data) => setUnreadCount(data.count));
    }
    loadUnreadCount();
    const timer = setInterval(loadUnreadCount, 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!notifOpen) return;
    setNotifLoading(true);
    notificationsApi
      .list()
      .then((data) => setNotifications(data.results))
      .finally(() => setNotifLoading(false));
  }, [notifOpen]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) setSettingsOpen(false);
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const term = searchQuery.trim();
    if (term.length < 2) {
      setSearchResults(EMPTY_RESULTS);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(() => {
      searchApi
        .search(term)
        .then((data) => {
          if (!cancelled) setSearchResults(data);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const groups = useMemo(() => {
    return NAV_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.superuserOnly) return !!user?.is_superuser;
        return item.permissions ? hasAnyPerm(user, item.permissions) : hasPerm(user, item.permission!);
      }),
    })).filter((group) => group.items.length > 0);
  }, [user]);

  function isGroupOpen(title: string) {
    return !collapsedGroups[title];
  }

  function toggleGroup(title: string) {
    setCollapsedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  const hasAnyModule = NAV_GROUPS.some((group) =>
    group.items.some((item) => (item.superuserOnly ? user?.is_superuser : item.permissions ? hasAnyPerm(user, item.permissions) : hasPerm(user, item.permission!)))
  );

  const displayName = user?.full_name || user?.username || "";
  const email = user?.email || user?.username || "";
  const role = user?.is_superuser ? "Admin" : "Usuário";
  const initials = (displayName || email).slice(0, 2).toUpperCase();

  const hasResults = searchResults.projects.length > 0 || searchResults.sites.length > 0 || searchResults.tasks.length > 0;
  const term = searchQuery.trim();

  function goTo(path: string) {
    navigate(path);
    setSearchOpen(false);
    setSearchQuery("");
  }

  function openNotification(notification: Notification) {
    setNotifOpen(false);
    if (!notification.is_read) {
      notificationsApi.markRead(notification.id).then(() => {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      });
    }
    if (notification.url) navigate(notification.url);
  }

  function handleMarkAllRead() {
    notificationsApi.markAllRead().then(() => {
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    });
  }

  function formatNotifDate(value: string) {
    const date = new Date(value);
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  return (
    <div className="app-shell">
      <header className="shellbar">
        <button className="mobile-menu-btn" aria-label="Abrir menu" onClick={() => setMobileMenuOpen(true)}>
          <Icon name="menu" style={{ fontSize: 22 }} />
        </button>
        <div className="shellbar-brand">
          <img src="/consultimer-logo-branco.png" alt="Consultimer" className="shellbar-brand-logo" />
        </div>

        <div className="shellbar-search" ref={searchRef} style={{ position: "relative" }}>
          <Icon name="search" style={{ fontSize: 17 }} />
          <input
            type="text"
            placeholder="Buscar projetos, sites, tarefas..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchOpen(true)}
          />
          {searchOpen && term.length >= 2 && (
            <div className="search-dropdown">
              {searching && <div className="search-dropdown-empty">Buscando...</div>}
              {!searching && !hasResults && <div className="search-dropdown-empty">Nenhum resultado para "{term}".</div>}
              {!searching && searchResults.projects.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">Projetos</div>
                  {searchResults.projects.map((p) => (
                    <button key={`p-${p.id}`} className="search-dropdown-item" onClick={() => goTo(`/projetos/${p.id}`)}>
                      <Icon name="folder" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">
                          {p.name} {p.po && <span className="search-dropdown-item-muted">· PO {p.po}</span>}
                        </div>
                        <div className="search-dropdown-item-muted">
                          {p.code} {p.client && `· ${p.client}`} {p.site && `· ${p.site}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!searching && searchResults.sites.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">Sites</div>
                  {searchResults.sites.map((s) => (
                    <button key={`s-${s.id}`} className="search-dropdown-item" onClick={() => goTo("/cadastros")}>
                      <Icon name="location_on" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">{s.name}</div>
                        <div className="search-dropdown-item-muted">
                          {s.code} {s.client && `· ${s.client}`} {s.city && `· ${s.city}`}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!searching && searchResults.tasks.length > 0 && (
                <div className="search-dropdown-group">
                  <div className="search-dropdown-title">Tarefas</div>
                  {searchResults.tasks.map((t) => (
                    <button key={`t-${t.id}`} className="search-dropdown-item" onClick={() => goTo(`/projetos/${t.project_id}`)}>
                      <Icon name="checklist" style={{ fontSize: 17 }} />
                      <div>
                        <div className="search-dropdown-item-title">{t.task_name}</div>
                        <div className="search-dropdown-item-muted">
                          {t.project_code} — {t.project_name} · {t.status_display}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="shellbar-spacer" />
        <div ref={notifRef} style={{ position: "relative" }}>
          <button className="shellbar-icon-btn" aria-label="Notificações" onClick={() => setNotifOpen((v) => !v)} style={{ position: "relative" }}>
            <Icon name="notifications" style={{ fontSize: 18 }} />
            {unreadCount > 0 && <span className="notif-badge">{unreadCount > 9 ? "9+" : unreadCount}</span>}
          </button>
          {notifOpen && (
            <div className="search-dropdown" style={{ right: 0, left: "auto", width: 340 }}>
              <div className="settings-dropdown-title" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 4px" }}>
                <span>Notificações</span>
                {unreadCount > 0 && (
                  <button className="btn btn-outline btn-sm" style={{ padding: "2px 8px", fontSize: 11 }} onClick={handleMarkAllRead}>
                    Marcar todas como lidas
                  </button>
                )}
              </div>
              {notifLoading && <div className="search-dropdown-empty">Carregando...</div>}
              {!notifLoading && notifications.length === 0 && <div className="search-dropdown-empty">Nenhuma notificação.</div>}
              {!notifLoading &&
                notifications.map((n) => (
                  <button
                    key={n.id}
                    className="search-dropdown-item"
                    onClick={() => openNotification(n)}
                    style={{ background: n.is_read ? undefined : "var(--blue-soft)" }}
                  >
                    <Icon name="notifications" style={{ fontSize: 17 }} />
                    <div>
                      <div className="search-dropdown-item-title">{n.title}</div>
                      <div className="search-dropdown-item-muted">{n.message}</div>
                      <div className="search-dropdown-item-muted">{formatNotifDate(n.created_at)}</div>
                    </div>
                  </button>
                ))}
            </div>
          )}
        </div>
        <div ref={settingsRef} style={{ position: "relative" }}>
          <button className="shellbar-icon-btn" aria-label="Configurações" onClick={() => setSettingsOpen((v) => !v)}>
            <Icon name="settings" style={{ fontSize: 18 }} />
          </button>
          {settingsOpen && (
            <div className="settings-dropdown">
              <div className="settings-dropdown-title">Tema</div>
              <div className="settings-theme-toggle">
                <button
                  className={theme === "light" ? "active" : ""}
                  onClick={() => setTheme("light")}
                >
                  <Icon name="light_mode" style={{ fontSize: 16 }} />
                  Claro
                </button>
                <button
                  className={theme === "dark" ? "active" : ""}
                  onClick={() => setTheme("dark")}
                >
                  <Icon name="dark_mode" style={{ fontSize: 16 }} />
                  Escuro
                </button>
              </div>
              <div className="settings-dropdown-sep" />
              <button
                className="settings-dropdown-item"
                onClick={() => {
                  setSettingsOpen(false);
                  setAccountOpen(true);
                }}
              >
                <Icon name="account_circle" style={{ fontSize: 18 }} />
                Minha Conta
              </button>
              <button className="settings-dropdown-item" onClick={logout}>
                <Icon name="logout" style={{ fontSize: 18 }} />
                Sair
              </button>
            </div>
          )}
        </div>
        <div className="shellbar-avatar" title={displayName}>
          {initials}
        </div>
      </header>

      {accountOpen && <AccountModal onClose={() => setAccountOpen(false)} />}

      <div className="app-below-shell">
        {mobileMenuOpen && <div className="sidebar-backdrop" onClick={() => setMobileMenuOpen(false)} />}
        <aside className={`sidebar${mobileMenuOpen ? " sidebar-open" : ""}`}>
          <div className="sidebar-mobile-head">
            <span>Menu</span>
            <button className="sidebar-close-btn" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>
              <Icon name="close" style={{ fontSize: 18 }} />
            </button>
          </div>

          {!hasAnyModule && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "0 10px" }}>
              Seu usuário não tem acesso a nenhum módulo.
            </p>
          )}

          {hasAnyModule && groups.length === 0 && (
            <p style={{ fontSize: 12.5, color: "var(--text-faint)", padding: "0 14px" }}>Nenhum item encontrado.</p>
          )}

          {groups.map((group, idx) => {
            const open = isGroupOpen(group.title);
            return (
              <div key={group.title || idx} className="sidebar-group">
                <button
                  type="button"
                  className="sidebar-group-title sidebar-group-toggle"
                  onClick={() => toggleGroup(group.title)}
                  aria-expanded={open}
                >
                  <span>{group.title}</span>
                  <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
                </button>
                {open &&
                  group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={`sidebar-link${isItemActive(item, location.pathname, location.search) ? " active" : ""}`}
                    >
                      <Icon name={item.icon} />
                      {item.label}
                    </Link>
                  ))}
              </div>
            );
          })}

          <div className="sidebar-spacer" />

          <div className="sidebar-footer">
            <div className="sidebar-footer-user">
              <div className="sidebar-footer-avatar">{initials}</div>
              <div>
                <div className="sidebar-user">{displayName}</div>
                <div className="sidebar-org">{role} &middot; Consultimer Group</div>
              </div>
            </div>
            <button className="sidebar-logout" onClick={logout}>
              <Icon name="logout" style={{ fontSize: 16 }} />
              Sair
            </button>
          </div>
        </aside>

        <div className="app-main">
          <div className="crumbbar">
            <span>{breadcrumb.area}</span>
            {breadcrumb.page && (
              <>
                <Icon name="chevron_right" style={{ fontSize: 15 }} />
                <b>{breadcrumb.page}</b>
              </>
            )}
            <div className="crumbbar-right">
              <span className="topbar-user-email">{email}</span>
            </div>
          </div>
          <main className="app-content">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
