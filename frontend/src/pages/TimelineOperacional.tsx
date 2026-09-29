import { useEffect, useState } from "react";
import { operationsApi, sitesApi, type Site } from "../api/resources";
import type { OperationsTimeline, TimelineTechnician } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { WINDOW_MINUTES, initials } from "../utils/timeline";

const AVATAR_COLORS = [
  { bg: "var(--blue-soft)", color: "var(--blue)" },
  { bg: "var(--purple-soft)", color: "var(--purple)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" },
  { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--teal-soft)", color: "var(--teal)" },
  { bg: "var(--red-soft)", color: "var(--red)" },
];
function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }

const BREAK_STATUSES = ["lunch", "personal", "site_blocked", "awaiting_release", "on_leave"];

function computeTechHours(tech: TimelineTechnician, now: Date, isToday: boolean) {
  let activeMs = 0;
  for (const b of tech.blocks) {
    const start = b.actual_start ? new Date(b.actual_start).getTime() : null;
    const end = b.actual_end
      ? new Date(b.actual_end).getTime()
      : b.status !== "completed" && isToday ? now.getTime() : null;
    if (start && end) activeMs += Math.max(0, end - start);
  }
  const sorted = [...tech.status_events].sort(
    (a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime()
  );
  let breakMs = 0;
  let availableMs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const ev = sorted[i];
    if (ev.status === "not_started" || ev.status === "off_duty") continue;
    const startMs = new Date(ev.changed_at).getTime();
    const endMs = i + 1 < sorted.length ? new Date(sorted[i + 1].changed_at).getTime() : now.getTime();
    const dur = Math.max(0, endMs - startMs);
    if (BREAK_STATUSES.includes(ev.status)) breakMs += dur;
    else if (ev.status === "available") availableMs += dur;
  }
  return {
    activeHours: activeMs / 3600000,
    breakHours: breakMs / 3600000,
    availableHours: availableMs / 3600000,
    doneCount: tech.blocks.filter((b) => b.status === "completed").length,
  };
}

function formatHours(h: number) {
  if (h < 0.01) return "0h";
  const hInt = Math.floor(h);
  const m = Math.round((h - hInt) * 60);
  return m > 0 ? `${hInt}h${String(m).padStart(2, "0")}` : `${hInt}h`;
}

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

export default function TimelineOperacional() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "all">("all");
  const [selectedTechIds, setSelectedTechIds] = useState<number[]>([]);
  const [date, setDate] = useState(() => todayISO());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [data, setData] = useState<OperationsTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => { sitesApi.list().then((res) => setSites(res.results)); }, []);
  useEffect(() => {
    setLoading(true);
    operationsApi.timeline(siteId, date).then(setData).finally(() => setLoading(false));
  }, [siteId, date]);
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const technicians = data?.technicians || [];
  const isToday = data?.is_today ?? date === todayISO();
  const filtered = technicians.filter(
    (t) => selectedTechIds.length === 0 || selectedTechIds.includes(t.id)
  );

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
        <div className="ops-pool-card" style={{ padding: 0 }}>
          <div className="ops-card-head" style={{ padding: "12px 16px" }}>
            <div className="ops-card-title">Desempenho por Técnico</div>
            <div className="ops-card-hint">{filtered.length} técnico(s)</div>
          </div>

          {filtered.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              {technicians.length === 0
                ? `Nenhum técnico para ${formatDateBR(date)}.`
                : "Nenhum técnico no filtro."}
            </div>
          ) : filtered.map((tech) => {
            const ac = avatarColor(tech.id);
            const { activeHours, breakHours, availableHours, doneCount } = computeTechHours(tech, now, isToday);
            const safeTotal = Math.max(activeHours + breakHours + availableHours, WINDOW_MINUTES / 60, 0.01);
            const activePct = Math.min(100, (activeHours / safeTotal) * 100);
            const breakPct = Math.min(100 - activePct, (breakHours / safeTotal) * 100);
            const avPct = Math.min(100 - activePct - breakPct, (availableHours / safeTotal) * 100);
            return (
              <div key={tech.id} className="rpt-today-row">
                <div className="rpt-today-header">
                  <div className="rpt-today-avatar" style={{ background: ac.bg, color: ac.color }}>{initials(tech.name)}</div>
                  <div>
                    <div className="rpt-today-name">{tech.name}</div>
                    <div className="rpt-today-sub">
                      {tech.site_name}{doneCount > 0 && ` · ${doneCount} tarefa${doneCount === 1 ? "" : "s"} finalizada${doneCount === 1 ? "" : "s"}`}
                    </div>
                  </div>
                </div>
                <div className="rpt-today-timeline">
                  <div className="rpt-today-bar">
                    <div style={{ width: `${activePct}%`, background: "var(--green)", height: "100%", borderRadius: 2 }} title={`Tarefas: ${formatHours(activeHours)}`} />
                    <div style={{ width: `${breakPct}%`, background: "var(--amber)", height: "100%", opacity: 0.7 }} title={`Intervalos: ${formatHours(breakHours)}`} />
                    <div style={{ width: `${avPct}%`, background: "var(--blue)", height: "100%", opacity: 0.5 }} title={`Disponível: ${formatHours(availableHours)}`} />
                  </div>
                </div>
                <div className="rpt-today-metrics">
                  <div className="rpt-today-metric">
                    <span className="rpt-today-metric-dot" style={{ background: "var(--green)" }} />
                    <span className="rpt-today-metric-label">Tarefas</span>
                    <span className="rpt-today-metric-val">{formatHours(activeHours)}</span>
                  </div>
                  <div className="rpt-today-metric">
                    <span className="rpt-today-metric-dot" style={{ background: "var(--amber)", opacity: 0.8 }} />
                    <span className="rpt-today-metric-label">Intervalos</span>
                    <span className="rpt-today-metric-val">{formatHours(breakHours)}</span>
                  </div>
                  <div className="rpt-today-metric">
                    <span className="rpt-today-metric-dot" style={{ background: "var(--blue)", opacity: 0.6 }} />
                    <span className="rpt-today-metric-label">Disponível</span>
                    <span className="rpt-today-metric-val">{formatHours(availableHours)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
