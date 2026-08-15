import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
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

type TabKey = "active" | "history";

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

function daysDiff(value: string | null) {
  if (!value) return null;
  const target = new Date(value + "T00:00:00").getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86400000);
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
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "projetos.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export default function ProjectsList() {
  const { user } = useAuth();
  const canAdd = hasPerm(user, PERMS.addProject);
  const canChange = hasPerm(user, PERMS.changeProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("active");
  const [search, setSearch] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);

  function reload() {
    setLoading(true);
    projectsApi
      .list()
      .then((data) => setProjects(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  function openCreate() {
    setEditingProject(null);
    setFormOpen(true);
  }

  function openEdit(project: Project) {
    setEditingProject(project);
    setFormOpen(true);
  }

  function handleSaved() {
    setFormOpen(false);
    reload();
  }

  useEffect(() => {
    setPage(1);
  }, [tab, search, clientFilter, siteFilter, categoryFilter, statusFilter]);

  const scoped = useMemo(
    () => projects.filter((p) => (tab === "active" ? p.status !== "completed" && p.status !== "canceled" : p.status === "completed" || p.status === "canceled")),
    [projects, tab]
  );

  const clientOptions = useMemo(() => Array.from(new Set(scoped.map((p) => p.client_name).filter(Boolean))) as string[], [scoped]);
  const siteOptions = useMemo(() => Array.from(new Set(scoped.map((p) => p.site_name).filter(Boolean))) as string[], [scoped]);
  const categoryOptions = useMemo(() => Array.from(new Set(scoped.map((p) => p.category_name).filter(Boolean))) as string[], [scoped]);
  const statusOptions = useMemo(() => Array.from(new Map(scoped.map((p) => [p.status, p.status_display])).entries()), [scoped]);

  const filtered = useMemo(() => {
    return scoped.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.po.toLowerCase().includes(search.toLowerCase())) return false;
      if (clientFilter && p.client_name !== clientFilter) return false;
      if (siteFilter && p.site_name !== siteFilter) return false;
      if (categoryFilter && p.category_name !== categoryFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      return true;
    });
  }, [scoped, search, clientFilter, siteFilter, categoryFilter, statusFilter]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const activeCount = projects.filter((p) => p.status !== "completed" && p.status !== "canceled").length;
  const inProgressCount = projects.filter((p) => p.status === "in_progress").length;
  const pausedCount = projects.filter((p) => p.status === "paused").length;
  const avgProgress = scoped.length ? Math.round(scoped.reduce((sum, p) => sum + p.progress_percent, 0) / scoped.length) : 0;
  const totalHours = scoped.reduce((sum, p) => sum + p.worked_hours, 0);

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
        <StatCard label="Projetos ativos" value={activeCount} hint={`${inProgressCount} em andamento`} icon="folder" tone="orange" />
        <StatCard label="Progresso médio" value={`${avgProgress}%`} hint="do portfólio exibido" icon="bar_chart" tone="blue" />
        <StatCard label="Horas registradas" value={formatHours(totalHours)} hint="tempo acumulado" icon="schedule" tone="green" />
        <StatCard label="Requer atenção" value={pausedCount} hint="projetos pausados" icon="warning" tone="amber" />
      </div>

      <div className="card">
        <div className="tabs" style={{ padding: "16px 20px 0", marginBottom: 0, borderBottom: "none" }}>
          <button className={`tab-btn${tab === "active" ? " active" : ""}`} onClick={() => setTab("active")}>
            Ativos
          </button>
          <button className={`tab-btn${tab === "history" ? " active" : ""}`} onClick={() => setTab("history")}>
            Históricos
          </button>
        </div>
        <div style={{ borderBottom: "1px solid var(--border)" }} />

        <div className="toolbar">
          <div>
            <div className="toolbar-title">Lista de projetos</div>
            <div className="toolbar-subtitle">{filtered.length} projeto(s) encontrado(s)</div>
          </div>
          <button className="btn btn-outline" onClick={() => exportCsv(filtered)}>
            <Icon name="download" style={{ fontSize: 16 }} />
            Exportar para Excel
          </button>
        </div>

        <div className="filter-row">
          <div className="field-group" style={{ flex: 1, minWidth: 220 }}>
            <span className="field-label">Buscar</span>
            <div className="search-input-wrap">
              <Icon name="search" />
              <input
                className="input"
                placeholder="Buscar por nome ou número da PO..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="field-group">
            <span className="field-label">Cliente</span>
            <select className="select" value={clientFilter} onChange={(e) => setClientFilter(e.target.value)}>
              <option value="">Todos</option>
              {clientOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Site</span>
            <select className="select" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">Todos</option>
              {siteOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Categoria</span>
            <select className="select" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">Todas</option>
              {categoryOptions.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Status</span>
            <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">Todos</option>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>Carregando...</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th>Site</th>
                  <th>Cliente</th>
                  <th>Categoria</th>
                  <th>Horas trabalhadas</th>
                  <th>Tarefas</th>
                  <th>Progresso</th>
                  <th>Status</th>
                  <th>Prazo</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((p) => {
                  const diff = daysDiff(p.planned_end);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link to={`/projetos/${p.id}`} style={{ color: "var(--text)", textDecoration: "none", fontWeight: 700 }}>
                          {p.name}
                        </Link>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>PO: {p.po || "—"}</div>
                      </td>
                      <td>{p.site_name || "—"}</td>
                      <td>{p.client_name || "—"}</td>
                      <td>{p.category_name || "Sem categoria"}</td>
                      <td>{formatHours(p.worked_hours)}</td>
                      <td>
                        {p.completed_tasks} / {p.total_tasks}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: `${p.progress_percent}%` }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>{p.progress_percent}%</span>
                        </div>
                      </td>
                      <td>
                        <StatusBadge status={p.status} label={p.status_display} />
                      </td>
                      <td>
                        <div>{formatDate(p.planned_end)}</div>
                        {diff !== null && (
                          <div style={{ fontSize: 11.5, color: diff < 0 ? "var(--red)" : "var(--text-faint)" }}>
                            {diff < 0 ? `${Math.abs(diff)} dias em atraso` : diff === 0 ? "vence hoje" : `${diff} dias restantes`}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <Link to={`/projetos/${p.id}`} className="btn btn-outline btn-sm">
                            Abrir
                          </Link>
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
                    <td colSpan={10}>
                      <div className="table-empty">Nenhum projeto encontrado.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {formOpen && (editingProject ? canChange : canAdd) && (
        <ProjectFormModal project={editingProject} onClose={() => setFormOpen(false)} onSaved={handleSaved} />
      )}
    </div>
  );
}
