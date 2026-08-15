import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

const NAV_GROUPS = [
  {
    items: [
      { to: "/projetos", label: "Projetos", permission: PERMS.viewProject },
      { to: "/atualizacoes-diarias", label: "Atualizações Diárias", permission: PERMS.viewDailyUpdate },
      { to: "/atualizacoes-projeto", label: "Atualizações de Projeto", permission: PERMS.viewProjectUpdate },
    ],
  },
  {
    title: "Técnico",
    items: [{ to: "/minhas-tarefas", label: "Minhas Tarefas", permission: PERMS.viewMyTasks }],
  },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => hasPerm(user, item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <div style={{ display: "flex", minHeight: "100vh", fontFamily: "Manrope, Arial, sans-serif" }}>
      <aside
        style={{
          width: 240,
          background: "#172033",
          color: "#fff",
          padding: "24px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 24, color: "#F16023" }}>ERP CSTR</div>
        {groups.length === 0 && (
          <p style={{ fontSize: 13, color: "#DDE3EA" }}>Seu usuário não tem acesso a nenhum módulo.</p>
        )}
        {groups.map((group, idx) => (
          <div key={group.title || idx} style={{ marginBottom: 8 }}>
            {group.title && (
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#526174",
                  textTransform: "uppercase",
                  margin: "12px 12px 6px",
                }}
              >
                {group.title}
              </div>
            )}
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                style={({ isActive }) => ({
                  display: "block",
                  padding: "10px 12px",
                  borderRadius: 8,
                  color: "#fff",
                  textDecoration: "none",
                  background: isActive ? "#F16023" : "transparent",
                  fontSize: 14,
                  fontWeight: 600,
                })}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          {user?.full_name || user?.username}
        </div>
        <button
          onClick={logout}
          style={{
            background: "transparent",
            border: "1px solid #526174",
            color: "#fff",
            borderRadius: 8,
            padding: "8px 12px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Sair
        </button>
      </aside>
      <main style={{ flex: 1, background: "#F7F9FB", padding: 32, overflowY: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
