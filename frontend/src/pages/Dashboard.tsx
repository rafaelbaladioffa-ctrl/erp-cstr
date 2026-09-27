import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../api/resources";
import type { ProjectsPerformanceData, TechnicalPerformanceData } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

// ── Shortcut catalog ─────────────────────────────────────────────────────────
interface ShortcutDef {
  id: string;
  label: string;
  sub: string;
  icon: string;
  path: string;
  perm?: string;
}

const ALL_SHORTCUTS: ShortcutDef[] = [
  { id: "projetos",     label: "Projetos",            sub: "Ver portfólio",        icon: "folder_open",     path: "/projetos" },
  { id: "operacoes",    label: "Operações do dia",    sub: "Central de despacho",  icon: "manage_accounts", path: "/operacao-do-dia" },
  { id: "timeline",     label: "Timeline",            sub: "Gantt operacional",    icon: "view_timeline",   path: "/timeline-operacional" },
  { id: "relatorios",   label: "Relatórios",          sub: "Indicadores",          icon: "bar_chart",       path: "/relatorios-indicadores" },
  { id: "tarefas",      label: "Minhas tarefas",      sub: "Visão do técnico",     icon: "checklist",       path: "/minhas-tarefas" },
  { id: "atualizacoes", label: "Atualizações diárias",sub: "Relatório ao cliente", icon: "send",            path: "/atualizacoes-diarias" },
  { id: "mapa",         label: "Mapa de sites",       sub: "Localização das obras", icon: "map",            path: "/sites/mapa" },
  { id: "auditoria",    label: "Auditoria",           sub: "Log de alterações",    icon: "policy",          path: "/auditoria" },
  { id: "cadastros",    label: "Cadastros",           sub: "Dados mestres",        icon: "database",        path: "/cadastros" },
  { id: "dashboard",    label: "Dashboard",           sub: "Performance técnica",  icon: "monitoring",      path: "/dashboard" },
];

const DEFAULT_SHORTCUTS = ["projetos", "operacoes", "timeline", "relatorios"];
const MAX_SHORTCUTS = 6;

