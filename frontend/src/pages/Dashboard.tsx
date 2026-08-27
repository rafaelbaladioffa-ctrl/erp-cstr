import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { dashboardApi, registryApi } from "../api/resources";
import type { Company, ClientFull, ProjectsPerformanceData, TechnicalPerformanceData } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

type DashboardTab = "technical" | "projects";

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "not_started", label: "Não Iniciado" },
  { value: "in_progress", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "completed", label: "Concluído" },
  { value: "canceled", label: "Cancelado" },
];

function formatHours(hours: number) {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (!data.length) return <p style={{ color: "var(--text-muted)", fontSize: 12.5 }}>Sem dados para o período/filtros selecionados.</p>;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 14, height: 140, overflowX: "auto", padding: "0 4px" }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, minWidth: 44 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>{d.value}</div>
          <div
            style={{
              width: 26,
              height: Math.max(4, (d.value / max) * 100),
              background: "var(--orange)",
              borderRadius: "3px 3px 0 0",
            }}
          />
          <div style={{ fontSize: 10.5, color: "var(--text-muted)", textAlign: "center", maxWidth: 60, lineHeight: 1.2 }}>{d.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const canViewProjects = hasPerm(user, PERMS.viewProject);
  const canViewTechnical = hasPerm(user, PERMS.viewCollaborator);

  const [tab, setTab] = useState<DashboardTab>(canViewTechnical ? "technical" : "projects");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<ClientFull[]>([]);

  const [company, setCompany] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [client, setClient] = useState("");
  const [status, setStatus] = useState("");

  const [technical, setTechnical] = useState<TechnicalPerformanceData | null>(null);
  const [technicalLoading, setTechnicalLoading] = useState(false);
  const [projectsData, setProjectsData] = useState<ProjectsPerformanceData | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);

  useEffect(() => {
    registryApi.companies.list({ page_size: "500" } as never).then((r) => setCompanies(r.results));
    registryApi.clients.list({ page_size: "500" } as never).then((r) => setClients(r.results));
  }, []);

  useEffect(() => {
    if (tab !== "technical" || !canViewTechnical) return;
    const params: Record<string, string> = {};
    if (company) params.company = company;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    setTechnicalLoading(true);
    dashboardApi
      .technical(params)
      .then(setTechnical)
      .finally(() => setTechnicalLoading(false));
  }, [tab, canViewTechnical, company, dateFrom, dateTo]);

  useEffect(() => {
    if (tab !== "projects" || !canViewProjects) return;
    const params: Record<string, string> = {};
    if (company) params.company = company;
    if (client) params.client = client;
    if (status) params.status = status;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    setProjectsLoading(true);
    dashboardApi
      .projects(params)
      .then(setProjectsData)
      .finally(() => setProjectsLoading(false));
  }, [tab, canViewProjects, company, client, status, dateFrom, dateTo]);

  const technicalChartData = useMemo(
    () => (technical?.collaborators || []).slice(0, 8).map((c) => ({ label: c.name.split(" ")[0], value: c.hours_worked })),
    [technical]
  );
  const projectsChartData = useMemo(
    () => (projectsData?.top_projects_by_hours || []).slice(0, 8).map((p) => ({ label: p.code || p.name, value: p.worked_hours })),
    [projectsData]
  );

  if (!canViewProjects && !canViewTechnical) {
    return <p style={{ padding: 32, color: "var(--text-muted)" }}>Você não tem permissão para acessar o Dashboard.</p>;
  }

  return (
    <div>
      <PageHeader eyebrow="Sistema" title="Dashboard" subtitle="Performance técnica e visão geral dos projetos." />

      <div className="tabs" style={{ marginBottom: 16 }}>
        {canViewTechnical && (
          <button className={`tab-btn${tab === "technical" ? " active" : ""}`} onClick={() => setTab("technical")}>
            Performance Técnica
          </button>
        )}
        {canViewProjects && (
          <button className={`tab-btn${tab === "projects" ? " active" : ""}`} onClick={() => setTab("projects")}>
            Visão Geral de Projetos
          </button>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div className="field-group">
            <span className="field-label">Empresa</span>
            <select className="select" value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">Todas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.trade_name || c.legal_name}
                </option>
              ))}
            </select>
          </div>
          {tab === "projects" && (
            <>
              <div className="field-group">
                <span className="field-label">Cliente</span>
                <select className="select" value={client} onChange={(e) => setClient(e.target.value)}>
                  <option value="">Todos</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.trade_name || c.legal_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <span className="field-label">Status</span>
                <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="">Todos</option>
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
          <div className="field-group">
            <span className="field-label">Criado de</span>
            <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field-group">
            <span className="field-label">Criado até</span>
            <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {tab === "technical" && canViewTechnical && (
        <>
          {technicalLoading && !technical && <p style={{ color: "var(--text-muted)" }}>Carregando...</p>}
          {technical && (
            <>
              <div className="stat-grid">
                <StatCard label="Colaboradores" value={technical.summary.total_collaborators} icon="groups" tone="blue" />
                <StatCard label="Tarefas Concluídas" value={technical.summary.total_tasks_completed} icon="task_alt" tone="green" />
                <StatCard label="Horas Trabalhadas" value={formatHours(technical.summary.total_hours_worked)} icon="schedule" tone="orange" />
                <StatCard label="Links Executados" value={technical.summary.total_links_executed} icon="lan" tone="teal" />
              </div>

              <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>
                  Horas trabalhadas por colaborador
                </div>
                <BarChart data={technicalChartData} />
              </div>

              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Colaborador</th>
                        <th>Cargo</th>
                        <th>Empresa</th>
                        <th>Tarefas</th>
                        <th>Horas</th>
                        <th>Links</th>
                      </tr>
                    </thead>
                    <tbody>
                      {technical.collaborators.map((c) => (
                        <tr key={c.collaborator_id}>
                          <td>{c.name}</td>
                          <td>{c.job_title || "—"}</td>
                          <td>{c.company || "—"}</td>
                          <td>{c.tasks_completed} / {c.tasks_total}</td>
                          <td>{formatHours(c.hours_worked)}</td>
                          <td>{c.links_executed}</td>
                        </tr>
                      ))}
                      {technical.collaborators.length === 0 && (
                        <tr>
                          <td colSpan={6}>
                            <div className="table-empty">Nenhum colaborador encontrado para os filtros selecionados.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === "projects" && canViewProjects && (
        <>
          {projectsLoading && !projectsData && <p style={{ color: "var(--text-muted)" }}>Carregando...</p>}
          {projectsData && (
            <>
              <div className="stat-grid">
                <StatCard label="Projetos" value={projectsData.summary.total_projects} icon="folder" tone="blue" />
                <StatCard label="Atrasados" value={projectsData.summary.overdue_projects} icon="warning" tone="amber" />
                <StatCard label="Progresso Médio" value={`${projectsData.summary.avg_progress_percent}%`} icon="bar_chart" tone="orange" />
                <StatCard label="Horas Trabalhadas" value={formatHours(projectsData.summary.total_worked_hours)} icon="schedule" tone="teal" />
              </div>

              <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>
                    Top projetos por horas trabalhadas
                  </div>
                  <BarChart data={projectsChartData} />
                </div>
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", marginBottom: 12 }}>
                    Projetos por status
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {projectsData.by_status.map((s) => (
                      <div key={s.status} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 90, fontSize: 12, color: "var(--text-muted)" }}>{s.status_display}</div>
                        <div style={{ flex: 1, height: 8, background: "var(--bg)", borderRadius: 4, overflow: "hidden" }}>
                          <div
                            style={{
                              width: `${(s.count / Math.max(1, projectsData.summary.total_projects)) * 100}%`,
                              height: "100%",
                              background: "var(--orange)",
                            }}
                          />
                        </div>
                        <div style={{ width: 24, fontSize: 12, fontWeight: 700, color: "var(--text)", textAlign: "right" }}>{s.count}</div>
                      </div>
                    ))}
                    {projectsData.by_status.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 12.5 }}>Sem dados.</p>}
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Projeto</th>
                        <th>Cliente</th>
                        <th>Status</th>
                        <th>Progresso</th>
                        <th>Horas</th>
                        <th>Links</th>
                        <th>Prazo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {projectsData.projects.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <Link to={`/projetos/${p.id}`} style={{ color: "var(--text)", fontWeight: 700, textDecoration: "none" }}>
                              {p.code || p.name}
                            </Link>
                          </td>
                          <td>{p.client || "—"}</td>
                          <td>
                            <StatusBadge status={p.status} label={p.status_display} />
                          </td>
                          <td>{p.progress_percent}%</td>
                          <td>{formatHours(p.worked_hours)}</td>
                          <td>{p.link_count}</td>
                          <td>
                            {p.is_overdue && <Icon name="warning" style={{ fontSize: 14, color: "var(--amber)", verticalAlign: "-2px", marginRight: 4 }} />}
                            {p.planned_end ? new Date(p.planned_end + "T00:00:00").toLocaleDateString("pt-BR") : "—"}
                          </td>
                        </tr>
                      ))}
                      {projectsData.projects.length === 0 && (
                        <tr>
                          <td colSpan={7}>
                            <div className="table-empty">Nenhum projeto encontrado para os filtros selecionados.</div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
