import { useEffect, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsTimeline } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import {
  BUSY_COLOR,
  DONE_COLOR,
  HOURS,
  PRESENCE_COLOR,
  WINDOW_END_HOUR,
  WINDOW_START_HOUR,
  assignLanes,
  buildTechSegments,
  formatTime,
  initials,
  pairRowClass,
  pct,
  reorderRowsByPair,
} from "../utils/timeline";

function formatDateBR(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function shiftDate(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

type ViewMode = "day" | "week" | "month";

export default function TimelineOperacional() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "all">("all");
  const [date, setDate] = useState(() => todayISO());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<OperationsTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [expandedBar, setExpandedBar] = useState<string | null>(null);

  useEffect(() => {
    sitesApi.list().then((res) => setSites(res.results));
  }, []);

  useEffect(() => {
    setLoading(true);
    operationsApi
      .timeline(siteId, date)
      .then(setData)
      .finally(() => setLoading(false));
  }, [siteId, date]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const technicians = data?.technicians || [];
  const isToday = data?.is_today ?? date === todayISO();
  const base = data?.date ? new Date(`${data.date}T00:00:00`) : new Date();
  const nowPct = isToday ? pct(now, base) : null;

  const techRows = reorderRowsByPair(
    technicians.map((tech) => {
      const segments = buildTechSegments(tech.blocks, tech.status_events, now, isToday);
      const lanedSegments = assignLanes(segments);
      return {
        tech,
        lanedSegments,
        laneCount: lanedSegments[0]?.laneCount ?? 1,
        doneCount: tech.blocks.filter((b) => b.status === "completed").length,
      };
    })
  );
  const trackHeight = (count: number) => (count <= 1 ? 52 : 10 + count * 30);
  const barTop = (index: number, count: number) => (count <= 1 ? 8 : 6 + index * 30);
  const barHeight = (count: number) => (count <= 1 ? 36 : 26);

  return (
    <div>
      <PageHeader eyebrow="Central de Operações" title="Timeline Operacional" subtitle="Visão em Gantt — histórico por técnico" />

      <div className="tl-toolbar">
        <div className="tl-date-nav">
          <button className="tl-nav-btn" onClick={() => setDate((d) => shiftDate(d, -1))} aria-label="Dia anterior">
            <Icon name="chevron_left" style={{ fontSize: 18 }} />
          </button>
          <input type="date" className="input" style={{ width: 150 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <button className="tl-nav-btn" onClick={() => setDate((d) => shiftDate(d, 1))} aria-label="Próximo dia">
            <Icon name="chevron_right" style={{ fontSize: 18 }} />
          </button>
          <button className="btn btn-outline btn-sm" onClick={() => setDate(todayISO())}>
            Hoje
          </button>
        </div>

        <div className="tl-view-toggle">
          <button className={`tl-view-btn${viewMode === "day" ? " active" : ""}`} onClick={() => setViewMode("day")}>
            Dia
          </button>
          <button className="tl-view-btn" disabled title="Em breve">
            Semana
          </button>
          <button className="tl-view-btn" disabled title="Em breve">
            Mês
          </button>
        </div>

        <button className="btn btn-outline btn-sm" onClick={() => setFiltersOpen((v) => !v)}>
          <Icon name="filter_list" style={{ fontSize: 16 }} />
          Filtros
        </button>
      </div>

      {filtersOpen && (
        <div className="tl-filters-panel">
          <div className="field-group">
            <label className="field-label">Site</label>
            <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">Todos os sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {loading && !data ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <div className="tl-card">
          <div className="tl-legend-row">
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

          <div className="tl-grid-wrap">
            <div className="tl-labels">
              <div className="tl-ruler" />
              {techRows.map(({ tech, laneCount, doneCount }, rowIdx) => (
                <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(laneCount) }}>
                  <div className="tl-row-label">
                    <div className="tl-avatar">{initials(tech.name)}</div>
                    <div>
                      <div className="tl-row-name">
                        {tech.name}
                        {siteId === "all" && <span className="tl-row-site"> · {tech.site_name}</span>}
                      </div>
                      <div className="tl-row-overview">
                        {doneCount} finalizada{doneCount === 1 ? "" : "s"}
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
                {nowPct != null && (
                  <div className="tl-now-line" style={{ left: `${nowPct}%` }}>
                    <div className="tl-now-tag">agora {now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
                    <div className="tl-now-dot" />
                  </div>
                )}
              </div>

              {techRows.map(({ tech, lanedSegments, laneCount }, rowIdx) => {
                if (lanedSegments.length === 0) {
                  return (
                    <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(0) }}>
                      <div className="tl-row-track">
                        <div className="tl-idle-note">Sem atividade neste dia</div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={tech.id} className={`tl-row ${pairRowClass(techRows, rowIdx)}`} style={{ height: trackHeight(laneCount) }}>
                    <div className="tl-row-track">
                      {lanedSegments.map(({ segment, lane }, idx) => {
                        const left = pct(segment.start, base);
                        const rightPct = segment.end ? pct(segment.end, base) : nowPct ?? 100;
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
          </div>
          {technicians.length === 0 && <div className="empty-state">Nenhum técnico encontrado para {formatDateBR(date)}.</div>}
        </div>
      )}
    </div>
  );
}