function loadShortcuts(userId: string | number): string[] {
  try {
    const raw = localStorage.getItem(`home_shortcuts_${userId}`);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return DEFAULT_SHORTCUTS;
}

function saveShortcuts(userId: string | number, ids: string[]) {
  try { localStorage.setItem(`home_shortcuts_${userId}`, JSON.stringify(ids)); } catch {}
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function daysDiff(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

// ── Shortcut editor modal ────────────────────────────────────────────────────
function ShortcutEditor({
  selected,
  onSave,
  onClose,
}: {
  selected: string[];
  onSave: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(selected);

  function toggle(id: string) {
    setDraft((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < MAX_SHORTCUTS ? [...prev, id] : prev
    );
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background: "var(--white)", borderRadius: 12, width: 420, maxWidth: "calc(100vw - 32px)", boxShadow: "0 8px 32px rgba(0,0,0,0.16)" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Personalizar atalhos</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
              Selecione até {MAX_SHORTCUTS} atalhos para exibir na tela inicial.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4 }}>
            <Icon name="close" style={{ fontSize: 20 }} />
          </button>
        </div>

        <div style={{ padding: "14px 20px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
          {ALL_SHORTCUTS.map((s) => {
            const active = draft.includes(s.id);
            const disabled = !active && draft.length >= MAX_SHORTCUTS;
            return (
              <div
                key={s.id}
                onClick={() => !disabled && toggle(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 12px",
                  borderRadius: 8, border: `1px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange-soft)" : "var(--surface)",
                  cursor: disabled ? "not-allowed" : "pointer",
                  opacity: disabled ? 0.4 : 1,
                  transition: "all 0.12s",
                }}
              >
                <Icon name={s.icon} style={{ fontSize: 20, color: active ? "var(--orange)" : "var(--text-muted)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: active ? "var(--orange)" : "var(--text)" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.sub}</div>
                </div>
                <div style={{
                  width: 18, height: 18, borderRadius: 4, border: `2px solid ${active ? "var(--orange)" : "var(--border)"}`,
                  background: active ? "var(--orange)" : "transparent", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {active && <Icon name="check" style={{ fontSize: 13, color: "#fff" }} />}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ padding: "14px 20px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{draft.length} / {MAX_SHORTCUTS} selecionados</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={() => { onSave(draft); onClose(); }}>Salvar</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { user } = useAuth();
  const canViewProjects = hasPerm(user, PERMS.viewProject);
  const canViewTechnical = hasPerm(user, PERMS.viewCollaborator);

  const userId = user?.id ?? "guest";
  const [shortcuts, setShortcuts] = useState<string[]>(() => loadShortcuts(userId));
  const [editorOpen, setEditorOpen] = useState(false);

  const [projectsData, setProjectsData] = useState<ProjectsPerformanceData | null>(null);
  const [technical, setTechnical] = useState<TechnicalPerformanceData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const reqs: Promise<unknown>[] = [];
    if (canViewProjects) reqs.push(dashboardApi.projects({}).then(setProjectsData));
    if (canViewTechnical) reqs.push(dashboardApi.technical({}).then(setTechnical));
    Promise.all(reqs).finally(() => setLoading(false));
  }, [canViewProjects, canViewTechnical]);

  function handleSaveShortcuts(ids: string[]) {
    setShortcuts(ids);
    saveShortcuts(userId, ids);
  }

  const activeShortcuts = useMemo(
    () => ALL_SHORTCUTS.filter((s) => shortcuts.includes(s.id)).sort((a, b) => shortcuts.indexOf(a.id) - shortcuts.indexOf(b.id)),
    [shortcuts]
  );

  // Build alert list from projects data
  const alerts = useMemo(() => {
    if (!projectsData) return [];
    const list: { id: number | null; name: string; meta: string; level: "red" | "orange" | "blue" }[] = [];

    // Overdue projects
    projectsData.projects
      .filter((p) => p.is_overdue)
      .slice(0, 3)
      .forEach((p) => {
        const diff = daysDiff(p.planned_end ?? null);
        const days = diff !== null ? Math.abs(diff) : 0;
        list.push({ id: p.id, name: p.name, meta: `${p.code} · Prazo vencido há ${days} dia(s) · ${p.client || "—"}`, level: "red" });
      });

    // Near deadline (within 7 days, not overdue)
    projectsData.projects
      .filter((p) => {
        if (p.is_overdue) return false;
        const diff = daysDiff(p.planned_end ?? null);
        return diff !== null && diff <= 7;
      })
      .slice(0, 4)
      .forEach((p) => {
        const diff = daysDiff(p.planned_end ?? null);
        const label = diff === 0 ? "Vence hoje" : `Vence em ${diff} dia(s)`;
        list.push({ id: p.id, name: p.name, meta: `${p.code} · ${label} · ${p.client || "—"}`, level: "orange" });
      });

    if (list.length === 0 && !loading) {
      list.push({ id: null, name: "Nenhum alerta no momento", meta: "Todos os prazos estão em dia", level: "blue" });
    }

    return list.slice(0, 6);
  }, [projectsData, loading]);

  // KPI values
  const kpis = useMemo(() => {
    const active = projectsData?.by_status.find((s) => s.status === "in_progress")?.count ?? 0;
    const overdue = projectsData?.summary.overdue_projects ?? 0;
    const hours = technical?.summary.total_hours_worked ?? projectsData?.summary.total_worked_hours ?? 0;
    const tasks = technical?.summary.total_tasks_completed ?? 0;
    return { active, overdue, hours, tasks };
  }, [projectsData, technical]);

  const firstName = user?.full_name?.split(" ")[0] || user?.username || "você";
  const cols = 3;

  if (!canViewProjects && !canViewTechnical) {
    return <p style={{ padding: 32, color: "var(--text-muted)" }}>Você não tem permissão para acessar esta página.</p>;
  }

  return (
    <div>
      <PageHeader
        eyebrow={greeting()}
        title={firstName}
        subtitle="Acompanhe as pendências e acesse os módulos do sistema."
      />

      {/* KPI row */}
      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--blue)", lineHeight: 1 }}>{loading ? "—" : kpis.active}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>Em andamento</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>projetos ativos</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: kpis.overdue > 0 ? "var(--red)" : "var(--green)", lineHeight: 1 }}>{loading ? "—" : kpis.overdue}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>Em atraso</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>prazo vencido</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{loading ? "—" : kpis.tasks}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>Tarefas concluídas</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>acumuladas</div>
        </div>
        <div className="card" style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{loading ? "—" : formatHours(kpis.hours)}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: ".05em", marginTop: 6 }}>Horas trabalhadas</div>
          <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 2 }}>acumuladas</div>
        </div>
      </div>

      {/* Main 2-col layout */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 3fr", gap: 16, alignItems: "flex-start" }}>

        {/* Atalhos */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon name="grid_view" style={{ fontSize: 16, color: "var(--text-muted)" }} />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Acesso rápido</span>
            </div>
            <button
              onClick={() => setEditorOpen(true)}
              title="Personalizar atalhos"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center", gap: 4 }}
            >
              <Icon name="tune" style={{ fontSize: 16 }} />
            </button>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            padding: 12,
            gap: 8,
          }}>
            {activeShortcuts.map((s) => (
              <Link
                key={s.id}
                to={s.path}
                style={{ textDecoration: "none" }}
              >
                <div
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8, padding: "12px 10px",
                    display: "flex", flexDirection: "column", alignItems: "center",
                    gap: 6, cursor: "pointer", transition: "all 0.12s",
                    textAlign: "center",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--orange)"; (e.currentTarget as HTMLDivElement).style.background = "var(--orange-soft)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"; (e.currentTarget as HTMLDivElement).style.background = "var(--surface)"; }}
                >
                  <Icon name={s.icon} style={{ fontSize: 22, color: "var(--orange)" }} />
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)", lineHeight: 1.2 }}>{s.label}</div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.2 }}>{s.sub}</div>
                </div>
              </Link>
            ))}

            {/* Add shortcut placeholder */}
            {activeShortcuts.length < MAX_SHORTCUTS && (
              <div
                onClick={() => setEditorOpen(true)}
                style={{
                  border: "1px dashed var(--border)", borderRadius: 8, padding: "12px 10px",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                  cursor: "pointer", opacity: 0.5, textAlign: "center",
                }}
              >
                <Icon name="add" style={{ fontSize: 22, color: "var(--text-muted)" }} />
                <div style={{ fontSize: 10, color: "var(--text-muted)" }}>Adicionar</div>
              </div>
            )}
          </div>
        </div>

        {/* Alertas */}
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
            <Icon name="warning" style={{ fontSize: 16, color: "var(--orange)" }} />
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Atenção imediata</span>
            {kpis.overdue > 0 && (
              <span style={{ background: "var(--red-soft)", color: "var(--red)", fontSize: 11, fontWeight: 700, padding: "1px 8px", borderRadius: 10 }}>
                {kpis.overdue} em atraso
              </span>
            )}
            <div style={{ flex: 1 }} />
            {canViewProjects && (
              <Link to="/projetos" style={{ fontSize: 12, color: "var(--orange)", textDecoration: "none", fontWeight: 600 }}>
                Ver projetos →
              </Link>
            )}
          </div>

          {loading ? (
            <div style={{ padding: "20px 18px", color: "var(--text-muted)", fontSize: 13 }}>Carregando...</div>
          ) : (
            <div>
              {alerts.map((a, i) => {
                const color = a.level === "red" ? "var(--red)" : a.level === "orange" ? "var(--orange)" : "var(--blue)";
                const bgColor = a.level === "red" ? "var(--red-soft)" : a.level === "orange" ? "var(--orange-soft)" : "var(--blue-soft)";
                const inner = (
                  <>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, marginTop: 5 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{a.meta}</div>
                    </div>
                    {a.level !== "blue" && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 8, background: bgColor, color, flexShrink: 0 }}>
                        {a.level === "red" ? "Atrasado" : "Urgente"}
                      </span>
                    )}
                    {a.id !== null && (
                      <Icon name="chevron_right" style={{ fontSize: 16, color: "var(--text-faint)", flexShrink: 0 }} />
                    )}
                  </>
                );
                const rowStyle: React.CSSProperties = {
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 18px",
                  borderBottom: i < alerts.length - 1 ? "1px solid var(--border)" : "none",
                  textDecoration: "none",
                };
                return a.id !== null ? (
                  <Link
                    key={i}
                    to={`/projetos/${a.id}`}
                    style={rowStyle}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    {inner}
                  </Link>
                ) : (
                  <div key={i} style={rowStyle}>{inner}</div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {editorOpen && (
        <ShortcutEditor
          selected={shortcuts}
          onSave={handleSaveShortcuts}
          onClose={() => setEditorOpen(false)}
        />
      )}
    </div>
  );
}
