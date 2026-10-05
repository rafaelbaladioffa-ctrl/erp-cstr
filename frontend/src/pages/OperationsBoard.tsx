import { useEffect, useRef, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsBoard as OperationsBoardData, OperationsBoardTechnician, StatusEvent, TimelineBlock } from "../api/types";
import TechnicianAbsenceFormModal from "../components/projects/TechnicianAbsenceFormModal";
import DateInput from "../components/ui/DateInput";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import { useI18n, usePageText } from "../i18n";
import {
  AWAY_STATUSES,
  BUSY_COLOR,
  DONE_COLOR,
  HOURS,
  PRESENCE_COLOR,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  assignLanes,
  buildTechSegments,
  formatTime,
  groupByPair,
  initials,
  pairRowClass,
  pct,
  presenceLabel,
  reorderRowsByPair,
} from "../utils/timeline";

const TEXT = {
  "pt-BR": {
    eyebrow: "Central de Operações",
    title: "Operação do Dia",
    subtitleToday: "Pool de atividades, técnicos e timeline em tempo real",
    subtitleDate: (date: string) => `Visualizando ${date}`,
    today: "Hoje",
    allSites: "Todos os sites",
    statPlanned: "Atividades Planejadas",
    statActive: "Em Execução",
    statCompleted: "Concluídas",
    statPending: "Pendentes",
    statOnSite: "Técnicos no Site",
    statAbsent: "Técnicos Ausentes",
    progressLabel: "Progresso do Dia",
    techCardTitle: "Técnicos",
    techCardHint: (n: number) => `${n} no site hoje`,
    pairLabel: "Dupla",
    statusInProgress: "Em execução",
    statusPaused: "Pausado",
    openTasks: (n: number) => ` · ${n} tarefas abertas`,
    poolTitle: "Pool de Atividades do Dia",
    poolHint: (n: number) => `${n} pendentes`,
    dispatchSelectTech: "Selecione um técnico disponível na coluna ao lado",
    dispatchTechsSelected: (n: number) => `${n} técnico(s) selecionado(s)`,
    dispatching: "Despachando...",
    dispatch: "Despachar",
    colActivity: "Atividade",
    colProject: "Projeto",
    colSite: "Site",
    colDuration: "Duração Est.",
    colStatus: "Status",
    colActions: "Ações",
    badgeDispatched: (names: string) => `Despachada · ${names}`,
    badgeWaiting: "Aguardando despacho",
    dispatchBtn: "Despachar",
    removing: "Removendo...",
    removeDispatch: "Remover Despacho",
    noPoolActivity: "Nenhuma atividade pendente neste site.",
    techniciansLabel: (n: number) => `TÉCNICOS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "finalizada",
    finishedPlural: "finalizadas",
    pendingSingular: "pendente",
    pendingPlural: "pendentes",
    inProgress: " – em andamento",
    closeLabel: "Fechar",
    legendDone: "Concluída",
    legendInProgress: "Em execução",
    legendAvailable: "Disponível",
    legendPaused: "Pausa",
    legendLunch: "Horário de Almoço",
    legendPersonal: "Particular",
    legendMeal: "Refeição",
    legendMeeting: "Reunião",
    legendSiteBlocked: "Sem Acesso ao Site",
    legendAwaiting: "Aguardando Liberações",
    legendNotStarted: "Não iniciado / Fim de Expediente",
    sidePanelTitle: "Próximas atividades / Operações",
    othersLabel: (n: number) => `Outros técnicos (${n})`,
    noQueueActivity: "Nenhuma atividade pendente na fila.",
    viewAll: "Ver todas as atividades do dia",
    footerHint: "Clique em uma atividade para ver detalhes completos.",
    confirmUndispatch: "Remover o despacho dessa tarefa? Os técnicos voltam a ficar disponíveis pro pool.",
    absenceTitle: "Ausências planejadas (férias, atestado, folga)",
    noTechLinked: "Nenhum técnico vinculado a este site.",
    noTechLoggedIn: "Nenhum técnico fez login nesta data.",
    loading: "Carregando...",
  },
  "en-US": {
    eyebrow: "Operations Center",
    title: "Day Operations",
    subtitleToday: "Activity pool, technicians and real-time timeline",
    subtitleDate: (date: string) => `Viewing ${date}`,
    today: "Today",
    allSites: "All sites",
    statPlanned: "Planned Activities",
    statActive: "In Progress",
    statCompleted: "Completed",
    statPending: "Pending",
    statOnSite: "On-Site Technicians",
    statAbsent: "Absent Technicians",
    progressLabel: "Day Progress",
    techCardTitle: "Technicians",
    techCardHint: (n: number) => `${n} on site today`,
    pairLabel: "Pair",
    statusInProgress: "In progress",
    statusPaused: "Paused",
    openTasks: (n: number) => ` · ${n} open tasks`,
    poolTitle: "Day Activity Pool",
    poolHint: (n: number) => `${n} pending`,
    dispatchSelectTech: "Select an available technician in the column to the right",
    dispatchTechsSelected: (n: number) => `${n} technician(s) selected`,
    dispatching: "Dispatching...",
    dispatch: "Dispatch",
    colActivity: "Activity",
    colProject: "Project",
    colSite: "Site",
    colDuration: "Est. Duration",
    colStatus: "Status",
    colActions: "Actions",
    badgeDispatched: (names: string) => `Dispatched · ${names}`,
    badgeWaiting: "Awaiting dispatch",
    dispatchBtn: "Dispatch",
    removing: "Removing...",
    removeDispatch: "Remove Dispatch",
    noPoolActivity: "No pending activities at this site.",
    techniciansLabel: (n: number) => `TECHNICIANS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "completed",
    finishedPlural: "completed",
    pendingSingular: "pending",
    pendingPlural: "pending",
    inProgress: " – in progress",
    closeLabel: "Close",
    legendDone: "Completed",
    legendInProgress: "In progress",
    legendAvailable: "Available",
    legendPaused: "Paused",
    legendLunch: "Lunch Break",
    legendPersonal: "Personal",
    legendMeal: "Meal",
    legendMeeting: "Meeting",
    legendSiteBlocked: "No Site Access",
    legendAwaiting: "Awaiting Releases",
    legendNotStarted: "Not started / End of Shift",
    sidePanelTitle: "Upcoming activities / Operations",
    othersLabel: (n: number) => `Other technicians (${n})`,
    noQueueActivity: "No pending activities in queue.",
    viewAll: "View all activities for the day",
    footerHint: "Click an activity to see full details.",
    confirmUndispatch: "Remove the dispatch for this task? Technicians will return to the pool.",
    absenceTitle: "Planned absences (vacation, sick leave, day off)",
    noTechLinked: "No technician linked to this site.",
    noTechLoggedIn: "No technician has logged in on this date.",
    loading: "Loading...",
  },
  "es-ES": {
    eyebrow: "Central de Operaciones",
    title: "Operación del Día",
    subtitleToday: "Grupo de actividades, técnicos y línea de tiempo en tiempo real",
    subtitleDate: (date: string) => `Visualizando ${date}`,
    today: "Hoy",
    allSites: "Todos los sitios",
    statPlanned: "Actividades Planificadas",
    statActive: "En Ejecución",
    statCompleted: "Completadas",
    statPending: "Pendientes",
    statOnSite: "Técnicos en Sitio",
    statAbsent: "Técnicos Ausentes",
    progressLabel: "Progreso del Día",
    techCardTitle: "Técnicos",
    techCardHint: (n: number) => `${n} en sitio hoy`,
    pairLabel: "Dupla",
    statusInProgress: "En ejecución",
    statusPaused: "Pausado",
    openTasks: (n: number) => ` · ${n} tareas abiertas`,
    poolTitle: "Grupo de Actividades del Día",
    poolHint: (n: number) => `${n} pendientes`,
    dispatchSelectTech: "Seleccione un técnico disponible en la columna de al lado",
    dispatchTechsSelected: (n: number) => `${n} técnico(s) seleccionado(s)`,
    dispatching: "Despachando...",
    dispatch: "Despachar",
    colActivity: "Actividad",
    colProject: "Proyecto",
    colSite: "Sitio",
    colDuration: "Duración Est.",
    colStatus: "Estado",
    colActions: "Acciones",
    badgeDispatched: (names: string) => `Despachada · ${names}`,
    badgeWaiting: "Esperando despacho",
    dispatchBtn: "Despachar",
    removing: "Eliminando...",
    removeDispatch: "Eliminar Despacho",
    noPoolActivity: "No hay actividades pendientes en este sitio.",
    techniciansLabel: (n: number) => `TÉCNICOS (${n})`,
    rowStats: (done: number, doneLabel: string, pending: number, pendingLabel: string) =>
      `${done} ${doneLabel} · ${pending} ${pendingLabel}`,
    finishedSingular: "finalizada",
    finishedPlural: "finalizadas",
    pendingSingular: "pendiente",
    pendingPlural: "pendientes",
    inProgress: " – en progreso",
    closeLabel: "Cerrar",
    legendDone: "Completada",
    legendInProgress: "En ejecución",
    legendAvailable: "Disponible",
    legendPaused: "Pausa",
    legendLunch: "Hora del Almuerzo",
    legendPersonal: "Personal",
    legendMeal: "Comida",
    legendMeeting: "Reunión",
    legendSiteBlocked: "Sin Acceso al Sitio",
    legendAwaiting: "Esperando Liberaciones",
    legendNotStarted: "No iniciado / Fin de Jornada",
    sidePanelTitle: "Próximas actividades / Operaciones",
    othersLabel: (n: number) => `Otros técnicos (${n})`,
    noQueueActivity: "No hay actividades pendientes en la cola.",
    viewAll: "Ver todas las actividades del día",
    footerHint: "Haga clic en una actividad para ver los detalles completos.",
    confirmUndispatch: "¿Eliminar el despacho de esta tarea? Los técnicos volverán a estar disponibles en el grupo.",
    absenceTitle: "Ausencias planificadas (vacaciones, baja médica, día libre)",
    noTechLinked: "Ningún técnico vinculado a este sitio.",
    noTechLoggedIn: "Ningún técnico inició sesión en esta fecha.",
    loading: "Cargando...",
  },
};

