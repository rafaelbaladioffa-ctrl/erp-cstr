import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CADASTROS_PERMS, PERMS, hasAnyPerm, hasPerm } from "../utils/permissions";
import Icon from "./ui/Icon";

interface NavItem {
  to: string;
  label: string;
  icon: string;
  permission?: string;
  permissions?: string[];
}

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Menu Principal",
    items: [
      { to: "/projetos", label: "Projetos", icon: "folder", permission: PERMS.viewProject },
      { to: "/atualizacoes-diarias", label: "Atualizações Diárias", icon: "event_note", permission: PERMS.viewDailyUpdate },
      { to: "/atualizacoes-projeto", label: "Atualizações de Projeto", icon: "description", permission: PERMS.viewProjectUpdate },
      { to: "/cadastros", label: "Cadastros Gerais", icon: "inventory_2", permissions: CADASTROS_PERMS },
    ],
  },
  {
    title: "Técnico",
    items: [{ to: "/minhas-tarefas", label: "Minhas Tarefas", icon: "checklist", permission: PERMS.viewMyTasks }],
  },
];

const AREA_LABELS: Record<string, { area: string; page: string }> = {
  "/projetos": { area: "Área Operacional", page: "Projetos" },
  "/atualizacoes-diarias": { area: "Área Operacional", page: "Atualizações Diárias" },
  "/atualizacoes-projeto": { area: "Área Operacional", page: "Atualizações de Projeto" },
  "/cadastros": { area: "Base de Dados", page: "Cadastros Gerais" },
  "/minhas-tarefas": { area: "Área Técnica", page: "Minhas Tarefas" },
};

function currentBreadcrumb(pathname: string) {
  const match = Object.keys(AREA_LABELS).find((key) => pathname.startsWith(key));
  if (match) return AREA_LABELS[match];
  if (pathname.startsWith("/projetos/")) return { area: "Área Operacional", page: "Detalhe do Projeto" };
  return { area: "ERP CSTR", page: "" };
}

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const breadcrumb = currentBreadcrumb(location.pathname);

  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      item.permissions ? hasAnyPerm(user, item.permissions) : hasPerm(user, item.permission!)
    ),
  })).filter((group) => group.items.length > 0);

  const displayName = user?.full_name || user?.username || "";
  const email = user?.email || user?.username || "";
  const role = user?.is_superuser ? "Admin" : "Usuário";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-mark">CS</div>
          <div className="sidebar-logo-text">
            CONSULTIMER
            <small>ERP CSTR</small>
          </div>
        </div>

        {groups.length === 0 && (
          <p style={{ fontSize: 13, color: "#DDE3EA", padding: "0 10px" }}>
            Seu usuário não tem acesso a nenhum módulo.
          </p>
        )}

        {groups.map((group, idx) => (
          <div key={group.title || idx}>
            <div className="sidebar-group-title">{group.title}</div>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => `sidebar-link${isActive ? " active" : ""}`}
              >
                <Icon name={item.icon} />
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          <div className="sidebar-user">{displayName}</div>
          <div className="sidebar-org">Consultimer Group</div>
          <button className="sidebar-logout" onClick={logout}>
            <Icon name="logout" style={{ fontSize: 16 }} />
            Sair
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <div>
            <div className="topbar-breadcrumb-eyebrow">{breadcrumb.area}</div>
            <div className="topbar-breadcrumb-title">{breadcrumb.page}</div>
          </div>
          <div className="topbar-right">
            <button className="topbar-icon-btn" aria-label="Notificações">
              <Icon name="lightbulb" style={{ fontSize: 18 }} />
            </button>
            <button className="topbar-icon-btn" aria-label="Configurações">
              <Icon name="settings" style={{ fontSize: 18 }} />
            </button>
            <div className="topbar-user">
              <div className="topbar-user-email">{email}</div>
              <div className="topbar-user-role">{role}</div>
            </div>
          </div>
        </header>
        <main className="app-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
