import { useEffect, useRef, useState } from "react";
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

type BarPopup = {
  key: string;
  label: string;
  start: Date;
  end: Date | null;
  color: string;
  top: number;
  left: number;
};

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
  const [selectedTechIds, setSelectedTechIds] = useState<number[]>([]);
  const [date, setDate] = useState(() => todayISO());
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<OperationsTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [popup, setPopup] = useState<BarPopup | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPopup(null); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const technicians = data?.technicians || [];
  const isToday = data?.is_today ?? date === todayISO();
  const base = data?.date ? new Date(`${data.date}T00:00:00`) : new Date();
  const nowPct = isToday ? pct(now, base) : null;

  const techRows = reorderRowsByPair(
    technicians
      .filter((tech) => selectedTechIds.length === 0 || selectedTechIds.includes(tech.id))
      .map((tech) => {
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
  const trackHeight = (count: number) => (count <= 1 ? 68 : 14 + count * 38);
  const barTop = (index: number, count: number) => (count <= 1 ? 12 : 8 + index * 38);
  const barHeight = (count: number) => (count <= 1 ? 44 : 30);

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
          <div className="field-group">
            <label className="field-label">
              Técnicos {selectedTechIds.length > 0 && `(${selectedTechIds.length} selecionado(s))`}
            </label>
            <select
              multiple
              className="input"
              style={{ height: 96, minWidth: 220 }}
              value={selectedTechIds.map(String)}
              onChange={(e) => setSelectedTechIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
            >
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {selectedTechIds.length > 0 && (
              <button className="btn btn-outline btn-sm" style={{ marginTop: 6 }} onClick={() => setSelectedTechIds([])}>
                Limpar seleção
              </button>
            )}
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
                        const isActive = popup?.key === barKey;
                        return (
                          <div
                            key={idx}
                            className={`tl-bar${isActive ? " expanded" : ""}`}
                            title={segment.label}
                            onClick={(e) => {
                              e.stopPropagation();
                              const rect = e.currentTarget.getBoundingClientRect();
                              setPopup((prev) =>
                                prev?.key === barKey
                                  ? null
                                  : { key: barKey, label: segment.label, start: segment.start, end: segment.end ?? null, color: segment.color, top: rect.bottom + 6, left: rect.left }
                              );
                            }}
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
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {techRows.length === 0 && (
            <div className="empty-state">
              {technicians.length === 0
                ? `Nenhum técnico encontrado para ${formatDateBR(date)}.`
                : "Nenhum dos técnicos selecionados está disponível neste filtro."}
            </div>
          )}
        </div>
      )}
      {popup && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 199 }} onClick={() => setPopup(null)} />
          <div
            ref={popupRef}
            className="tl-popup"
            style={{ top: popup.top, left: Math.min(popup.left, window.innerWidth - 280) }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tl-popup-color" style={{ background: popup.color }} />
            <div className="tl-popup-body">
              <div className="tl-popup-label">{popup.label}</div>
              <div className="tl-popup-time">
                {formatTime(popup.start.toISOString())}
                {popup.end ? ` – ${formatTime(popup.end.toISOString())}` : " – em andamento"}
              </div>
            </div>
            <button className="tl-popup-close" onClick={() => setPopup(null)} aria-label="Fechar">×</button>
          </div>
        </>
      )}
    </div>
  );
}
