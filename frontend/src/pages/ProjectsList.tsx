import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { projectsApi } from "../api/resources";
import type { Project } from "../api/types";
import ProjectFormModal from "../components/projects/ProjectFormModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";
import StatCard from "../components/ui/StatCard";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

type TabKey = "in_progress" | "paused" | "planning" | "completed";
type ViewMode = "list" | "kanban";

function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value + "T00:00:00").toLocaleDateString("pt-BR");
}

function daysDiff(value: string | null): number | null {
  if (!value) return null;
  const target = new Date(value + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
}

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function exportCsv(projects: Project[]) {
  const header = ["Codigo", "Projeto", "Site", "Cliente", "Categoria", "Horas", "Tarefas", "Progresso", "Status", "Prazo"];
  const rows = projects.map((p) => [
    p.code,
    p.name,
    p.site_name || "",
    p.client_name || "",
    p.category_name || "",
    formatHours(p.worked_hours),
    `${p.completed_tasks}/${p.total_tasks}`,
    `${p.progress_percent}%`,
    p.status_display,
    p.planned_end || "",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${neutralizeFormula(String(cell)).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "projetos.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function DeadlineLabel({ planned_end }: { planned_end: string | null }) {
  const diff = daysDiff(planned_end);
  if (diff === null) return <span style={{ color: "var(--text-faint)", fontSize: 11 }}>Sem prazo</span>;
  if (diff < 0)
    return <span style={{ color: "var(--red)", fontSize: 11, fontWeight: 600 }}>{Math.abs(diff)}d em atraso</span>;
  if (diff === 0)
    return <span style={{ color: "var(--orange)", fontSize: 11, fontWeight: 600 }}>Vence hoje</span>;
  if (diff <= 14)
    return <span style={{ color: "var(--orange)", fontSize: 11 }}>{diff}d restantes</span>;
  return <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{diff}d restantes</span>;
}

// ── Detail panel shown beside the list ──────────────────────────────────────
function DetailPanel({ project, canChange, onEdit, onClose }: {
  project: Project;
  canChange: boolean;
  onEdit: (p: Project) => void;
  onClose: () => void;
}) {
  const diff = daysDiff(project.planned_end);
  const progressColor =
    project.progress_percent >= 80 ? "var(--green)" :
    project.progress_percent >= 40 ? "var(--blue)" : "var(--red)";

  return (
    <div style={{
      width: 240,
      flexShrink: 0,
      borderLeft: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      background: "var(--surface)",
    }}>
      {/* header */}
      <div style={{ padding: "14px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", lineHeight: 1.3, marginBottom: 2 }}>{project.name}</div>
          {project.po && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>PO: {project.po}</div>}
        </div>
        <button
          onClick={onClose}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, flexShrink: 0 }}
        >
          <Icon name="close" style={{ fontSize: 16 }} />
        </button>
      </div>

      {/* big progress */}
      <div style={{ padding: "16px 16px 12px", borderBottom: "1px solid var(--border)", textAlign: "center" }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: progressColor, lineHeight: 1 }}>{project.progress_percent}%</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, marginBottom: 10 }}>progresso geral</div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${project.progress_percent}%`, background: progressColor }} />
        </div>
      </div>

      {/* stats */}
      <div style={{ padding: "12px 16px", flex: 1, overflowY: "auto" }}>
        {[
          { label: "Cliente", value: project.client_name || "—" },
          { label: "Site", value: project.site_name || "—" },
          { label: "Categoria", value: project.category_name || "—" },
          { label: "Tarefas", value: `${project.completed_tasks} / ${project.total_tasks}` },
          { label: "Horas", value: formatHours(project.worked_hours) },
          { label: "Prazo", value: formatDate(project.planned_end) },
        ].map(({ label, value }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{value}</span>
          </div>
        ))}
        {diff !== null && (
          <div style={{ padding: "8px 0" }}>
            <DeadlineLabel planned_end={project.planned_end} />
          </div>
        )}
      </div>

      {/* actions */}
      <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <Link to={`/projetos/${project.id}`} className="btn btn-primary btn-sm" style={{ textAlign: "center", textDecoration: "none" }}>
          Abrir projeto
        </Link>
        {canChange && (
          <button className="btn btn-outline btn-sm" onClick={() => onEdit(project)}>
            <Icon name="edit" style={{ fontSize: 14 }} /> Editar
          </button>
        )}
      </div>
    </div>
  );
}

// ── Kanban card ──────────────────────────────────────────────────────────────
function KanbanCard({
  project, selected, onClick, onDragStart,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const diff = daysDiff(project.planned_end);
  const overdue = diff !== null && diff < 0;
  const overrideColor =
    project.status === "completed" ? "var(--green)" :
    overdue ? "var(--red)" :
    undefined;

  const borderColor = selected ? "var(--orange)" : "var(--border)";

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      style={{
        background: "var(--surface)",
        border: `1.5px solid ${borderColor}`,
        borderRadius: 8,
        padding: "11px 12px",
        marginBottom: 8,
        cursor: "grab",
        transition: "box-shadow 0.12s",
        boxShadow: selected ? "0 0 0 2px var(--orange-soft)" : undefined,
        opacity: 1,
      }}
      onMouseEnter={(e) => { if (!selected) (e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.08)"); }}
      onMouseLeave={(e) => { if (!selected) (e.currentTarget.style.boxShadow = ""); }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", lineHeight: 1.35, marginBottom: 3 }}>{project.name}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
        {project.client_name || "—"} · {project.site_name || "—"}
      </div>
      <div className="progress-track" style={{ marginBottom: 6 }}>
        <div
          className="progress-fill"
          style={{ width: `${project.progress_percent}%`, ...(overrideColor ? { background: overrideColor } : {}) }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{project.completed_tasks}/{project.total_tasks} tarefas</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)" }}>{project.progress_percent}%</span>
      </div>
      {diff !== null && (
        <div style={{ marginTop: 5 }}>
          <DeadlineLabel planned_end={project.planned_end} />
        </div>
      )}
    </div>
  );
}

// ── Kanban board ─────────────────────────────────────────────────────────────
const KANBAN_COLS: { key: string | string[]; label: string; statusKey: string; color: string; dropStatus: string }[] = [
  { key: "in_progress", label: "Em andamento", statusKey: "in_progress", color: "#185fa5", dropStatus: "in_progress" },
  { key: "paused", label: "Pausados", statusKey: "paused", color: "#854f0b", dropStatus: "paused" },
  { key: "planning", label: "Planejamento", statusKey: "planning", color: "#534ab7", dropStatus: "planning" },
  { key: ["completed", "canceled"], label: "Finalizados", statusKey: "completed", color: "#3b6d11", dropStatus: "completed" },
];

function KanbanView({
  projects, selectedId, onSelect, onStatusChange,
}: {
  projects: Project[];
  selectedId: number | null;
  onSelect: (p: Project) => void;
  onStatusChange: (projectId: number, newStatus: string) => void;
}) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const dragIdRef = useRef<number | null>(null);

  return (
    <div className="kanban-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, minHeight: 300 }}>
      {KANBAN_COLS.map((col, ci) => {
        const colProjects = projects.filter((p) =>
          Array.isArray(col.key) ? col.key.includes(p.status) : p.status === col.key
        );
        const isOver = dragOverCol === col.dropStatus;
        return (
          <div
            key={ci}
            onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.dropStatus); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverCol(null);
              if (dragIdRef.current !== null) {
                onStatusChange(dragIdRef.current, col.dropStatus);
                dragIdRef.current = null;
              }
            }}
            style={{
              borderRight: ci < 3 ? "1px solid var(--border)" : "none",
              padding: "14px 12px",
              background: isOver ? "var(--orange-soft)" : undefined,
              transition: "background 0.1s",
              minHeight: 80,
            }}
          >
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 12,
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {col.label}
              </span>
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: col.statusKey === "in_progress" ? "#e6f1fb" :
                  col.statusKey === "paused" ? "#faeeda" :
                  col.statusKey === "planning" ? "#eeedfe" : "#eaf3de",
                color: col.color,
                borderRadius: 10, padding: "1px 8px",
              }}>
                {colProjects.length}
              </span>
            </div>
            {colProjects.length === 0 && (
              <div style={{
                fontSize: 12, color: "var(--text-faint)", textAlign: "center", padding: "20px 0",
                border: isOver ? "2px dashed var(--orange)" : "2px dashed transparent",
                borderRadius: 8, transition: "border-color 0.1s",
              }}>
                {isOver ? "Soltar aqui" : "Nenhum projeto"}
              </div>
            )}
            {colProjects.map((p) => (
              <KanbanCard
                key={p.id}
                project={p}
                selected={selectedId === p.id}
                onClick={() => onSelect(p)}
                onDragStart={(e) => {
                  dragIdRef.current = p.id;
                  e.dataTransfer.effectAllowed = "move";
                }}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────
export default function ProjectsList() {
  const { user } = useAuth();
  const canAdd = hasPerm(user, PERMS.addProject);
  const canChange = hasPerm(user, PERMS.changeProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = (searchParams.get("tab") as TabKey) || "in_progress";
  function setTab(next: TabKey) {
    setSearchParams(next === "in_progress" ? {} : { tab: next }, { replace: true });
  }
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function reload() {
    setLoading(true);
    projectsApi
      .list()
      .then((data) => setProjects(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(); }, []);

  function openCreate() { setEditingProject(null); setFormOpen(true); }
  function openEdit(project: Project) { setEditingProject(project); setFormOpen(true); }
  function handleSaved() { setFormOpen(false); reload(); }

  useEffect(() => { setPage(1); }, [tab, search, clientFilter, siteFilter, categoryFilter]);

  // close detail panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setSelectedProject(null);
      }
    }
    if (selectedProject) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectedProject]);

  const scoped = useMemo(() => {
    const statusMap: Record<TabKey, string | string[]> = {
      in_progress: "in_progress",
      paused: "paused",
      planning: "planning",
      completed: ["completed", "canceled"],
    };
    const target = statusMap[tab];
    return projects.filter((p) =>
      Array.isArray(target) ? target.includes(p.status) : p.status === target
    );
  }, [projects, tab]);

  // In kanban mode, search/filters apply to all projects
  const kanbanBase = useMemo(() => projects.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.po.toLowerCase().includes(search.toLowerCase())) return false;
    if (clientFilter && p.client_name !== clientFilter) return false;
    if (siteFilter && p.site_name !== siteFilter) return false;
    if (categoryFilter && p.category_name !== categoryFilter) return false;
    return true;
  }), [projects, search, clientFilter, siteFilter, categoryFilter]);

  const clientOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.client_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const siteOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.site_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const categoryOptions = useMemo(() => Array.from(new Set(
    (viewMode === "kanban" ? projects : scoped).map((p) => p.category_name).filter(Boolean)
  )) as string[], [scoped, projects, viewMode]);

  const filtered = useMemo(() => {
    return scoped.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.po.toLowerCase().includes(search.toLowerCase())) return false;
      if (clientFilter && p.client_name !== clientFilter) return false;
      if (siteFilter && p.site_name !== siteFilter) return false;
      if (categoryFilter && p.category_name !== categoryFilter) return false;
      return true;
    });
  }, [scoped, search, clientFilter, siteFilter, categoryFilter]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const inProgressCount = projects.filter((p) => p.status === "in_progress").length;
  const pausedCount = projects.filter((p) => p.status === "paused").length;
  const planningCount = projects.filter((p) => p.status === "planning").length;
  const completedCount = projects.filter((p) => p.status === "completed" || p.status === "canceled").length;

  const activeCount = viewMode === "kanban" ? kanbanBase.length : filtered.length;

  return (
    <div>
      <PageHeader
        eyebrow="Portfólio"
        title="Projetos"
        subtitle="Acompanhe o portfólio, prazos e evolução operacional."
        actions={
          canAdd ? (
            <button className="btn btn-primary" onClick={openCreate}>
              <Icon name="add" style={{ fontSize: 18 }} />
              Novo projeto
            </button>
          ) : undefined
        }
      />

      <div className="stat-grid">
        <StatCard label="Em andamento" value={inProgressCount} hint="projetos ativos" />
        <StatCard label="Pausados" value={pausedCount} hint="aguardando retomada" />
        <StatCard label="Planejamentos" value={planningCount} hint="em preparação" />
        <StatCard label="Finalizados" value={completedCount} hint="concluídos ou cancelados" />
      </div>

      <div className="card" style={{ padding: 0, overflow: "visible" }}>

        {/* tabs — only in list mode */}
        {viewMode === "list" && (
          <>
            <div className="tabs" style={{ padding: "16px 20px 0", marginBottom: 0, borderBottom: "none" }}>
              <button className={`tab-btn${tab === "in_progress" ? " active" : ""}`} onClick={() => setTab("in_progress")}>Ativos</button>
              <button className={`tab-btn${tab === "paused" ? " active" : ""}`} onClick={() => setTab("paused")}>Pausados</button>
              <button className={`tab-btn${tab === "planning" ? " active" : ""}`} onClick={() => setTab("planning")}>Planejamentos</button>
              <button className={`tab-btn${tab === "completed" ? " active" : ""}`} onClick={() => setTab("completed")}>Finalizados</button>
            </div>
            <div style={{ borderBottom: "1px solid var(--border)" }} />
          </>
        )}

        {/* toolbar */}
        <div className="toolbar" style={{ padding: "14px 20px" }}>
          <div>
            <div className="toolbar-title">
              {viewMode === "kanban" ? "Visão Kanban" : "Lista de projetos"}
            </div>
            <div className="toolbar-subtitle">{activeCount} projeto(s) encontrado(s)</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* view toggle */}
            <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
              <button
                title="Visualização em lista"
                onClick={() => setViewMode("list")}
                style={{
                  padding: "5px 10px", border: "none", cursor: "pointer",
                  background: viewMode === "list" ? "var(--orange)" : "transparent",
                  color: viewMode === "list" ? "#fff" : "var(--text-muted)",
                  borderRight: "1px solid var(--border)",
                  display: "flex", alignItems: "center",
                }}
              >
                <Icon name="view_list" style={{ fontSize: 16 }} />
              </button>
              <button
                title="Visualização em kanban"
                onClick={() => { setViewMode("kanban"); setSelectedProject(null); }}
                style={{
                  padding: "5px 10px", border: "none", cursor: "pointer",
                  background: viewMode === "kanban" ? "var(--orange)" : "transparent",
                  color: viewMode === "kanban" ? "#fff" : "var(--text-muted)",
                  display: "flex", alignItems: "center",
                }}
              >
                <Icon name="view_kanban" style={{ fontSize: 16 }} />
              </button>
            </div>
            <button className="btn btn-outline" onClick={() => exportCsv(viewMode === "kanban" ? kanbanBase : filtered)}>
              <Icon name="download" style={{ fontSize: 16 }} />
              Exportar
            </button>
          </div>
        </div>

        {/* filters */}
        <div className="filter-row" style={{ padding: "0 20px 14px" }}>
          <div className="field-group" style={{ flex: 1, minWidth: 220 }}>
            <span className="field-label">Buscar</span>
            <div className="search-input-wrap">
              <Icon name="search" />
              <input
                className="input"
                placeholder="Buscar por nome ou PO..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="field-group">
            <span className="field-label">Cliente</span>
            <select className="select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">Todos</option>
              {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Site</span>
            <select className="select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">Todos</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Categoria</span>
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas</option>
              {categoryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        </div>

        <div style={{ borderTop: "1px solid var(--border)" }} />

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>Carregando...</p>
        ) : viewMode === "kanban" ? (
          /* ── KANBAN VIEW ── */
          <div className="projects-layout" style={{ display: "flex", alignItems: "flex-start" }}>
            <div className="kanban-scroll-wrap" style={{ flex: 1, minWidth: 0 }}>
              <KanbanView
                projects={kanbanBase}
                selectedId={selectedProject?.id ?? null}
                onSelect={setSelectedProject}
                onStatusChange={(projectId, newStatus) => {
                  const STATUS_DISPLAY: Record<string, string> = {
                    in_progress: "Ativo",
                    paused: "Pausado",
                    planning: "Planejamento",
                    completed: "Finalizado",
                    canceled: "Cancelado",
                  };
                  const current = projects.find((p) => p.id === projectId);
                  if (!current || current.status === newStatus) return;
                  const display = STATUS_DISPLAY[newStatus] ?? newStatus;
                  setProjects((prev) => prev.map((p) => p.id === projectId ? { ...p, status: newStatus, status_display: display } : p));
                  if (selectedProject?.id === projectId) setSelectedProject((prev) => prev ? { ...prev, status: newStatus, status_display: display } : prev);
                  projectsApi.update(projectId, { status: newStatus } as Partial<Project>).catch(() => reload());
                }}
              />
            </div>
            {selectedProject && (
              <div className="projects-detail-panel" ref={panelRef}>
                <DetailPanel
                  project={selectedProject}
                  canChange={canChange}
                  onEdit={openEdit}
                  onClose={() => setSelectedProject(null)}
                />
              </div>
            )}
          </div>
        ) : (
          /* ── LIST VIEW ── */
          <div className="projects-layout" style={{ display: "flex", alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
              <table className="table" style={{ minWidth: 700 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 200 }}>Projeto</th>
                    <th>Cliente / Site</th>
                    <th style={{ textAlign: "center" }}>Tarefas</th>
                    <th style={{ minWidth: 160 }}>Progresso</th>
                    <th>Status</th>
                    <th>Prazo</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((p) => {
                    const isSelected = selectedProject?.id === p.id;
                    const diff = daysDiff(p.planned_end);
                    const overrideColor =
                      p.status === "completed" ? "var(--green)" :
                      diff !== null && diff < 0 ? "var(--red)" :
                      undefined;
                    return (
                      <tr
                        key={p.id}
                        style={{
                          background: isSelected ? "var(--surface-2)" : undefined,
                          cursor: "pointer",
                        }}
                        onClick={() => setSelectedProject(isSelected ? null : p)}
                      >
                        <td>
                          <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{p.name}</div>
                          {p.po && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>PO: {p.po}</div>}
                        </td>
                        <td>
                          <div style={{ fontSize: 13, color: "var(--text)" }}>{p.client_name || "—"}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.site_name || "—"}</div>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
                            {p.completed_tasks}<span style={{ fontSize: 11, fontWeight: 400, color: "var(--text-muted)" }}>/{p.total_tasks}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>tarefas</div>
                        </td>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div className="progress-track" style={{ flex: 1 }}>
                              <div
                                className="progress-fill"
                                style={{ width: `${p.progress_percent}%`, ...(overrideColor ? { background: overrideColor } : {}) }}
                              />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", minWidth: 32, textAlign: "right" }}>
                              {p.progress_percent}%
                            </span>
                          </div>
                        </td>
                        <td>
                          <StatusBadge status={p.status} label={p.status_display} />
                        </td>
                        <td>
                          <div style={{ fontSize: 12, color: "var(--text)" }}>{formatDate(p.planned_end)}</div>
                          <DeadlineLabel planned_end={p.planned_end} />
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <Link to={`/projetos/${p.id}`} className="btn btn-outline btn-sm">Abrir</Link>
                            {canChange && (
                              <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}>
                                <Icon name="edit" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {paged.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <div className="table-empty">Nenhum projeto encontrado.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedProject && (
              <div className="projects-detail-panel" ref={panelRef}>
                <DetailPanel
                  project={selectedProject}
                  canChange={canChange}
                  onEdit={openEdit}
                  onClose={() => setSelectedProject(null)}
                />
              </div>
            )}
          </div>
        )}

        {viewMode === "list" && (
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
        )}
      </div>

      {formOpen && (editingProject ? canChange : canAdd) && (
        <ProjectFormModal project={editingProject} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
