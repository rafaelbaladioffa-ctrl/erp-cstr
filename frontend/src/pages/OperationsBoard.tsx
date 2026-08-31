import { useEffect, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsBoard as OperationsBoardData, OperationsBoardTechnician, StatusEvent, TimelineBlock } from "../api/types";
import TechnicianAbsenceFormModal from "../components/projects/TechnicianAbsenceFormModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
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
  reorderRowsByPair,
} from "../utils/timeline";

function techStatusBadge(tech: OperationsBoardTechnician) {
  const hasInProgress = tech.current_tasks.some((t) => t.status === "in_progress");
  const hasPaused = tech.current_tasks.some((t) => t.status === "paused");
  const pausedAway = hasPaused && AWAY_STATUSES.includes(tech.presence_status);
  if (hasInProgress) return { label: "Em execução", color: BUSY_COLOR.in_progress };
  if (hasPaused && !pausedAway) return { label: "Pausado", color: BUSY_COLOR.paused };
  return { label: tech.presence_status_display, color: PRESENCE_COLOR[tech.presence_status] };
}

function formatElapsed(startIso: string | null, now: number) {
  if (!startIso) return "";
  const start = new Date(startIso).getTime();
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}min` : `${m}min`;
}

export default function OperationsBoard() {
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
  const [expandedBar, setExpandedBar] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [othersOpen, setOthersOpen] = useState(false);
  const [absenceTech, setAbsenceTech] = useState<{ id: number; name: string } | null>(null);

  useEffect(() => {
    sitesApi.list().then((data) => {
      setSites(data.results);
    });
  }, []);

  function loadAll(site: number | "all") {
    setLoading(true);
    Promise.all([
      operationsApi.board(site).then(setBoard),
      operationsApi.timeline(site).then((data) => {
        const map: Record<number, { blocks: TimelineBlock[]; statusEvents: StatusEvent[] }> = {};
        for (const t of data.technicians) map[t.id] = { blocks: t.blocks, statusEvents: t.status_events };
        setTimelineByTech(map);
      }),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => {
    if (siteId == null) return;
    loadAll(siteId);
    const timer = setInterval(() => loadAll(siteId), 20000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  function toggleTech(techId: number, available: boolean) {
    if (!available) return;
    // Dupla fixa: selecionar um dos dois já seleciona o parceiro junto
    // (o despacho em conjunto é o padrão — ver CollaboratorPair no backend).
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
      if (siteId != null) loadAll(siteId);
    } finally {
      setDispatching(false);
    }
  }

  async function handleUndispatch(taskId: number) {
    if (!confirm("Remover o despacho dessa tarefa? Os técnicos voltam a ficar disponíveis pro pool.")) return;
    setUndispatchingId(taskId);
    try {
      await operationsApi.undispatch(taskId);
      if (siteId != null) loadAll(siteId);
    } finally {
      setUndispatchingId(null);
    }
  }

  const technicians = board?.technicians || [];
  const pool = board?.pool || [];
  const stats = board?.stats;
  const nowDate = new Date(now);
  const base = nowDate;
  const nowPct = pct(nowDate, base);
  // Um técnico pode ter mais de uma tarefa "aberta" ao mesmo tempo (pausou
  // uma, iniciou outra) — as barras dela empilham verticalmente na mesma
  // linha, e as 3 colunas (nomes/timeline/fila) precisam da MESMA altura de
  // linha pra continuarem alinhadas.
  const techRows = reorderRowsByPair(
    technicians.map((tech) => {
      const { blocks = [], statusEvents = [] } = timelineByTech[tech.id] || {};
      const segments = buildTechSegments(blocks, statusEvents, nowDate, true);
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
  const trackHeight = (count: number) => (count <= 1 ? 52 : 10 + count * 30);
  const barTop = (index: number, count: number) => (count <= 1 ? 8 : 6 + index * 30);
  const barHeight = (count: number) => (count <= 1 ? 36 : 26);

  const windowEnd = new Date(base);
  windowEnd.setHours(WINDOW_END_HOUR, 0, 0, 0);

  // Barras "não iniciado" — uma pra CADA tarefa já despachada e ainda na
  // fila do técnico, emendadas em sequência logo depois da última barra
  // real (na mesma lane, pra não abrir uma linha nova), cada uma com o
  // nome da própria tarefa. Duração fixa de 1h30 por tarefa — não temos
  // horário agendado real pras tarefas da fila, só a ordem (queue_order).
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

  return (
    <div>
      <PageHeader
        eyebrow="Central de Operações"
        title="Operação do Dia"
        subtitle="Pool de atividades, técnicos e timeline em tempo real"
        actions={
          <select
            className="select"
            value={siteId ?? ""}
            onChange={(e) => setSiteId(e.target.value === "all" ? "all" : Number(e.target.value))}
          >
            <option value="all">Todos os sites</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        }
      />

      {loading && !board ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          <div className="ops-stat-row">
            <div className="stat-grid" style={{ flex: 1, marginBottom: 0, gridTemplateColumns: "repeat(6, 1fr)" }}>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Atividades Planejadas</div>
                  <div className="stat-value">{stats?.planned ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>
                  <Icon name="checklist" />
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Em Execução</div>
                  <div className="stat-value">{stats?.active ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                  <Icon name="play_arrow" />
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Concluídas</div>
                  <div className="stat-value">{stats?.completed ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                  <Icon name="check" />
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Pendentes</div>
                  <div className="stat-value">{stats?.pending ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
                  <Icon name="hourglass_empty" />
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Técnicos no Site</div>
                  <div className="stat-value">{stats?.technicians_on_site ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--teal-soft)", color: "var(--teal)" }}>
                  <Icon name="groups" />
                </div>
              </div>
              <div className="stat-card">
                <div>
                  <div className="stat-label">Técnicos Ausentes</div>
                  <div className="stat-value">{stats?.technicians_absent ?? 0}</div>
                </div>
                <div className="stat-icon" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
                  <Icon name="person_off" />
                </div>
              </div>
            </div>
            <div className="ops-progress-card">
              <div className="ops-progress-ring" style={{ ["--pct" as string]: stats?.progress_pct ?? 0 }}>
                <div className="ops-progress-ring-inner">{stats?.progress_pct ?? 0}%</div>
              </div>
              <div className="ops-progress-label">Progresso do Dia</div>
            </div>
          </div>

          <div className="ops-columns">
            <div className="ops-tech-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setTechOpen((v) => !v)}>
                <div className="ops-card-title">Técnicos</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{technicians.length} no site hoje</div>
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
                  return (
                    <div
                      key={tech.id}
                      className={`ops-tech-row${selectable ? " selectable" : ""}${isSelected ? " selected" : ""}${
                        tech.on_leave || tech.presence_status === "off_duty" || tech.presence_status === "not_started" ? " dim" : ""
                      }`}
                      onClick={() => toggleTech(tech.id, selectable)}
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
                            ? "Em execução"
                            : busyStatus === "paused"
                              ? "Pausado"
                              : tech.presence_status_display}
                          {tech.current_tasks.length > 1 && ` · ${tech.current_tasks.length} tarefas abertas`}
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
                        title="Ausências planejadas (férias, atestado, folga)"
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
                      Dupla
                    </div>
                    {content}
                  </div>
                );
              })}
              {techOpen && technicians.length === 0 && <div className="empty-state">Nenhum técnico vinculado a este site.</div>}
            </div>

            <div className="ops-pool-card">
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => setPoolOpen((v) => !v)}>
                <div className="ops-card-title">Pool de Atividades do Dia</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="ops-card-hint">{pool.length} pendentes</div>
                  <Icon name={poolOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>
              {poolOpen && (
                <>
                  {selectedTask != null && (
                    <div className="ops-dispatch-bar">
                      <span className="ops-dispatch-bar-text">
                        {selectedTechs.length === 0
                          ? "Selecione um técnico disponível na coluna ao lado"
                          : `${selectedTechs.length} técnico(s) selecionado(s)`}
                      </span>
                      <button className="btn btn-primary btn-sm" disabled={selectedTechs.length === 0 || dispatching} onClick={dispatch}>
                        {dispatching ? "Despachando..." : "Despachar"}
                      </button>
                    </div>
                  )}
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Atividade</th>
                          <th>Projeto</th>
                          {siteId === "all" && <th>Site</th>}
                          <th>Duração Est.</th>
                          <th>Status</th>
                          <th>Ações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pool.map((task) => (
                          <tr
                            key={task.id}
                            onClick={() => selectTask(task.id)}
                            style={{ cursor: "pointer", background: selectedTask === task.id ? "var(--orange-soft)" : undefined }}
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
                                  Despachada · {task.assignees.map((a) => a.name).join(", ")}
                                </span>
                              ) : (
                                <span className="badge" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>
                                  Aguardando despacho
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
                                  Despachar
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
                                    {undispatchingId === task.id ? "Removendo..." : "Remover Despacho"}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {pool.length === 0 && <div className="table-empty">Nenhuma atividade pendente neste site.</div>}
                  </div>
                </>
              )}
            </div>
          </div>

          <div className="tod-layout" style={{ marginTop: 16 }}>
            <div className="tod-tech-panel">
              <div className="tod-panel-head">
                <div className="tod-tech-title">TÉCNICOS ({technicians.length})</div>
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
                      {nowDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div className="tod-now-dot" />
                  </div>
                </div>

                {techRows.map(({ tech, lanedSegments, laneCount, doneCount, pendingCount }, rowIdx) => {
                  const badge = techStatusBadge(tech);
                  const rowHeight = laneCount <= 1 ? 92 : 30 + laneCount * 46;
                  const notStarted = notStartedBars({ tech, lanedSegments, laneCount, doneCount, pendingCount });
                  return (
                    <div
                      key={tech.id}
                      className={`tod-row ${pairRowClass(techRows, rowIdx)}`}
                      style={{ minHeight: rowHeight }}
                    >
                      <div className="tod-row-info">
                        <div className="tod-row-name-line">
                          <div className="tod-row-avatar">
                            {initials(tech.name)}
                            <span className="tod-row-avatar-dot" style={{ background: badge.color }} />
                          </div>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="tod-row-name">{tech.name}</div>
                            <span
                              className="tod-status-badge"
                              style={{ background: `color-mix(in srgb, ${badge.color} 16%, white)`, color: badge.color }}
                            >
                              {badge.label}
                            </span>
                          </div>
                        </div>
                        <div className="tod-row-sites">{tech.site_name}</div>
                        <div className="tod-row-stats">
                          {doneCount} finalizada{doneCount === 1 ? "" : "s"} · {pendingCount} pendente{pendingCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      {lanedSegments.length === 0 && notStarted.length === 0 ? (
                        <div className="tod-empty-row">{tech.presence_status_display}</div>
                      ) : (
                        <div className="tod-track" style={{ minHeight: rowHeight - 20 }}>
                          {lanedSegments.map(({ segment, lane }, idx) => {
                            const left = pct(segment.start, base);
                            const rightPct = segment.end ? pct(segment.end, base) : nowPct;
                            const width = Math.max(1, rightPct - left);
                            const top = laneCount <= 1 ? 8 : 6 + lane * 46;
                            const height = laneCount <= 1 ? 56 : 40;
                            const barKey = `${tech.id}-seg-${idx}`;
                            const isExpanded = expandedBar === barKey;
                            return (
                              <div
                                key={idx}
                                className={`tod-bar${isExpanded ? " expanded" : ""}`}
                                title={segment.label}
                                onClick={() => setExpandedBar((prev) => (prev === barKey ? null : barKey))}
                                style={{ left: `${left}%`, width: `${width}%`, top, height, background: segment.color }}
                              >
                                <span className="tod-bar-label">{segment.label}</span>
                              </div>
                            );
                          })}
                          {notStarted.map((bar) => {
                            const barKey = `${tech.id}-ns-${bar.key}`;
                            const isExpanded = expandedBar === barKey;
                            return (
                              <div
                                key={bar.key}
                                className={`tod-bar tod-bar-notstarted${isExpanded ? " expanded" : ""}`}
                                title={bar.label}
                                onClick={() => setExpandedBar((prev) => (prev === barKey ? null : barKey))}
                                style={{
                                  left: `${pct(bar.start, base)}%`,
                                  width: `${Math.max(1, pct(bar.end, base) - pct(bar.start, base))}%`,
                                  top: laneCount <= 1 ? 8 : 6 + bar.lane * 46,
                                  height: laneCount <= 1 ? 56 : 40,
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
              {technicians.length === 0 && <div className="empty-state">Nenhum técnico vinculado a este site.</div>}
              <div className="tl-legend-row tod-legend-row">
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: DONE_COLOR }} />
                  Concluída
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.in_progress }} />
                  Em execução
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.available }} />
                  Disponível
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: BUSY_COLOR.paused }} />
                  Pausa
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.lunch }} />
                  Horário de Almoço
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.personal }} />
                  Particular
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.site_blocked }} />
                  Sem Acesso ao Site
                </div>
                <div className="legend-item">
                  <span className="legend-swatch" style={{ background: PRESENCE_COLOR.awaiting_release }} />
                  Aguardando Liberações
                </div>
                <div className="legend-item">
                  <span className="legend-swatch tod-legend-notstarted" />
                  Não iniciado / Fim de Expediente
                </div>
              </div>
            </div>

            <div className="tod-side-panel">
              <div className="tod-side-head">
                <div className="tod-side-title">Próximas atividades / Operações</div>
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
                      Outros técnicos ({otherGroups.length})
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
                {techsWithQueue.length === 0 && <div className="empty-state">Nenhuma atividade pendente na fila.</div>}
              </div>
              <button type="button" className="tod-viewall-link" onClick={() => setPoolOpen(true)}>
                Ver todas as atividades do dia
                <Icon name="arrow_forward" style={{ fontSize: 15 }} />
              </button>
            </div>
          </div>
          <div className="tod-footer-hint">Clique em uma atividade para ver detalhes completos.</div>
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
