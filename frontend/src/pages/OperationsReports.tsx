import { useEffect, useMemo, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsReports } from "../api/types";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatHours(value: number) {
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  if (h === 0 && m === 0) return "0min";
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function initials(name: string) {
  const parts = name.trim().split(" ");
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_COLORS = [
  { bg: "var(--blue-soft)", color: "var(--blue)" },
  { bg: "var(--purple-soft)", color: "var(--purple)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" },
  { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--teal-soft)", color: "var(--teal)" },
  { bg: "var(--red-soft)", color: "var(--red)" },
];

function avatarColor(id: number) {
  return AVATAR_COLORS[id % AVATAR_COLORS.length];
}

function utilColor(pct: number): string {
  if (pct > 300) return "var(--red)";
  if (pct > 100) return "var(--amber)";
  return "var(--green)";
}

function utilTextColor(pct: number): string {
  if (pct > 300) return "var(--red)";
  if (pct > 100) return "var(--amber)";
  return "var(--green)";
}

type LogType = "all" | "concluiu" | "despacho" | "inicio" | "status";

function detectLogType(text: string): Exclude<LogType, "all"> {
  const t = text.toLowerCase();
  if (t.includes("concluiu")) return "concluiu";
  if (t.includes("despachado") || t.includes("despacho")) return "despacho";
  if (t.includes("iniciou")) return "inicio";
  return "status";
}

const LOG_TYPE_META: Record<Exclude<LogType, "all">, { label: string; color: string; tag: string }> = {
  concluiu: { label: "Concluiu", color: "var(--green)", tag: "log-tag-concluiu" },
  despacho: { label: "Despacho", color: "var(--blue)", tag: "log-tag-despacho" },
  inicio:   { label: "Iniciou",  color: "var(--amber)", tag: "log-tag-inicio" },
  status:   { label: "Status",   color: "var(--text-faint)", tag: "log-tag-status" },
};

export default function OperationsReportsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "all">("all");
  const [dateFrom, setDateFrom] = useState(() => daysAgoISO(29));
  const [dateTo, setDateTo] = useState(() => todayISO());
  const [data, setData] = useState<OperationsReports | null>(null);
  const [loading, setLoading] = useState(false);
  const [activitiesPage, setActivitiesPage] = useState(1);
  const [activitiesPageSize, setActivitiesPageSize] = useState(10);
  const [logFilter, setLogFilter] = useState<LogType>("all");

  useEffect(() => {
    sitesApi.list().then((res) => setSites(res.results));
  }, []);

  useEffect(() => {
    setLoading(true);
    operationsApi
      .reports(siteId, dateFrom, dateTo)
      .then(setData)
      .finally(() => setLoading(false));
  }, [siteId, dateFrom, dateTo]);

  useEffect(() => {
    setActivitiesPage(1);
  }, [siteId, dateFrom, dateTo]);

  const stats = data?.stats;
  const technicians = data?.technicians || [];
  const activities = data?.activities || [];
  const activitiesSlice = activities.slice(
    (activitiesPage - 1) * activitiesPageSize,
    activitiesPage * activitiesPageSize
  );
  const todayTechnicians = data?.today_technicians || [];
  const unproductiveByReason = data?.unproductive_by_reason || [];
  const logEntries = data?.log_entries || [];
  const maxReasonHours = Math.max(1, ...unproductiveByReason.map((r) => r.hours));
  const totalUnproductiveHours = unproductiveByReason.reduce((s, r) => s + r.hours, 0);
  const maxActivityHours = Math.max(1, ...activities.filter((a) => a.avg_hours > 0).map((a) => a.avg_hours));

  const filteredLog = useMemo(() => {
    if (logFilter === "all") return logEntries;
    return logEntries.filter((e) => detectLogType(e.text) === logFilter);
  }, [logEntries, logFilter]);

  const rankedTechs = useMemo(
    () => [...technicians].filter((t) => t.utilization_pct != null).sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0)),
    [technicians]
  );
  const maxUtilPct = Math.max(1, rankedTechs[0]?.utilization_pct ?? 1);

  return (
    <div>
      <PageHeader
        eyebrow="Central de Operações"
        title="Relatórios e Indicadores"
        subtitle="Desempenho por técnico e por tipo de atividade no período"
        actions={
          <div className="ops-toolbar">
            <input type="date" className="input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>até</span>
            <input type="date" className="input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">Todos os sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        }
      />

      {loading && !data ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          {/* ① KPI Cards com ícone, barra de progresso e contexto */}
          <div className="stat-grid" style={{ marginBottom: 16 }}>
            {/* Utilização Média */}
            <div className="rpt-kpi-card">
              <div className="rpt-kpi-top">
                <span className="rpt-kpi-label">Utilização Média</span>
                <span className="rpt-kpi-icon" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>
                  ⚡
                </span>
              </div>
              <div
                className="rpt-kpi-value"
                style={{ color: (stats?.avg_utilization_pct ?? 0) > 300 ? "var(--red)" : "var(--text)" }}
              >
                {stats?.avg_utilization_pct ?? 0}%
              </div>
              <div className="rpt-kpi-hint">Média dos técnicos no período</div>
            </div>

            {/* Horas Produtivas */}
            <div className="rpt-kpi-card">
              <div className="rpt-kpi-top">
                <span className="rpt-kpi-label">Horas Produtivas Hoje</span>
                <span className="rpt-kpi-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>✓</span>
              </div>
              <div className="rpt-kpi-value" style={{ color: "var(--green)" }}>
                {formatHours(stats?.today_productive_hours ?? 0)}
              </div>
              {(stats?.today_productive_hours ?? 0) > 0 && (
                <>
                  <div className="rpt-kpi-bar">
                    <div
                      className="rpt-kpi-bar-fill"
                      style={{
                        width: `${Math.min(100, ((stats?.today_productive_hours ?? 0) / 6) * 100)}%`,
                        background: "var(--green)",
                      }}
                    />
                  </div>
                  <div className="rpt-kpi-hint">
                    {Math.round(((stats?.today_productive_hours ?? 0) / 6) * 100)}% da meta diária (6h)
                  </div>
                </>
              )}
              {(stats?.today_productive_hours ?? 0) === 0 && (
                <div className="rpt-kpi-hint">Nenhuma hora produtiva registrada hoje</div>
              )}
            </div>

            {/* Horas Improdutivas */}
            <div className="rpt-kpi-card">
              <div className="rpt-kpi-top">
                <span className="rpt-kpi-label">Horas Improdutivas Hoje</span>
                <span
                  className="rpt-kpi-icon"
                  style={{
                    background: (stats?.today_unproductive_hours ?? 0) === 0 ? "var(--green-soft)" : "var(--red-soft)",
                    color: (stats?.today_unproductive_hours ?? 0) === 0 ? "var(--green)" : "var(--red)",
                  }}
                >
                  {(stats?.today_unproductive_hours ?? 0) === 0 ? "✓" : "!"}
                </span>
              </div>
              <div
                className="rpt-kpi-value"
                style={{ color: (stats?.today_unproductive_hours ?? 0) > 0.5 ? "var(--red)" : "var(--green)" }}
              >
                {formatHours(stats?.today_unproductive_hours ?? 0)}
              </div>
              <div className="rpt-kpi-hint">
                {(stats?.today_unproductive_hours ?? 0) === 0 ? "Zerado hoje — ótimo resultado" : "Limite recomendado: 30min"}
              </div>
            </div>

            {/* Concluídas no Mês */}
            <div className="rpt-kpi-card">
              <div className="rpt-kpi-top">
                <span className="rpt-kpi-label">Concluídas no Mês</span>
                <span className="rpt-kpi-icon" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>📋</span>
              </div>
              <div className="rpt-kpi-value">{stats?.completed_this_month ?? 0}</div>
              <div className="rpt-kpi-hint">Tarefas concluídas no mês corrente</div>
            </div>
          </div>

          {/* ② Grid 2×2: Log / Desempenho Hoje / Ranking / Improdutivas */}
          <div className="reports-four-grid" style={{ marginBottom: 16 }}>
            {/* Ranking de utilização — linha 1 col 1 */}
            <div className="ops-pool-card rpt-compact-card">
              <div className="ops-card-head">
                <div className="ops-card-title">Ranking de Utilização — Período</div>
                <div className="ops-card-hint">Técnicos com jornada cadastrada</div>
              </div>
              {rankedTechs.length > 0 ? (
                <>
                  <div className="rpt-ranking">
                    {rankedTechs.map((t, i) => {
                      const pct = t.utilization_pct!;
                      const ac = avatarColor(t.id);
                      return (
                        <div key={t.id} className="rpt-rank-row">
                          <span className="rpt-rank-num">{i + 1}</span>
                          <div className="rpt-avatar" style={{ background: ac.bg, color: ac.color }}>{initials(t.name)}</div>
                          <span className="rpt-rank-name">{t.name.split(" ")[0]} {t.name.split(" ").slice(-1)[0]}</span>
                          <div className="rpt-rank-bar-wrap">
                            <div className="rpt-rank-bar">
                              <div className="rpt-rank-fill" style={{ width: `${(pct / maxUtilPct) * 100}%`, background: utilColor(pct) }} />
                            </div>
                          </div>
                          <span className="rpt-rank-pct" style={{ color: utilTextColor(pct) }}>{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="rpt-rank-legend">
                    <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--red)" }} />Sobrecarga (&gt;300%)</div>
                    <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--amber)" }} />Elevado (100–300%)</div>
                    <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--green)" }} />Normal (&lt;100%)</div>
                  </div>
                </>
              ) : (
                <div className="empty-state">Nenhum técnico com jornada no período.</div>
              )}
            </div>

            {/* Horas Improdutivas — linha 1 col 2 */}
            <div className="ops-pool-card rpt-compact-card">
              <div className="ops-card-head">
                <div className="ops-card-title">Horas Improdutivas — Mês</div>
                <div className="ops-card-hint">Status classificados como improdutivos, mês corrente</div>
              </div>
              <div className="reason-bars">
                {unproductiveByReason.map((r) => (
                  <div key={r.status} className="reason-bar-row">
                    <div className="reason-bar-label">{r.status_display}</div>
                    <div className="reason-bar-track">
                      <div className="reason-bar-fill" style={{ width: `${(r.hours / maxReasonHours) * 100}%` }} />
                    </div>
                    <div className="reason-bar-value">{formatHours(r.hours)}</div>
                  </div>
                ))}
                {unproductiveByReason.length === 0 && <div className="empty-state">Nenhuma hora improdutiva registrada no mês.</div>}
              </div>
              {totalUnproductiveHours > 40 && (
                <div className="rpt-improd-alert">
                  ⚠ {formatHours(totalUnproductiveHours)} de técnicos sem atividade alocada — revisar distribuição de tarefas
                </div>
              )}
            </div>

            {/* Log Automático — linha 2 col 1 */}
            <div className="ops-pool-card rpt-compact-card">
              <div className="ops-card-head">
                <div>
                  <div className="ops-card-title">Log Automático — Hoje</div>
                  <div className="ops-card-hint">Gerado pelo sistema a cada mudança de status</div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{logEntries.length} eventos</div>
              </div>

              {/* Filtro por tipo */}
              <div className="log-filter-row">
                {(["all", "concluiu", "despacho", "inicio", "status"] as LogType[]).map((f) => (
                  <button
                    key={f}
                    className={`log-filter-chip${logFilter === f ? " active" : ""}`}
                    onClick={() => setLogFilter(f)}
                  >
                    {f === "all" ? "Todos" : LOG_TYPE_META[f].label}
                    {f !== "all" && (
                      <span className="log-filter-count">
                        {logEntries.filter((e) => detectLogType(e.text) === f).length}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div className="log-feed">
                {filteredLog.map((e, idx) => {
                  const type = detectLogType(e.text);
                  const meta = LOG_TYPE_META[type];
                  return (
                    <div key={idx} className="log-item">
                      <span className="log-dot" style={{ background: meta.color }} />
                      <div className="log-time">{formatClock(e.at)}</div>
                      <div className="log-text">
                        <strong>{e.name}</strong> {e.text}{" "}
                        <span className={`log-tag ${meta.tag}`}>{meta.label}</span>
                      </div>
                    </div>
                  );
                })}
                {filteredLog.length === 0 && (
                  <div className="empty-state">Nenhum evento{logFilter !== "all" ? " deste tipo" : ""} registrado hoje.</div>
                )}
              </div>

              {/* Legenda */}
              <div className="log-legend">
                {(["concluiu", "despacho", "inicio", "status"] as Exclude<LogType, "all">[]).map((t) => (
                  <div key={t} className="log-legend-item">
                    <span className="log-legend-dot" style={{ background: LOG_TYPE_META[t].color }} />
                    {LOG_TYPE_META[t].label}
                  </div>
                ))}
              </div>
            </div>

            {/* Desempenho Hoje */}
            <div className="ops-pool-card rpt-compact-card">
              <div className="ops-card-head">
                <div className="ops-card-title">Desempenho por Técnico — Hoje</div>
                <div className="ops-card-hint">{todayTechnicians.length} técnico(s) com atividade hoje</div>
              </div>

              <div className="rpt-compact-scroll">
              {todayTechnicians.map((t) => {
                const total = t.journey_hours > 0 ? t.journey_hours : t.active_hours + t.available_hours + t.break_hours + (t.unproductive_hours ?? 0);
                const safeTotal = total || 1;
                const activePct = Math.min(100, (t.active_hours / safeTotal) * 100);
                const breakPct = Math.min(100 - activePct, (t.break_hours / safeTotal) * 100);
                const unprodPct = Math.min(100 - activePct - breakPct, ((t.unproductive_hours ?? 0) / safeTotal) * 100);
                const avPct = Math.min(100 - activePct - breakPct - unprodPct, (t.available_hours / safeTotal) * 100);
                const ac = avatarColor(t.id);
                return (
                  <div key={t.id} className="rpt-today-row">
                    {/* Mini timeline */}
                    <div className="rpt-today-header">
                      <div className="rpt-today-avatar" style={{ background: ac.bg, color: ac.color }}>
                        {initials(t.name)}
                      </div>
                      <div>
                        <div className="rpt-today-name">{t.name}</div>
                        {t.journey_hours > 0 && (
                          <div className="rpt-today-sub">Jornada: {formatHours(t.journey_hours)}</div>
                        )}
                      </div>
                      {t.utilization_pct != null && (
                        <div className="rpt-today-util" style={{ color: utilTextColor(t.utilization_pct) }}>
                          {t.utilization_pct}%
                          <span className="rpt-today-util-label">utilização</span>
                        </div>
                      )}
                    </div>

                    {/* Barra de tempo */}
                    <div className="rpt-today-timeline">
                      <div className="rpt-today-bar">
                        <div style={{ width: `${activePct}%`, background: "var(--green)", height: "100%", borderRadius: 2 }} title={`Em atividades: ${formatHours(t.active_hours)}`} />
                        <div style={{ width: `${breakPct}%`, background: "var(--amber)", height: "100%", opacity: 0.7 }} title={`Intervalos: ${formatHours(t.break_hours)}`} />
                        <div style={{ width: `${unprodPct}%`, background: "var(--red)", height: "100%", opacity: 0.75 }} title={`Improdutivo: ${formatHours(t.unproductive_hours ?? 0)}`} />
                        <div style={{ width: `${avPct}%`, background: "var(--blue)", height: "100%", opacity: 0.5 }} title={`Disponível: ${formatHours(t.available_hours)}`} />
                      </div>
                    </div>

                    {/* Métricas */}
                    <div className="rpt-today-metrics">
                      <div className="rpt-today-metric">
                        <span className="rpt-today-metric-dot" style={{ background: "var(--green)" }} />
                        <span className="rpt-today-metric-label">Atividades</span>
                        <span className="rpt-today-metric-val">{formatHours(t.active_hours)}</span>
                      </div>
                      <div className="rpt-today-metric">
                        <span className="rpt-today-metric-dot" style={{ background: "var(--amber)", opacity: 0.8 }} />
                        <span className="rpt-today-metric-label">Intervalos</span>
                        <span className="rpt-today-metric-val">{formatHours(t.break_hours)}</span>
                      </div>
                      <div className="rpt-today-metric">
                        <span className="rpt-today-metric-dot" style={{ background: "var(--red)", opacity: 0.75 }} />
                        <span className="rpt-today-metric-label">Improdutivo</span>
                        <span className="rpt-today-metric-val">{formatHours(t.unproductive_hours ?? 0)}</span>
                      </div>
                      <div className="rpt-today-metric">
                        <span className="rpt-today-metric-dot" style={{ background: "var(--blue)", opacity: 0.6 }} />
                        <span className="rpt-today-metric-label">Disponível</span>
                        <span className="rpt-today-metric-val">{formatHours(t.available_hours)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {todayTechnicians.length === 0 && (
                <div className="table-empty" style={{ padding: 20 }}>Nenhuma atividade hoje.</div>
              )}
              </div>{/* /rpt-compact-scroll */}
            </div>

          </div>{/* /reports-four-grid */}

          {/* ③ Desempenho Histórico com barras coloridas e avatares */}
          <div className="ops-pool-card" style={{ marginBottom: 16 }}>
            <div className="ops-card-head">
              <div className="ops-card-title">Desempenho por Técnico — Histórico</div>
              <div className="ops-card-hint">{technicians.length} técnico(s) com atividade no período</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Técnico</th>
                    <th>Sites</th>
                    <th>Jornada</th>
                    <th>Em Atividades</th>
                    <th>Concluídas</th>
                    <th>Utilização</th>
                  </tr>
                </thead>
                <tbody>
                  {technicians.map((t) => {
                    const ac = avatarColor(t.id);
                    const pct = t.utilization_pct;
                    const sites = t.site_name ? t.site_name.split(",").map((s) => s.trim()).filter(Boolean) : [];
                    return (
                      <tr key={t.id}>
                        <td>
                          <div className="rpt-tech-cell">
                            <div className="rpt-avatar" style={{ background: ac.bg, color: ac.color }}>
                              {initials(t.name)}
                            </div>
                            <span style={{ fontWeight: 600 }}>{t.name}</span>
                          </div>
                        </td>
                        <td>
                          {sites.length > 0 ? (
                            <div className="rpt-sites">
                              {sites.map((s) => <span key={s} className="rpt-site-tag">{s}</span>)}
                            </div>
                          ) : (
                            <span style={{ color: "var(--text-faint)" }}>—</span>
                          )}
                        </td>
                        <td>{t.journey_hours > 0 ? formatHours(t.journey_hours) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                        <td style={{ fontWeight: 600 }}>{formatHours(t.worked_hours)}</td>
                        <td>{t.completed_count}</td>
                        <td>
                          {pct != null ? (
                            <div className="rpt-util-cell">
                              <div className="rpt-util-bar">
                                <div
                                  className="rpt-util-fill"
                                  style={{ width: `${Math.min(100, pct / maxUtilPct * 100)}%`, background: utilColor(pct) }}
                                />
                              </div>
                              <span style={{ color: utilTextColor(pct), fontWeight: 600, minWidth: 50, textAlign: "right", fontSize: 12 }}>
                                {pct}%
                              </span>
                            </div>
                          ) : (
                            <span className="rpt-no-journey">Sem jornada</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {technicians.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
            </div>
          </div>


          {/* ⑤ Tabela Tipo de Atividade com barras de tempo */}
          <div className="ops-pool-card">
            <div className="ops-card-head">
              <div className="ops-card-title">Tempo por Tipo de Atividade — Histórico</div>
              <div className="ops-card-hint">{activities.length} atividades do cadastro mestre</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Atividade</th>
                    <th>Execuções</th>
                    <th>Tempo Médio</th>
                    <th>Melhor Tempo</th>
                  </tr>
                </thead>
                <tbody>
                  {activitiesSlice.map((a, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 600 }}>{a.name}</td>
                      <td>{a.executions}</td>
                      <td>
                        {a.avg_hours > 0 ? (
                          <div className="rpt-time-cell">
                            <div className="rpt-time-bar">
                              <div
                                className="rpt-time-fill"
                                style={{ width: `${(a.avg_hours / maxActivityHours) * 100}%` }}
                              />
                            </div>
                            <span>{formatHours(a.avg_hours)}</span>
                          </div>
                        ) : (
                          <span style={{ color: "var(--text-faint)" }}>0min</span>
                        )}
                      </td>
                      <td>
                        {a.best_hours > 0 ? (
                          <span className="rpt-best-badge">{formatHours(a.best_hours)}</span>
                        ) : (
                          <span style={{ color: "var(--text-faint)" }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activities.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
              {activities.length > 0 && (
                <Pagination
                  page={activitiesPage}
                  pageSize={activitiesPageSize}
                  total={activities.length}
                  onPageChange={setActivitiesPage}
                  onPageSizeChange={(size) => { setActivitiesPageSize(size); setActivitiesPage(1); }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
