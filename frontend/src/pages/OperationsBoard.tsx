import { useEffect, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsBoard as OperationsBoardData, StatusEvent, TimelineBlock } from "../api/types";
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
  const [selectedTask, setSelectedTask] = useState<number | null>(null);
  const [selectedTechs, setSelectedTechs] = useState<number[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [expandedBar, setExpandedBar] = useState<string | null>(null);
  const [poolOpen, setPoolOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);

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
                  const dispatchable = tech.presence_status !== "not_started" && tech.presence_status !== "off_duty";
                  const selectable = selectedTask != null && dispatchable;
                  const isSelected = selectedTechs.includes(tech.id);
                  return (
                    <div
                      key={tech.id}
                      className={`ops-tech-row${selectable ? " selectable" : ""}${isSelected ? " selected" : ""}${
                        tech.presence_status === "off_duty" || tech.presence_status === "not_started" ? " dim" : ""
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
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectTask(task.id);
                                }}
                              >
                                Despachar
                              </button>
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

          <div className="tl-card" style={{ marginTop: 16 }}>
            <div className="ops-card-head" style={{ padding: "0 0 14px", border: "none" }}>
              <div className="ops-card-title">Timeline Operacional — Visão Geral</div>
              <div className="tl-legend-row" style={{ marginBottom: 0 }}>
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
                  <span className="legend-swatch" style={{ background: "var(--text-faint)" }} />
                  Não iniciado / Fim de Expediente
                </div>
              </div>
            </div>
            <div className="tl-grid-wrap">
              <div className="tl-labels">
                <div className="tl-ruler" />
                {techRows.map(({ tech, laneCount, doneCount, pendingCount }, idx) => (
                  <div
                    key={tech.id}
                    className={`tl-row ${pairRowClass(techRows, idx)}`}
                    style={{ height: trackHeight(laneCount) }}
                  >
                    <div className="tl-row-label">
                      <div className="tl-avatar">{initials(tech.name)}</div>
                      <div>
                        <div className="tl-row-name">
                          {tech.name}
                          {siteId === "all" && <span className="tl-row-site"> · {tech.site_name}</span>}
                        </div>
                        <div className="tl-row-overview">
                          {doneCount} finalizada{doneCount === 1 ? "" : "s"} · {pendingCount} pendente{pendingCount === 1 ? "" : "s"}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="tl-body">
                <div className="tl-ruler">
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      className="tl-ruler-tick"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    >
                      {String(h).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                <div className="tl-gridlines">
                  {HOURS.slice(1, -1).map((h) => (
                    <div
                      key={h}
                      className="tl-gridline"
                      style={{ left: `${((h - WINDOW_START_HOUR) / (WINDOW_END_HOUR - WINDOW_START_HOUR)) * 100}%` }}
                    />
                  ))}
                  <div className="tl-now-line" style={{ left: `${nowPct}%` }}>
                    <div className="tl-now-tag">agora {nowDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="tl-now-dot" />
                  </div>
                </div>

                {techRows.map(({ tech, lanedSegments, laneCount }, rowIdx) => {
                  if (lanedSegments.length === 0) {
                    return (
                      <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(0) }}>
                        <div className="tl-row-track">
                          <div className="tl-idle-note">{tech.presence_status_display}</div>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(laneCount) }}>
                      <div className="tl-row-track">
                        {lanedSegments.map(({ segment, lane }, idx) => {
                          const left = pct(segment.start, base);
                          const rightPct = segment.end ? pct(segment.end, base) : nowPct;
                          const width = Math.max(0.4, rightPct - left);
                          const barKey = `${tech.id}-${idx}`;
                          const isExpanded = expandedBar === barKey;
                          return (
                            <span key={idx}>
                              {isExpanded && (
                                <span
                                  className="tl-bar-time"
                                  style={{ left: `${left}%`, top: barTop(lane, laneCount), height: barHeight(laneCount) }}
                                >
                                  {formatTime(segment.start.toISOString())}
                                </span>
                              )}
                              <div
                                className={`tl-bar${isExpanded ? " expanded" : ""}`}
                                title={segment.label}
                                onClick={() => setExpandedBar((prev) => (prev === barKey ? null : barKey))}
                                style={{
                                  left: `${left}%`,
                                  width: `${width}%`,
                                  top: barTop(lane, laneCount),
                                  height: barHeight(laneCount),
                                  background: segment.color,
                                }}
                              >
                                {segment.live && <span className="tl-live-dot" />}
                                <span className="tl-bar-label">{segment.label}</span>
                              </div>
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="tl-queue-col">
                <div className="tl-ruler">
                  <span className="tl-queue-col-title">Próximas na fila</span>
                </div>
                {techRows.map(({ tech, laneCount }, rowIdx) => (
                  <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(laneCount) }}>
                    <div className="tl-queue-row-track">
                      {tech.queue.length === 0 ? (
                        <span className="tl-queue-empty">—</span>
                      ) : (
                        tech.queue.map((q, idx) => (
                          <span key={q.task_id} className="ops-queue-chip" title={q.task_name}>
                            <span className="ops-queue-num">{idx + 1}</span>
                            {q.task_name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {technicians.length === 0 && <div className="empty-state">Nenhum técnico vinculado a este site.</div>}
          </div>
        </>
      )}
    </div>
  );
}