function formatElapsed(startIso: string | null, now: number) {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function OperationsBoard() {
  const p = usePageText(TEXT);
  const { locale } = useI18n();
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "all" | null>("all");
  const [board, setBoard] = useState<OperationsBoardData | null>(null);
  const [timelineByTech, setTimelineByTech] = useState<
    Record<number, { blocks: TimelineBlock[]; statusEvents: StatusEvent[] }>
  >({});
  const [loading, setLoading] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [undispatchingId, setUndispatchingId] = useState<number | null>(null);
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [selectedTechs, setSelectedTechs] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [todPopup, setTodPopup] = useState<{ key: string; label: string; start: Date; end: Date | null; color: string; top: number; left: number } | null>(null);
  const todPopupRef = useRef<HTMLDivElement>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [absenceTech, setAbsenceTech] = useState<{ id: number; name: string } | null>(null);
  const [dragTaskId, setDragTaskId] = useState<number | null>(null);
  const [dragOverTechId, setDragOverTechId] = useState<number | null>(null);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const isToday = selectedDate === todayStr;

  useEffect(() => {
    sitesApi.list().then((data) => {
      setSites(data.results);
    });
  }, []);

  function loadAll(site: number | "all", date?: string) {
    setLoading(true);
    const dateParam = date && date !== todayStr ? date : undefined;
    Promise.all([
      operationsApi.board(site, dateParam).then(setBoard),
      operationsApi.timeline(site, dateParam).then((data) => {
        const map: Record<number, { blocks: TimelineBlock[]; statusEvents: StatusEvent[] }> = {};
        for (const t of data.technicians) map[t.id] = { blocks: t.blocks, statusEvents: t.status_events };
        setTimelineByTech(map);
      }),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    if (siteId == null) return;
    loadAll(siteId, selectedDate);
    // Auto-refresh apenas no dia atual
    if (selectedDate === todayStr) {
      const timer = setInterval(() => loadAll(siteId, selectedDate), 20000);
      return () => clearInterval(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, selectedDate]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setTodPopup(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function toggleTech(techId: number, available: boolean) {
    if (!available) return;
    const tech = (board?.technicians || []).find((t) => t.id === techId);
    const partnerId = tech?.pair_partner?.id;
    const ids = partnerId != null ? [techId, partnerId] : [techId];
    setSelectedTechs((prev) => {
      const isSelected = prev.includes(techId);
      return isSelected ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])];
    });
  }

  function selectTask(taskId: number) {
    setSelectedTask((prev) => (prev === taskId ? null : taskId));
    setSelectedTechs([]);
  }

  async function dispatch() {
    if (selectedTask == null || selectedTechs.length === 0) return;
    setDispatching(true);
    try {
      await operationsApi.dispatch(selectedTask, selectedTechs);
      setSelectedTask(null);
      setSelectedTechs([]);
      if (siteId != null) loadAll(siteId, selectedDate);
    } finally {
      setDispatching(false);
    }
  }

  async function handleUndispatch(taskId: number) {
    if (!confirm(p.confirmUndispatch)) return;
    setUndispatchingId(taskId);
    try {
      await operationsApi.undispatch(taskId);
      if (siteId != null) loadAll(siteId, selectedDate);
    } finally {
      setUndispatchingId(null);
    }
  }

  const technicians = board?.technicians || [];
  const pool = board?.pool || [];
  const stats = board?.stats;
  const nowDate = isToday ? new Date(now) : new Date(selectedDate + "T18:00:00");
  const base = isToday ? nowDate : new Date(selectedDate + "T07:00:00");
  const nowPct = pct(nowDate, base);
  const techRows = reorderRowsByPair(
    technicians
      .filter((tech) => !tech.on_leave && tech.presence_status !== "not_started")
      .map((tech) => {
      const { blocks = [], statusEvents = [] } = timelineByTech[tech.id] || {};
      const segments = buildTechSegments(blocks, statusEvents, nowDate, true, locale);
      const lanedSegments = assignLanes(segments);
      return {
        tech,
        lanedSegments,
        laneCount: lanedSegments[0]?.laneCount ?? 1,
        doneCount: blocks.filter((b) => b.status === "completed").length,
        pendingCount: tech.queue.length,
      };
    })
  );

  const windowEnd = new Date(base);
  windowEnd.setHours(WINDOW_END_HOUR, 0, 0, 0);

  const NOT_STARTED_DURATION_MS = 1.5 * 60 * 60 * 1000;
  function notStartedBars(row: (typeof techRows)[number]) {
    if (row.tech.queue.length === 0) return [];
    let lane = 0;
    let cursor = nowDate;
    if (row.lanedSegments.length > 0) {
      for (const { segment, lane: segLane } of row.lanedSegments) {
        const end = segment.end ?? nowDate;
        if (end >= cursor) {
          cursor = end;
          lane = segLane;
        }
      }
    }
    const bars: { key: number; label: string; start: Date; end: Date; lane: number }[] = [];
    for (const q of row.tech.queue) {
      if (cursor >= windowEnd) break;
      const end = new Date(Math.min(cursor.getTime() + NOT_STARTED_DURATION_MS, windowEnd.getTime()));
      bars.push({ key: q.task_id, label: q.task_name, start: cursor, end, lane });
      cursor = end;
    }
    return bars;
  }

  const techsWithQueue = technicians.filter((t) => t.queue.length > 0).sort((a, b) => b.queue.length - a.queue.length);
  const expandedGroups = techsWithQueue.slice(0, 3);
  const otherGroups = techsWithQueue.slice(3);

  const techStatusLabel = (tech: OperationsBoardTechnician) => {
    const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
    const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
    const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
    if (hasInProgress) return p.statusInProgress;
    if (hasPaused && !pausedAway) return p.statusPaused;
    return presenceLabel(tech.presence_status, locale, tech.presence_status_display);
  };

  const techStatusColor = (tech: OperationsBoardTechnician) => {
    const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
    const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
    const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
    if (hasInProgress) return BUSY_COLOR.in_progress;
    if (hasPaused && !pausedAway) return BUSY_COLOR.paused;
    return PRESENCE_COLOR[tech.presence_status];
  };

  return (
    <div>
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={
          isToday
            ? p.subtitleToday
            : p.subtitleDate(
                new Date(selectedDate + "T12:00:00").toLocaleDateString(locale, {
                  weekday: "long",
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })
              )
        }
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <button
                className="btn btn-outline btn-sm"
                style={{ padding: "4px 8px" }}
                onClick={() => {
                  const d = new Date(selectedDate + "T12:00:00");
                  d.setDate(d.getDate() - 1);
                  setSelectedDate(d.toISOString().slice(0, 10));
                }}
              >
                <Icon name="chevron_left" style={{ fontSize: 16 }} />
              </button>
              <DateInput
                value={selectedDate}
                onChange={(v) => setSelectedDate(v || todayStr)}
                className="btn btn-outline btn-sm"
                style={{ minWidth: 130 }}
              />
              <button
                className="btn btn-outline btn-sm"
                style={{ padding: "4px 8px" }}
                disabled={isToday}
                onClick={() => {
                  const d = new Date(selectedDate + "T12:00:00");
                  d.setDate(d.getDate() + 1);
                  const next = d.toISOString().slice(0, 10);
                  setSelectedDate(next > todayStr ? todayStr : next);
                }}
              >
                <Icon name="chevron_right" style={{ fontSize: 16 }} />
              </button>
              {!isToday && (
                <button className="btn btn-outline btn-sm" onClick={() => setSelectedDate(todayStr)}>
                  {p.today}
                </button>
              )}
            </div>
            <select
              className="select"
              value={siteId ?? ""}
              onChange={(e) => setSiteId(e.target.value === "all" ? "all" : Number(e.target.value))}
            >
              <option value="all">{p.allSites}</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {loading && !board ? (
        <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>
      ) : (
        <>
          <div className="ops-stat-row">
            <div className="stat-grid" style={{ flex: 1, marginBottom: 0, gridTemplateColumns: "repeat(6, 1fr)" }}>
              <StatCard label={p.statPlanned} value={stats?.planned ?? 0} />
              <StatCard label={p.statActive} value={stats?.active ?? 0} />
              <StatCard label={p.statCompleted} value={stats?.completed ?? 0} />
              <StatCard label={p.statPending} value={stats?.pending ?? 0} />
              <StatCard label={p.statOnSite} value={stats?.technicians_on_site ?? 0} />
              <StatCard label={p.statAbsent} value={stats?.technicians_absent ?? 0} />
            </div>
            <div className="ops-progress-card">
              <div className="ops-progress-ring" style={{ ["--pct" as string]: stats?.progress_pct ?? 0 }}>
                <div className="ops-progress-ring-inner">{stats?.progress_pct ?? 0}%</div>
              </div>
              <div className="ops-progress-label">{p.progressLabel}</div>
            </div>
          </div>

          <div className="ops-columns">
            <div className="ops-tech-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setTechOpen((v) => !v)}>
                <div className="ops-card-title">{p.techCardTitle}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{p.techCardHint(technicians.length)}</div>
                  <Icon name={techOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>
              {techOpen && groupByPair(technicians).map(({ primary, partner }) => {
                const rows = partner ? [primary, partner] : [primary];
                const content = rows.map((tech) => {
                  const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
                  const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
                  const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
                  const busyStatus = hasInProgress ? "in_progress" : hasPaused && !pausedAway ? "paused" : undefined;
                  const dotColor = pausedAway
                    ? PRESENCE_COLOR[tech.presence_status]
                    : busyStatus
                      ? BUSY_COLOR[busyStatus]
                      : PRESENCE_COLOR[tech.presence_status];
                  const dispatchable = !tech.on_leave && tech.presence_status !== "not_started" && tech.presence_status !== "off_duty";
                  const selectable = selectedTask != null && dispatchable;
                  const isSelected = selectedTechs.includes(tech.id);
                  const droppable = !tech.on_leave && dragTaskId != null;
                  return (
                    <div
                      key={tech.id}
                      className={`ops-tech-row${selectable ? " selectable" : ""}${isSelected ? " selected" : ""}${
                        tech.on_leave || tech.presence_status === "off_duty" || tech.presence_status === "not_started" ? " dim" : ""
                      }${dragOverTechId === tech.id ? " drag-over" : ""}`}
                      onClick={() => toggleTech(tech.id, selectable)}
                      onDragOver={(e) => {
                        if (!droppable) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDragOverTechId(tech.id);
                      }}
                      onDragLeave={(e) => {
                        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDragOverTechId(null);
                      }}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setDragOverTechId(null);
                        if (dragTaskId == null || tech.on_leave) return;
                        const techIds = tech.pair_partner ? [tech.id, tech.pair_partner.id] : [tech.id];
                        setDispatching(true);
                        try {
                          await operationsApi.dispatch(dragTaskId, techIds);
                          setDragTaskId(null);
                          if (siteId != null) loadAll(siteId);
                        } finally {
                          setDispatching(false);
                        }
                      }}
                    >
                      <div className="ops-avatar">
                        {initials(tech.name)}
                        <span className="ops-avatar-dot" style={{ background: dotColor }} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="ops-tech-name">
                          {tech.name}
                          {siteId === "all" && <span className="ops-tech-site"> · {tech.site_name}</span>}
                        </div>
                        <div className="ops-tech-status" style={{ color: dotColor }}>
                          {busyStatus === "in_progress"
                            ? p.statusInProgress
                            : busyStatus === "paused"
                              ? p.statusPaused
                              : presenceLabel(tech.presence_status, locale, tech.presence_status_display)}
                          {tech.current_tasks.length > 1 && p.openTasks(tech.current_tasks.length)}
                        </div>
                        {tech.current_tasks.map((t) => (
                          <div key={t.id} className="ops-tech-current">
                            {t.status === "paused" ? "⏸ " : ""}
                            {t.name}
                            {t.status === "in_progress" && t.actual_start && (
                              <span className="ops-tech-timer"> · {formatElapsed(t.actual_start, now)}</span>
                            )}
                          </div>
                        ))}
                        {tech.queue.length > 0 && (
                          <div className="ops-queue-row">
                            {tech.queue.map((q, idx) => (
                              <span key={q.task_id} className="ops-queue-chip" title={q.task_name}>
                                <span className="ops-queue-num">{idx + 1}</span>
                                {q.task_name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        className="ops-tech-absence-btn"
                        title={p.absenceTitle}
                        onClick={(e) => {
                          e.stopPropagation();
                          setAbsenceTech({ id: tech.id, name: tech.name });
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: "var(--text-faint)",
                          display: "flex",
                          alignItems: "center",
                          padding: 4,
                        }}
                      >
                        <Icon name="event_busy" style={{ fontSize: 18 }} />
                      </button>
                    </div>
                  );
                });
                if (!partner) return content;
                return (
                  <div key={primary.id} className="ops-pair-group">
                    <div className="ops-pair-label">
                      <Icon name="groups" style={{ fontSize: 13 }} />
                      {p.pairLabel}
                    </div>
                    {content}
                  </div>
                );
              })}
              {techOpen && technicians.length === 0 && <div className="empty-state">{p.noTechLinked}</div>}
            </div>

            <div className="ops-pool-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setPoolOpen((v) => !v)}>
                <div className="ops-card-title">{p.poolTitle}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{p.poolHint(pool.length)}</div>
                  <Icon name={poolOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>
              {poolOpen && (
                <>
                  {selectedTask != null && (
                    <div className="ops-dispatch-bar">
                      <span className="ops-dispatch-bar-text">
                        {selectedTechs.length === 0
                          ? p.dispatchSelectTech
                          : p.dispatchTechsSelected(selectedTechs.length)}
                      </span>
                      <button className="btn btn-primary btn-sm" disabled={selectedTechs.length === 0 || dispatching} onClick={dispatch}>
                        {dispatching ? p.dispatching : p.dispatch}
                      </button>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{p.colActivity}</th>
                          <th>{p.colProject}</th>
                          {siteId === "all" && <th>{p.colSite}</th>}
                          <th>{p.colDuration}</th>
                          <th>{p.colStatus}</th>
                          <th>{p.colActions}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pool.map((task) => (
                          <tr
                            key={task.id}
                            draggable={true}
                            onDragStart={(e) => {
                              setDragTaskId(task.id);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("taskId", String(task.id));
                            }}
                            onDragEnd={() => { setDragTaskId(null); setDragOverTechId(null); }}
                            onClick={() => selectTask(task.id)}
                            style={{
                              cursor: "grab",
                              background: selectedTask === task.id ? "var(--orange-soft)" : dragTaskId === task.id ? "var(--bg)" : undefined,
                              opacity: dragTaskId === task.id ? 0.5 : 1,
                            }}
                          >
                            <td style={{ fontWeight: 700 }}>{task.name}</td>
                            <td>
                              {task.project_name} {task.project_code ? `· ${task.project_code}` : ""}
                            </td>
                            {siteId === "all" && <td>{task.site_name}</td>}
                            <td>{task.estimated_hours ? `${task.estimated_hours}h` : "—"}</td>
                            <td>
                              {task.assignees.length > 0 ? (
                                <span className="badge" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                                  {p.badgeDispatched(task.assignees.map((a) => a.name).join(", "))}
                                </span>
                              ) : (
                                <span className="badge" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
                                  {p.badgeWaiting}
                                </span>
                              )}
                            </td>
                            <td>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    selectTask(task.id);
                                  }}
                                >
                                  {p.dispatchBtn}
                                </button>
                                {task.assignees.length > 0 && (
                                  <button
                                    className="btn btn-outline btn-sm"
                                    style={{ color: "var(--red)" }}
                                    disabled={undispatchingId === task.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUndispatch(task.id);
                                    }}
                                  >
                                    {undispatchingId === task.id ? p.removing : p.removeDispatch}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pool.length === 0 && <div className="table-empty">{p.noPoolActivity}</div>}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="tod-layout" style={{ marginTop: 16 }}>
            <div className="tod-tech-panel">
              <div className="tod-panel-head">
                <div className="tod-tech-title">{p.techniciansLabel(techRows.length)}</div>
                <div className="tod-ruler">
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      className="tod-ruler-tick"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    >
                      {String(h).padStart(2, "0")}:00
                    </span>
                  ))}
                </div>
              </div>
              <div className="tod-body">
                <div className="tod-overlay">
                  {HOURS.slice(1, -1).map((h) => (
                    <div
                      key={h}
                      className="tod-gridline"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    />
                  ))}
                  <div className="tod-now-line" style={{ left: `${nowPct}%` }}>
                    <div className="tod-now-tag">
                      {nowDate.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="tod-now-dot" />
                  </div>
                </div>

                {techRows.map(({ tech, lanedSegments, laneCount, doneCount, pendingCount }, rowIdx) => {
                  const badgeColor = techStatusColor(tech);
                  const badgeLabel = techStatusLabel(tech);
                  const rowHeight = laneCount <= 1 ? 88 : 36 + laneCount * 52;
                  const barH = 22;
                  const barT = (lane: number) => 8 + lane * 52;
                  const notStarted = notStartedBars({ tech, lanedSegments, laneCount, doneCount, pendingCount });
                  const doneLabel = doneCount === 1 ? p.finishedSingular : p.finishedPlural;
                  const pendLabel = pendingCount === 1 ? p.pendingSingular : p.pendingPlural;
                  return (
                    <div
                      key={tech.id}
                      className={`tod-row ${pairRowClass(techRows, rowIdx)}`}
                      style={{ minHeight: rowHeight }}
                      onClick={() => setTodPopup(null)}
                    >
                      <div className="tod-row-info">
                        <div className="tod-row-name-line">
                          <div className="tod-row-avatar">
                            {initials(tech.name)}
                            <span className="tod-row-avatar-dot" style={{ background: badgeColor }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="tod-row-name">{tech.name}</div>
                            <span
                              className="tod-status-badge"
                              style={{ background: `color-mix(in srgb, ${badgeColor} 16%, white)`, color: badgeColor }}
                            >
                              {badgeLabel}
                            </span>
                          </div>
                        </div>
                        <div className="tod-row-sites">{tech.site_name}</div>
                        <div className="tod-row-stats">
                          {doneCount} {doneLabel} · {pendingCount} {pendLabel}
                        </div>
                      </div>
                      {lanedSegments.length === 0 && notStarted.length === 0 ? (
                        <div className="tod-empty-row">{presenceLabel(tech.presence_status, locale, tech.presence_status_display)}</div>
                      ) : (
                        <div className="tod-track" style={{ minHeight: rowHeight - 20 }}>
                          {lanedSegments.map(({ segment, lane }, idx) => {
                            const left = pct(segment.start, base);
                            const rightPct = segment.end ? pct(segment.end, base) : nowPct;
                            const width = Math.max(1, rightPct - left);
                            const barKey = `${tech.id}-seg-${idx}`;
                            return (
                              <div
                                key={idx}
                                className={`tod-bar${todPopup?.key === barKey ? " expanded" : ""}`}
                                title={segment.label}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTodPopup((prev) =>
                                    prev?.key === barKey
                                      ? null
                                      : { key: barKey, label: segment.label, start: segment.start, end: segment.end ?? null, color: segment.color, top: rect.bottom + 6, left: rect.left }
                                  );
                                }}
                                style={{ left: `${left}%`, width: `${width}%`, top: barT(lane), height: barH, background: segment.color }}
                              >
                                <span className="tod-bar-label">{segment.label}</span>
                              </div>
                            );
                          })}
                          {notStarted.map((bar) => {
                            const barKey = `${tech.id}-ns-${bar.key}`;
                            return (
                              <div
                                key={bar.key}
                                className={`tod-bar tod-bar-notstarted${todPopup?.key === barKey ? " expanded" : ""}`}
                                title={bar.label}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTodPopup((prev) =>
                                    prev?.key === barKey
                                      ? null
                                      : { key: barKey, label: bar.label, start: bar.start, end: bar.end, color: "transparent", top: rect.bottom + 6, left: rect.left }
                                  );
                                }}
                                style={{
                                  left: `${pct(bar.start, base)}%`,
                                  width: `${Math.max(1, pct(bar.end, base) - pct(bar.start, base))}%`,
                                  top: barT(bar.lane),
                                  height: barH,
                                }}
                              >
                                <span className="tod-bar-label">{bar.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {techRows.length === 0 && (
                <div className="empty-state">{technicians.length === 0 ? p.noTechLinked : p.noTechLoggedIn}</div>
              )}
              <div className="tl-legend-row tod-legend-row">
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: DONE_COLOR }} />
                  {p.legendDone}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.in_progress }} />
                  {p.legendInProgress}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.available }} />
                  {p.legendAvailable}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.paused }} />
                  {p.legendPaused}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.lunch }} />
                  {p.legendLunch}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.personal }} />
                  {p.legendPersonal}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meal }} />
                  {p.legendMeal}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.meeting }} />
                  {p.legendMeeting}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.site_blocked }} />
                  {p.legendSiteBlocked}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.awaiting_release }} />
                  {p.legendAwaiting}
                </div>
                <div className="legend-item">
                  <span className="legend-swatch tod-legend-notstarted" />
                  {p.legendNotStarted}
                </div>
              </div>
            </div>

            <div className="tod-side-panel">
              <div className="tod-side-head">
                <div className="tod-side-title">{p.sidePanelTitle}</div>
                <button type="button" className="tod-filter-btn" onClick={() => setPoolOpen(true)} title="Ver pool completo">
                  <Icon name="filter_list" style={{ fontSize: 16 }} />
                </button>
              </div>
              <div className="tod-side-body">
                {expandedGroups.map((tech) => (
                  <div key={tech.id} className="tod-tech-group">
                    <div className="tod-tech-group-head">
                      <div className="tod-tech-group-name">{tech.name}</div>
                      <span className="tod-count-badge">{tech.queue.length}</span>
                    </div>
                    {tech.queue.slice(0, 2).map((q) => (
                      <div key={q.task_id} className="tod-activity-card">
                        <div className="tod-activity-name">{q.task_name}</div>
                        <div className="tod-activity-project">{q.project_name}</div>
                      </div>
                    ))}
                  </div>
                ))}

                {otherGroups.length > 0 && (
                  <div className="tod-others-row" onClick={() => setOthersOpen((v) => !v)}>
                    <span>
                      {p.othersLabel(otherGroups.length)}
                    </span>
                    <Icon name={othersOpen ? "expand_less" : "chevron_right"} style={{ fontSize: 18 }} />
                  </div>
                )}
                {othersOpen &&
                  otherGroups.map((tech) => (
                    <div key={tech.id} className="tod-tech-group" style={{ marginTop: 10 }}>
                      <div className="tod-tech-group-head">
                        <div className="tod-tech-group-name">{tech.name}</div>
                        <span className="tod-count-badge">{tech.queue.length}</span>
                      </div>
                      {tech.queue.slice(0, 2).map((q) => (
                        <div key={q.task_id} className="tod-activity-card">
                          <div className="tod-activity-name">{q.task_name}</div>
                          <div className="tod-activity-project">{q.project_name}</div>
                        </div>
                      ))}
                    </div>
                  ))}
                {techsWithQueue.length === 0 && <div className="empty-state">{p.noQueueActivity}</div>}
              </div>
              <button type="button" className="tod-viewall-link" onClick={() => setPoolOpen(true)}>
                {p.viewAll}
                <Icon name="arrow_forward" style={{ fontSize: 15 }} />
              </button>
            </div>
          </div>
          <div className="tod-footer-hint">{p.footerHint}</div>
        </>
      )}
      {todPopup && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setTodPopup(null)} />
          <div
            ref={todPopupRef}
            className="tl-popup"
            style={{ top: todPopup.top, left: Math.min(todPopup.left, window.innerWidth - 280) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tl-popup-color" style={{ background: todPopup.color }} />
            <div className="tl-popup-body">
              <div className="tl-popup-label">{todPopup.label}</div>
              <div className="tl-popup-time">
                {formatTime(todPopup.start.toISOString())}
                {todPopup.end ? ` – ${formatTime(todPopup.end.toISOString())}` : p.inProgress}
              </div>
            </div>
            <button className="tl-popup-close" onClick={() => setTodPopup(null)} aria-label={p.closeLabel}>×</button>
          </div>
        </>
      )}
      {absenceTech && (
        <TechnicianAbsenceFormModal
          collaboratorId={absenceTech.id}
          collaboratorName={absenceTech.name}
          onClose={() => setAbsenceTech(null)}
          onSaved={() => siteId != null && loadAll(siteId)}
        />
      )}
    </div>
  );
}
