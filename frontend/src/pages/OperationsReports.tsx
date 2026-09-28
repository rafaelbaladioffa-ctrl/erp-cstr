import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsReports } from "../api/types";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";
import Icon from "../components/ui/Icon";

// ── helpers ──────────────────────────────────────────────────────
function todayISO() { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(d: number) { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt.toISOString().slice(0, 10); }
function formatHours(v: number) { const h = Math.floor(v); const m = Math.round((v - h) * 60); if (h === 0 && m === 0) return "0min"; return m > 0 ? `${h}h ${m}min` : `${h}h`; }
function formatClock(iso: string) { return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function initials(name: string) { const p = name.trim().split(" "); return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase(); }
const AVATAR_COLORS = [
  { bg: "var(--blue-soft)", color: "var(--blue)" }, { bg: "var(--purple-soft)", color: "var(--purple)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" }, { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--teal-soft)", color: "var(--teal)" }, { bg: "var(--red-soft)", color: "var(--red)" },
];
function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }
function utilColor(pct: number) { return pct > 300 ? "var(--red)" : pct > 100 ? "var(--amber)" : "var(--green)"; }

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

// ── Drag-and-drop + resize section ───────────────────────────────
const DEFAULT_ORDER = ["kpis", "log-today", "historical", "ranking-improd", "activities"];
const ORDER_KEY = "rpt-section-order-v1";
const HEIGHTS_KEY = "rpt-section-heights-v1";

interface DashSectionProps {
  id: string;
  label: string;
  dragState: { dragging: string | null; over: string | null };
  onDragStart: (id: string) => void;
  onDragOver: (id: string) => void;
  onDrop: () => void;
  onDragEnd: () => void;
  height: number | undefined;
  onHeightChange: (id: string, h: number) => void;
  children: React.ReactNode;
  noCard?: boolean;
}

function DashSection({ id, label, dragState, onDragStart, onDragOver, onDrop, onDragEnd, height, onHeightChange, children, noCard }: DashSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(0);
  const isDraggingOver = dragState.over === id && dragState.dragging !== id;
  const isDragging = dragState.dragging === id;

  const onResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizeStartY.current = e.clientY;
    resizeStartH.current = containerRef.current?.getBoundingClientRect().height ?? (height ?? 300);
    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientY - resizeStartY.current;
      const newH = Math.max(120, resizeStartH.current + delta);
      onHeightChange(id, newH);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [id, height, onHeightChange]);

  const inner = (
    <div
      className={`dash-section-inner${isDraggingOver ? " dash-drop-target" : ""}${isDragging ? " dash-dragging" : ""}`}
      ref={containerRef}
      style={height ? { minHeight: height, height } : undefined}
    >
      {/* Drag handle bar */}
      <div
        className="dash-drag-handle"
        draggable
        onDragStart={(e) => { e.stopPropagation(); onDragStart(id); }}
        onDragEnd={onDragEnd}
        title={`Arrastar: ${label}`}
      >
        <Icon name="drag_indicator" style={{ fontSize: 16, color: "var(--text-faint)" }} />
        <span className="dash-drag-label">{label}</span>
      </div>
      {/* Content */}
      <div className="dash-section-content">{children}</div>
      {/* Resize handle */}
      <div className="dash-resize-handle" onMouseDown={onResizeMouseDown} title="Redimensionar">
        <div className="dash-resize-grip" />
      </div>
    </div>
  );

  return (
    <div
      className="dash-section"
      onDragOver={(e) => { e.preventDefault(); onDragOver(id); }}
      onDrop={onDrop}
    >
      {noCard ? inner : inner}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
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

  // Grid state
  const [sectionOrder, setSectionOrder] = useState<string[]>(() => {
    try { const s = localStorage.getItem(ORDER_KEY); return s ? JSON.parse(s) : DEFAULT_ORDER; }
    catch { return DEFAULT_ORDER; }
  });
  const [sectionHeights, setSectionHeights] = useState<Record<string, number>>(() => {
    try { const s = localStorage.getItem(HEIGHTS_KEY); return s ? JSON.parse(s) : {}; }
    catch { return {}; }
  });
  const [dragState, setDragState] = useState<{ dragging: string | null; over: string | null }>({ dragging: null, over: null });

  const handleDragStart = useCallback((id: string) => setDragState({ dragging: id, over: null }), []);
  const handleDragOver  = useCallback((id: string) => setDragState((s) => ({ ...s, over: id })), []);
  const handleDragEnd   = useCallback(() => setDragState({ dragging: null, over: null }), []);
  const handleDrop      = useCallback(() => {
    setDragState((s) => {
      if (!s.dragging || !s.over || s.dragging === s.over) return { dragging: null, over: null };
      const next = [...sectionOrder];
      const from = next.indexOf(s.dragging);
      const to   = next.indexOf(s.over);
      if (from !== -1 && to !== -1) { next.splice(from, 1); next.splice(to, 0, s.dragging); }
      setSectionOrder(next);
      try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch {}
      return { dragging: null, over: null };
    });
  }, [sectionOrder]);

  const handleHeightChange = useCallback((id: string, h: number) => {
    setSectionHeights((prev) => {
      const next = { ...prev, [id]: h };
      try { localStorage.setItem(HEIGHTS_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const sectionProps = (id: string, label: string) => ({
    id, label, dragState, onDragStart: handleDragStart, onDragOver: handleDragOver,
    onDrop: handleDrop, onDragEnd: handleDragEnd,
    height: sectionHeights[id], onHeightChange: handleHeightChange,
  });

  // Data
  useEffect(() => { sitesApi.list().then((r) => setSites(r.results)); }, []);
  useEffect(() => {
    setLoading(true);
    operationsApi.reports(siteId, dateFrom, dateTo).then(setData).finally(() => setLoading(false));
  }, [siteId, dateFrom, dateTo]);
  useEffect(() => { setActivitiesPage(1); }, [siteId, dateFrom, dateTo]);

  const stats = data?.stats;
  const technicians = data?.technicians || [];
  const activities = data?.activities || [];
  const activitiesSlice = activities.slice((activitiesPage - 1) * activitiesPageSize, activitiesPage * activitiesPageSize);
  const todayTechnicians = data?.today_technicians || [];
  const unproductiveByReason = data?.unproductive_by_reason || [];
  const logEntries = data?.log_entries || [];
  const maxReasonHours = Math.max(1, ...unproductiveByReason.map((r) => r.hours));
  const totalUnproductiveHours = unproductiveByReason.reduce((s, r) => s + r.hours, 0);
  const maxActivityHours = Math.max(1, ...activities.filter((a) => a.avg_hours > 0).map((a) => a.avg_hours));
  const filteredLog = useMemo(() => logFilter === "all" ? logEntries : logEntries.filter((e) => detectLogType(e.text) === logFilter), [logEntries, logFilter]);
  const rankedTechs = useMemo(() => [...technicians].filter((t) => t.utilization_pct != null).sort((a, b) => (b.utilization_pct ?? 0) - (a.utilization_pct ?? 0)), [technicians]);
  const maxUtilPct = Math.max(1, rankedTechs[0]?.utilization_pct ?? 1);

  // ── Section renderers ─────────────────────────────────────────
  const sections: Record<string, { label: string; node: React.ReactNode }> = {
    kpis: {
      label: "KPI Cards",
      node: (
        <div className="stat-grid">
          <div className="rpt-kpi-card">
            <div className="rpt-kpi-top"><span className="rpt-kpi-label">Utilização Média</span><span className="rpt-kpi-icon" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>⚡</span></div>
            <div className="rpt-kpi-value" style={{ color: (stats?.avg_utilization_pct ?? 0) > 300 ? "var(--red)" : "var(--text)" }}>{stats?.avg_utilization_pct ?? 0}%</div>
            <div className="rpt-kpi-hint">Média dos técnicos no período</div>
          </div>
          <div className="rpt-kpi-card">
            <div className="rpt-kpi-top"><span className="rpt-kpi-label">Horas Produtivas Hoje</span><span className="rpt-kpi-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>✓</span></div>
            <div className="rpt-kpi-value" style={{ color: "var(--green)" }}>{formatHours(stats?.today_productive_hours ?? 0)}</div>
            {(stats?.today_productive_hours ?? 0) > 0 ? (
              <><div className="rpt-kpi-bar"><div className="rpt-kpi-bar-fill" style={{ width: `${Math.min(100, ((stats?.today_productive_hours ?? 0) / 6) * 100)}%`, background: "var(--green)" }} /></div>
              <div className="rpt-kpi-hint">{Math.round(((stats?.today_productive_hours ?? 0) / 6) * 100)}% da meta diária (6h)</div></>
            ) : <div className="rpt-kpi-hint">Nenhuma hora produtiva registrada hoje</div>}
          </div>
          <div className="rpt-kpi-card">
            <div className="rpt-kpi-top"><span className="rpt-kpi-label">Horas Improdutivas Hoje</span><span className="rpt-kpi-icon" style={{ background: (stats?.today_unproductive_hours ?? 0) === 0 ? "var(--green-soft)" : "var(--red-soft)", color: (stats?.today_unproductive_hours ?? 0) === 0 ? "var(--green)" : "var(--red)" }}>{(stats?.today_unproductive_hours ?? 0) === 0 ? "✓" : "!"}</span></div>
            <div className="rpt-kpi-value" style={{ color: (stats?.today_unproductive_hours ?? 0) > 0.5 ? "var(--red)" : "var(--green)" }}>{formatHours(stats?.today_unproductive_hours ?? 0)}</div>
            <div className="rpt-kpi-hint">{(stats?.today_unproductive_hours ?? 0) === 0 ? "Zerado hoje — ótimo resultado" : "Limite recomendado: 30min"}</div>
          </div>
          <div className="rpt-kpi-card">
            <div className="rpt-kpi-top"><span className="rpt-kpi-label">Concluídas no Mês</span><span className="rpt-kpi-icon" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>📋</span></div>
            <div className="rpt-kpi-value">{stats?.completed_this_month ?? 0}</div>
            <div className="rpt-kpi-hint">Tarefas concluídas no mês corrente</div>
          </div>
        </div>
      ),
    },

    "log-today": {
      label: "Log + Desempenho Hoje",
      node: (
        <div className="reports-two-col">
          {/* Log */}
          <div className="ops-pool-card">
            <div className="ops-card-head">
              <div><div className="ops-card-title">Log Automático — Hoje</div><div className="ops-card-hint">Gerado pelo sistema a cada mudança de status</div></div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{logEntries.length} eventos</div>
            </div>
            <div className="log-filter-row">
              {(["all", "concluiu", "despacho", "inicio", "status"] as LogType[]).map((f) => (
                <button key={f} className={`log-filter-chip${logFilter === f ? " active" : ""}`} onClick={() => setLogFilter(f)}>
                  {f === "all" ? "Todos" : LOG_TYPE_META[f].label}
                  {f !== "all" && <span className="log-filter-count">{logEntries.filter((e) => detectLogType(e.text) === f).length}</span>}
                </button>
              ))}
            </div>
            <div className="log-feed">
              {filteredLog.map((e, idx) => { const type = detectLogType(e.text); const meta = LOG_TYPE_META[type]; return (
                <div key={idx} className="log-item"><span className="log-dot" style={{ background: meta.color }} /><div className="log-time">{formatClock(e.at)}</div><div className="log-text"><strong>{e.name}</strong> {e.text} <span className={`log-tag ${meta.tag}`}>{meta.label}</span></div></div>
              ); })}
              {filteredLog.length === 0 && <div className="empty-state">Nenhum evento{logFilter !== "all" ? " deste tipo" : ""} registrado hoje.</div>}
            </div>
            <div className="log-legend">
              {(["concluiu", "despacho", "inicio", "status"] as Exclude<LogType, "all">[]).map((t) => (
                <div key={t} className="log-legend-item"><span className="log-legend-dot" style={{ background: LOG_TYPE_META[t].color }} />{LOG_TYPE_META[t].label}</div>
              ))}
            </div>
          </div>
          {/* Hoje */}
          <div className="ops-pool-card">
            <div className="ops-card-head"><div className="ops-card-title">Desempenho por Técnico — Hoje</div><div className="ops-card-hint">{todayTechnicians.length} técnico(s) com atividade hoje</div></div>
            {todayTechnicians.map((t) => {
              const total = t.journey_hours > 0 ? t.journey_hours : t.active_hours + t.available_hours + t.break_hours;
              const safeTotal = total || 1;
              const activePct = Math.min(100, (t.active_hours / safeTotal) * 100);
              const breakPct = Math.min(100 - activePct, (t.break_hours / safeTotal) * 100);
              const avPct = Math.min(100 - activePct - breakPct, (t.available_hours / safeTotal) * 100);
              const ac = avatarColor(t.id);
              return (
                <div key={t.id} className="rpt-today-row">
                  <div className="rpt-today-header">
                    <div className="rpt-today-avatar" style={{ background: ac.bg, color: ac.color }}>{initials(t.name)}</div>
                    <div><div className="rpt-today-name">{t.name}</div>{t.journey_hours > 0 && <div className="rpt-today-sub">Jornada: {formatHours(t.journey_hours)}</div>}</div>
                    {t.utilization_pct != null && <div className="rpt-today-util" style={{ color: utilColor(t.utilization_pct) }}>{t.utilization_pct}%<span className="rpt-today-util-label">utilização</span></div>}
                  </div>
                  <div className="rpt-today-timeline"><div className="rpt-today-bar">
                    <div style={{ width: `${activePct}%`, background: "var(--green)", height: "100%", borderRadius: 2 }} />
                    <div style={{ width: `${breakPct}%`, background: "var(--amber)", height: "100%", opacity: 0.7 }} />
                    <div style={{ width: `${avPct}%`, background: "var(--blue)", height: "100%", opacity: 0.5 }} />
                  </div></div>
                  <div className="rpt-today-metrics">
                    <div className="rpt-today-metric"><span className="rpt-today-metric-dot" style={{ background: "var(--green)" }} /><span className="rpt-today-metric-label">Atividades</span><span className="rpt-today-metric-val">{formatHours(t.active_hours)}</span></div>
                    <div className="rpt-today-metric"><span className="rpt-today-metric-dot" style={{ background: "var(--amber)", opacity: 0.8 }} /><span className="rpt-today-metric-label">Intervalos</span><span className="rpt-today-metric-val">{formatHours(t.break_hours)}</span></div>
                    <div className="rpt-today-metric"><span className="rpt-today-metric-dot" style={{ background: "var(--blue)", opacity: 0.6 }} /><span className="rpt-today-metric-label">Disponível</span><span className="rpt-today-metric-val">{formatHours(t.available_hours)}</span></div>
                  </div>
                </div>
              );
            })}
            {todayTechnicians.length === 0 && <div className="table-empty" style={{ padding: 20 }}>Nenhuma atividade hoje.</div>}
          </div>
        </div>
      ),
    },

    historical: {
      label: "Desempenho Histórico",
      node: (
        <div className="ops-pool-card">
          <div className="ops-card-head"><div className="ops-card-title">Desempenho por Técnico — Histórico</div><div className="ops-card-hint">{technicians.length} técnico(s) com atividade no período</div></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Técnico</th><th>Sites</th><th>Jornada</th><th>Em Atividades</th><th>Concluídas</th><th>Utilização</th></tr></thead>
              <tbody>
                {technicians.map((t) => {
                  const ac = avatarColor(t.id);
                  const pct = t.utilization_pct;
                  const siteList = t.site_name ? t.site_name.split(",").map((s) => s.trim()).filter(Boolean) : [];
                  return (
                    <tr key={t.id}>
                      <td><div className="rpt-tech-cell"><div className="rpt-avatar" style={{ background: ac.bg, color: ac.color }}>{initials(t.name)}</div><span style={{ fontWeight: 600 }}>{t.name}</span></div></td>
                      <td>{siteList.length > 0 ? <div className="rpt-sites">{siteList.map((s) => <span key={s} className="rpt-site-tag">{s}</span>)}</div> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                      <td>{t.journey_hours > 0 ? formatHours(t.journey_hours) : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                      <td style={{ fontWeight: 600 }}>{formatHours(t.worked_hours)}</td>
                      <td>{t.completed_count}</td>
                      <td>{pct != null ? (<div className="rpt-util-cell"><div className="rpt-util-bar"><div className="rpt-util-fill" style={{ width: `${Math.min(100, pct / maxUtilPct * 100)}%`, background: utilColor(pct) }} /></div><span style={{ color: utilColor(pct), fontWeight: 600, minWidth: 50, textAlign: "right", fontSize: 12 }}>{pct}%</span></div>) : <span className="rpt-no-journey">Sem jornada</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {technicians.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
          </div>
        </div>
      ),
    },

    "ranking-improd": {
      label: "Ranking + Horas Improdutivas",
      node: (
        <div className="reports-two-col">
          {rankedTechs.length > 0 && (
            <div className="ops-pool-card">
              <div className="ops-card-head"><div className="ops-card-title">Ranking de Utilização — Período</div><div className="ops-card-hint">Técnicos com jornada cadastrada</div></div>
              <div className="rpt-ranking">
                {rankedTechs.map((t, i) => {
                  const pct = t.utilization_pct!;
                  const ac = avatarColor(t.id);
                  return (
                    <div key={t.id} className="rpt-rank-row">
                      <span className="rpt-rank-num">{i + 1}</span>
                      <div className="rpt-avatar" style={{ background: ac.bg, color: ac.color }}>{initials(t.name)}</div>
                      <span className="rpt-rank-name">{t.name.split(" ")[0]} {t.name.split(" ").slice(-1)[0]}</span>
                      <div className="rpt-rank-bar-wrap"><div className="rpt-rank-bar"><div className="rpt-rank-fill" style={{ width: `${(pct / maxUtilPct) * 100}%`, background: utilColor(pct) }} /></div></div>
                      <span className="rpt-rank-pct" style={{ color: utilColor(pct) }}>{pct}%</span>
                    </div>
                  );
                })}
              </div>
              <div className="rpt-rank-legend">
                <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--red)" }} />Sobrecarga (&gt;300%)</div>
                <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--amber)" }} />Elevado (100–300%)</div>
                <div className="rpt-rank-legend-item"><span className="rpt-rank-legend-dot" style={{ background: "var(--green)" }} />Normal (&lt;100%)</div>
              </div>
            </div>
          )}
          <div className="ops-pool-card">
            <div className="ops-card-head"><div className="ops-card-title">Horas Improdutivas por Motivo — Mês</div><div className="ops-card-hint">Status classificados como improdutivos, mês corrente</div></div>
            <div className="reason-bars">
              {unproductiveByReason.map((r) => (
                <div key={r.status} className="reason-bar-row">
                  <div className="reason-bar-label">{r.status_display}</div>
                  <div className="reason-bar-track"><div className="reason-bar-fill" style={{ width: `${(r.hours / maxReasonHours) * 100}%` }} /></div>
                  <div className="reason-bar-value">{formatHours(r.hours)}</div>
                </div>
              ))}
              {unproductiveByReason.length === 0 && <div className="empty-state">Nenhuma hora improdutiva registrada no mês.</div>}
            </div>
            {totalUnproductiveHours > 40 && (
              <div className="rpt-improd-alert">⚠ {formatHours(totalUnproductiveHours)} de técnicos sem atividade alocada — revisar distribuição de tarefas</div>
            )}
          </div>
        </div>
      ),
    },

    activities: {
      label: "Tempo por Tipo de Atividade",
      node: (
        <div className="ops-pool-card">
          <div className="ops-card-head"><div className="ops-card-title">Tempo por Tipo de Atividade — Histórico</div><div className="ops-card-hint">{activities.length} atividades do cadastro mestre</div></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Atividade</th><th>Execuções</th><th>Tempo Médio</th><th>Melhor Tempo</th></tr></thead>
              <tbody>
                {activitiesSlice.map((a, idx) => (
                  <tr key={idx}>
                    <td style={{ fontWeight: 600 }}>{a.name}</td>
                    <td>{a.executions}</td>
                    <td>{a.avg_hours > 0 ? (<div className="rpt-time-cell"><div className="rpt-time-bar"><div className="rpt-time-fill" style={{ width: `${(a.avg_hours / maxActivityHours) * 100}%` }} /></div><span>{formatHours(a.avg_hours)}</span></div>) : <span style={{ color: "var(--text-faint)" }}>0min</span>}</td>
                    <td>{a.best_hours > 0 ? <span className="rpt-best-badge">{formatHours(a.best_hours)}</span> : <span style={{ color: "var(--text-faint)" }}>—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {activities.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
            {activities.length > 0 && (
              <Pagination page={activitiesPage} pageSize={activitiesPageSize} total={activities.length} onPageChange={setActivitiesPage} onPageSizeChange={(s) => { setActivitiesPageSize(s); setActivitiesPage(1); }} />
            )}
          </div>
        </div>
      ),
    },
  };

  function resetLayout() {
    setSectionOrder(DEFAULT_ORDER);
    setSectionHeights({});
    try { localStorage.removeItem(ORDER_KEY); localStorage.removeItem(HEIGHTS_KEY); } catch {}
  }

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
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={resetLayout} title="Resetar layout dos cards">
              <Icon name="grid_view" style={{ fontSize: 15 }} />
            </button>
          </div>
        }
      />

      {loading && !data ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <div className="dash-grid">
          {sectionOrder.map((id) => {
            const sec = sections[id];
            if (!sec) return null;
            return (
              <DashSection key={id} {...sectionProps(id, sec.label)}>
                {sec.node}
              </DashSection>
            );
          })}
        </div>
      )}
    </div>
  );
}
