import { useEffect, useMemo, useRef, useState } from "react";
import { clientsApi, indicatorsApi, regionsApi, sitesApi, type Client, type Site } from "../api/resources";
import type { IndicatorsTrends, ManagementGroup, Region, TrendPoint } from "../api/types";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import Icon from "../components/ui/Icon";
import MultiSelectFilter from "../components/ui/MultiSelectFilter";
import PageHeader from "../components/ui/PageHeader";
import { useI18n, usePageText } from "../i18n";
import { brazilDaysAgoIso, brazilTodayIso, daysInclusive, formatIsoDate } from "../utils/date";

// Indicadores > Tendências — GET /api/indicators/trends/ (api/indicators.py).
// Três séries no mesmo eixo: horas em execução, horas improdutivas e tarefas executadas.

const MAX_PERIOD_DAYS = 366;
const PERIOD_PRESETS = [7, 30, 90, 365] as const;

type SeriesKey =
  | "hours_execution"
  | "hours_unproductive"
  | "tasks_executed"
  | "utilization_pct"
  | "hours_external_block"
  | "hours_internal_idle"
  | "man_hours";
const SERIES_VAR: Record<SeriesKey, string> = {
  hours_execution: "var(--tnd-1)",
  hours_unproductive: "var(--tnd-2)",
  tasks_executed: "var(--tnd-3)",
  utilization_pct: "var(--tnd-1)",
  hours_external_block: "var(--tnd-2)",
  hours_internal_idle: "var(--tnd-1)",
  man_hours: "var(--tnd-4)",
};

type ViewId = "overview" | "utilization" | "unproductive" | "manhours";
interface ViewDef {
  id: ViewId;
  kind: "line" | "stack";
  series: SeriesKey[];
  /** Linha de referência (valor no eixo). */
  ref?: number;
  minMax?: number;
}
const VIEWS: ViewDef[] = [
  { id: "overview", kind: "line", series: ["hours_execution", "hours_unproductive", "tasks_executed"] },
  { id: "utilization", kind: "line", series: ["utilization_pct"], ref: 70, minMax: 100 },
  { id: "unproductive", kind: "stack", series: ["hours_external_block", "hours_internal_idle"] },
  { id: "manhours", kind: "line", series: ["man_hours", "hours_execution"] },
];

const W = 960;
const H = 340;
const M = { l: 48, r: 20, t: 16, b: 34 };

type Text = {
  eyebrow: string;
  title: string;
  subtitle: string;
  site: string;
  cliente: string;
  regional: string;
  todosSites: string;
  todosClientes: string;
  todasRegionais: string;
  agrupar: string;
  day: string;
  week: string;
  month: string;
  auto: string;
  preset: (d: number) => string;
  dias: string;
  series: Record<SeriesKey, string>;
  unit: Record<SeriesKey, string>;
  views: Record<ViewId, string>;
  metaRef: string;
  graficoLabel: string;
  verTabela: string;
  verGrafico: string;
  periodo: string;
  total: string;
  carregando: string;
  erro: string;
  tentarNovamente: string;
  vazio: string;
  ocultar: string;
  nota: string;
};

const UNIT: Record<SeriesKey, string> = {
  hours_execution: "h",
  hours_unproductive: "h",
  tasks_executed: "",
  utilization_pct: "%",
  hours_external_block: "h",
  hours_internal_idle: "h",
  man_hours: "h",
};

const TEXT: Record<"pt-BR" | "en-US" | "es-ES", Text> = {
  "pt-BR": {
    eyebrow: "Indicadores",
    title: "Tendências",
    subtitle: "Evolução de horas em execução, horas improdutivas e tarefas executadas",
    site: "Site",
    cliente: "Cliente",
    regional: "Regional",
    todosSites: "Todos os sites",
    todosClientes: "Todos os clientes",
    todasRegionais: "Todas as regionais",
    agrupar: "Agrupar por",
    day: "Dia",
    week: "Semana",
    month: "Mês",
    auto: "Automático",
    preset: (d) => (d === 365 ? "1 ano" : `${d} dias`),
    dias: "dias",
    series: {
      hours_execution: "Horas em execução",
      hours_unproductive: "Horas improdutivas",
      tasks_executed: "Tarefas executadas",
      utilization_pct: "Utilização da jornada",
      hours_external_block: "Bloqueio externo",
      hours_internal_idle: "Ocioso interno",
      man_hours: "Homem-hora (HH)",
    },
    unit: UNIT,
    views: { overview: "Visão geral", utilization: "Utilização da jornada", unproductive: "Improdutivo por causa", manhours: "Homem-hora (HH)" },
    metaRef: "referência 70%",
    graficoLabel: "Gráfico de tendência",
    verTabela: "Ver tabela",
    verGrafico: "Ver gráfico",
    periodo: "Período",
    total: "Total no período",
    carregando: "Carregando…",
    erro: "Não foi possível carregar os indicadores.",
    tentarNovamente: "Tentar novamente",
    vazio: "Sem dados para os filtros e o período escolhidos.",
    ocultar: "Clique para ocultar/mostrar a série",
    nota: "Horas: tempo em execução (e apoio) e tempo improdutivo (disponível sem tarefa + bloqueio externo) dos técnicos lotados nos sites filtrados. Tarefas: conclusões no período. Mesmas regras de Relatórios e Indicadores. Todas as séries usam o mesmo eixo.",
  },
  "en-US": {
    eyebrow: "Indicators",
    title: "Trends",
    subtitle: "Evolution of execution hours, unproductive hours and executed tasks",
    site: "Site",
    cliente: "Client",
    regional: "Region",
    todosSites: "All sites",
    todosClientes: "All clients",
    todasRegionais: "All regions",
    agrupar: "Group by",
    day: "Day",
    week: "Week",
    month: "Month",
    auto: "Automatic",
    preset: (d) => (d === 365 ? "1 year" : `${d} days`),
    dias: "days",
    series: {
      hours_execution: "Execution hours",
      hours_unproductive: "Unproductive hours",
      tasks_executed: "Tasks executed",
      utilization_pct: "Workday utilization",
      hours_external_block: "External block",
      hours_internal_idle: "Internal idle",
      man_hours: "Man-hours (MH)",
    },
    unit: UNIT,
    views: { overview: "Overview", utilization: "Workday utilization", unproductive: "Unproductive by cause", manhours: "Man-hours (MH)" },
    metaRef: "reference 70%",
    graficoLabel: "Trend chart",
    verTabela: "View table",
    verGrafico: "View chart",
    periodo: "Period",
    total: "Total in period",
    carregando: "Loading…",
    erro: "Could not load the indicators.",
    tentarNovamente: "Try again",
    vazio: "No data for the chosen filters and period.",
    ocultar: "Click to hide/show the series",
    nota: "Hours: time in execution (and support) and unproductive time (available without a task + external block) of technicians assigned to the filtered sites. Tasks: completions in the period. Same rules as Reports & Indicators. All series share the same axis.",
  },
  "es-ES": {
    eyebrow: "Indicadores",
    title: "Tendencias",
    subtitle: "Evolución de horas en ejecución, horas improductivas y tareas ejecutadas",
    site: "Sitio",
    cliente: "Cliente",
    regional: "Regional",
    todosSites: "Todos los sitios",
    todosClientes: "Todos los clientes",
    todasRegionais: "Todas las regionales",
    agrupar: "Agrupar por",
    day: "Día",
    week: "Semana",
    month: "Mes",
    auto: "Automático",
    preset: (d) => (d === 365 ? "1 año" : `${d} días`),
    dias: "días",
    series: {
      hours_execution: "Horas en ejecución",
      hours_unproductive: "Horas improductivas",
      tasks_executed: "Tareas ejecutadas",
      utilization_pct: "Utilización de la jornada",
      hours_external_block: "Bloqueo externo",
      hours_internal_idle: "Ocioso interno",
      man_hours: "Hombre-hora (HH)",
    },
    unit: UNIT,
    views: { overview: "Visión general", utilization: "Utilización de la jornada", unproductive: "Improductivo por causa", manhours: "Hombre-hora (HH)" },
    metaRef: "referencia 70%",
    graficoLabel: "Gráfico de tendencia",
    verTabela: "Ver tabla",
    verGrafico: "Ver gráfico",
    periodo: "Período",
    total: "Total en el período",
    carregando: "Cargando…",
    erro: "No se pudieron cargar los indicadores.",
    tentarNovamente: "Reintentar",
    vazio: "Sin datos para los filtros y el período elegidos.",
    ocultar: "Clic para ocultar/mostrar la serie",
    nota: "Horas: tiempo en ejecución (y apoyo) y tiempo improductivo (disponible sin tarea + bloqueo externo) de los técnicos asignados a los sitios filtrados. Tareas: conclusiones en el período. Mismas reglas de Reportes e Indicadores. Todas las series usan el mismo eje.",
  },
};

function niceMax(v: number): number {
  if (v <= 0) return 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function fmt(n: number, locale: string): string {
  return n.toLocaleString(locale, { maximumFractionDigits: 1 });
}

function TrendChart({
  data,
  view,
  hidden,
  locale,
  p,
}: {
  data: IndicatorsTrends;
  view: ViewDef;
  hidden: Set<SeriesKey>;
  locale: string;
  p: Text;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Largura real do gráfico: o SVG é desenhado em pixels reais, para o texto manter o tamanho em qualquer tela.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(960);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setW(Math.max(320, Math.round(el.clientWidth)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const points = data.points;
  const visible = view.series.filter((k) => !hidden.has(k));
  const stacked = view.kind === "stack";
  const val = (pt: TrendPoint, k: SeriesKey) => pt[k] ?? 0;
  const top = stacked
    ? Math.max(0, ...points.map((pt) => visible.reduce((acc, k) => acc + val(pt, k), 0)))
    : Math.max(0, ...visible.flatMap((k) => points.map((pt) => val(pt, k))));
  const max = niceMax(Math.max(top, view.minMax ?? 0, view.ref ?? 0));
  const innerW = W - M.l - M.r;
  const innerH = H - M.t - M.b;
  const slot = innerW / Math.max(points.length, 1);
  const x = (i: number) => (stacked || points.length <= 1 ? M.l + slot * i + slot / 2 : M.l + (i / (points.length - 1)) * innerW);
  const y = (v: number) => M.t + innerH - (v / max) * innerH;
  const ticks = [0, 1, 2, 3, 4].map((i) => (max / 4) * i);
  const group = data.period.group;
  const label = (iso: string) =>
    group === "month"
      ? formatIsoDate(iso, locale, { month: "short", year: "2-digit" })
      : formatIsoDate(iso, locale, { day: "2-digit", month: "2-digit" });
  const step = Math.max(1, Math.ceil(points.length / 12));
  const unit = p.unit[view.series[0]];

  function onMove(e: React.MouseEvent<SVGRectElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * innerW;
    const idx = stacked ? Math.floor(px / slot) : points.length <= 1 ? 0 : Math.round((px / innerW) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  }

  // Linhas: pontos sem valor (ex.: sem jornada no dia) interrompem a linha.
  function segments(k: SeriesKey) {
    const out: string[] = [];
    let cur: string[] = [];
    points.forEach((pt, i) => {
      const v = pt[k];
      if (v === null || v === undefined) {
        if (cur.length) out.push(cur.join(" "));
        cur = [];
      } else cur.push(`${x(i)},${y(v)}`);
    });
    if (cur.length) out.push(cur.join(" "));
    return out;
  }

  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? (x(hover) / W) * 100 : 0;
  const barW = Math.max(2, Math.min(40, slot * 0.7));

  return (
    <div className="tnd-chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} className="tnd-svg" role="img" aria-label={p.views[view.id]}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className="tnd-grid" />
            <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="tnd-axis">
              {fmt(t, locale)}
              {t === max ? unit : ""}
            </text>
          </g>
        ))}
        {view.ref !== undefined && (
          <g>
            <line x1={M.l} x2={W - M.r} y1={y(view.ref)} y2={y(view.ref)} className="tnd-ref" />
            <text x={W - M.r - 4} y={y(view.ref) - 5} textAnchor="end" className="tnd-ref-label">
              {p.metaRef}
            </text>
          </g>
        )}
        {points.map((pt, i) =>
          i % step === 0 ? (
            <text key={pt.start} x={x(i)} y={H - 10} textAnchor="middle" className="tnd-axis">
              {label(pt.start)}
            </text>
          ) : null,
        )}
        {hover !== null && !stacked && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + innerH} className="tnd-cross" />}
        {hover !== null && stacked && <rect x={M.l + slot * hover} y={M.t} width={slot} height={innerH} className="tnd-hover-band" />}
        {stacked &&
          points.map((pt, i) => {
            let acc = 0;
            return (
              <g key={pt.start}>
                {visible.map((k) => {
                  const y0 = y(acc);
                  acc += val(pt, k);
                  const h = y0 - y(acc);
                  return h > 0 ? (
                    <rect key={k} x={x(i) - barW / 2} y={y(acc)} width={barW} height={h} fill={SERIES_VAR[k]} className="tnd-bar" />
                  ) : null;
                })}
              </g>
            );
          })}
        {!stacked &&
          visible.map((k) => (
            <g key={k}>
              {segments(k).map((pts, i) => (
                <polyline key={i} fill="none" stroke={SERIES_VAR[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={pts} />
              ))}
              {points.length <= 45 &&
                points.map((pt, i) =>
                  pt[k] === null ? null : (
                    <circle key={pt.start} cx={x(i)} cy={y(val(pt, k))} r={hover === i ? 4.5 : 2.5} fill={SERIES_VAR[k]} className="tnd-dot" />
                  ),
                )}
              {points.length > 0 && points[points.length - 1][k] !== null && (
                <text x={W - M.r - 4} y={y(val(points[points.length - 1], k)) - 8} textAnchor="end" className="tnd-endlabel">
                  {fmt(val(points[points.length - 1], k), locale)}
                  {p.unit[k]}
                </text>
              )}
            </g>
          ))}
        <rect x={M.l} y={M.t} width={innerW} height={innerH} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
      </svg>
      {hp && (
        <div className="tnd-tip" style={{ left: `${Math.min(Math.max(tipLeft, 14), 86)}%` }} role="status">
          <strong>{label(hp.start)}</strong>
          {visible.map((k) => (
            <div key={k} className="tnd-tip-row">
              <span className="tnd-swatch" style={{ background: SERIES_VAR[k] }} />
              <span>{p.series[k]}</span>
              <b>{hp[k] === null ? "—" : `${fmt(val(hp, k), locale)}${p.unit[k]}`}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function IndicatorsTrendsPage() {
  const { locale } = useI18n();
  const p = usePageText(TEXT);
  const [range, setRange] = useState<DateRange>(() => ({ start: brazilDaysAgoIso(29), end: brazilTodayIso() }));
  const [group, setGroup] = useState<"auto" | ManagementGroup>("auto");
  const [sites, setSites] = useState<Site[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [siteSel, setSiteSel] = useState<string[]>([]);
  const [clientSel, setClientSel] = useState<string[]>([]);
  const [regionSel, setRegionSel] = useState<string[]>([]);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const [table, setTable] = useState(false);
  const [viewId, setViewId] = useState<ViewId>("overview");
  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];
  const [data, setData] = useState<IndicatorsTrends | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    sitesApi.list().then((r) => setSites(r.results)).catch(() => undefined);
    clientsApi.list().then((r) => setClients(r.results)).catch(() => undefined);
    regionsApi.list().then((r) => setRegions(r.results)).catch(() => undefined);
  }, []);

  const siteParam = siteSel.join(",");
  const clientParam = clientSel.join(",");
  const regionParam = regionSel.join(",");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    indicatorsApi
      .trends({
        dateFrom: range.start,
        dateTo: range.end,
        group: group === "auto" ? undefined : group,
        site: siteParam,
        client: clientParam,
        region: regionParam,
      })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.detail ?? "");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range.start, range.end, group, siteParam, clientParam, regionParam, reloadKey]);

  const activePreset = PERIOD_PRESETS.find((d) => range.end === brazilTodayIso() && range.start === brazilDaysAgoIso(d - 1));
  const hasData = useMemo(
    () =>
      !!data &&
      data.points.some((pt) => pt.hours_execution || pt.hours_unproductive || pt.tasks_executed || pt.man_hours || pt.journey_hours),
    [data],
  );

  function changeRange(next: DateRange | null) {
    setRange(next ?? { start: brazilDaysAgoIso(29), end: brazilTodayIso() });
  }

  function toggleSeries(k: SeriesKey) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else if (view.series.filter((x) => !next.has(x)).length > 1) next.add(k);
      return next;
    });
  }

  return (
    <div className="tnd-page">
      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          <div className="ops-toolbar rpt-header-tools">
            <MultiSelectFilter
              label={p.site}
              options={sites.map((s) => ({ value: String(s.id), label: s.name || s.code }))}
              selected={siteSel}
              onChange={setSiteSel}
              allLabel={p.todosSites}
            />
            <MultiSelectFilter
              label={p.cliente}
              options={clients.map((c) => ({ value: String(c.id), label: c.name }))}
              selected={clientSel}
              onChange={setClientSel}
              allLabel={p.todosClientes}
            />
            <MultiSelectFilter
              label={p.regional}
              options={regions.map((r) => ({ value: String(r.id), label: r.name, hint: r.country_display }))}
              selected={regionSel}
              onChange={setRegionSel}
              allLabel={p.todasRegionais}
            />
          </div>
        }
      />

      <div className="rpt-period-bar">
        <DateRangeCalendar value={range} onChange={changeRange} maxDays={MAX_PERIOD_DAYS} emitPartial={false} />
        <div className="rpt-presets" role="group" aria-label={p.periodo}>
          {PERIOD_PRESETS.map((d) => (
            <button
              key={d}
              type="button"
              className={`rpt-preset${activePreset === d ? " active" : ""}`}
              aria-pressed={activePreset === d}
              onClick={() => changeRange({ start: brazilDaysAgoIso(d - 1), end: brazilTodayIso() })}
            >
              {p.preset(d)}
            </button>
          ))}
        </div>
        <div className="rpt-presets" role="group" aria-label={p.agrupar}>
          {(["auto", "day", "week", "month"] as const).map((g) => (
            <button
              key={g}
              type="button"
              className={`rpt-preset${group === g ? " active" : ""}`}
              aria-pressed={group === g}
              onClick={() => setGroup(g)}
            >
              {g === "auto" ? p.auto : p[g]}
            </button>
          ))}
        </div>
        <span className="mgr-hint">
          {daysInclusive(range.start, range.end)} {p.dias}
        </span>
      </div>

      {error !== null && !loading && (
        <div className="rpt-notice rpt-notice--error rpt-notice--block" role="alert">
          <Icon name="error" style={{ fontSize: 18 }} />
          <div className="rpt-notice-body">
            <strong>{p.erro}</strong>
            {error && <span>{error}</span>}
          </div>
          <div className="rpt-notice-actions">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
              <Icon name="refresh" style={{ fontSize: 16 }} />
              {p.tentarNovamente}
            </button>
          </div>
        </div>
      )}

      <section className="tnd-card" aria-busy={loading}>
        <div className="tnd-views rpt-presets" role="group" aria-label={p.title}>
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              className={`rpt-preset${viewId === v.id ? " active" : ""}`}
              aria-pressed={viewId === v.id}
              onClick={() => {
                setViewId(v.id);
                setHidden(new Set());
              }}
            >
              {p.views[v.id]}
            </button>
          ))}
        </div>
        <div className="tnd-legend" role="group" aria-label={p.views[view.id]}>
          {view.series.map((k) => (
            <button
              key={k}
              type="button"
              className={`tnd-legend-item${hidden.has(k) ? " off" : ""}`}
              aria-pressed={!hidden.has(k)}
              title={p.ocultar}
              onClick={() => toggleSeries(k)}
            >
              <span className="tnd-swatch" style={{ background: SERIES_VAR[k] }} />
              <span className="tnd-legend-name">{p.series[k]}</span>
              <b className="tnd-legend-total">
                {data && data.totals[k] !== null ? `${fmt(data.totals[k] as number, locale)}${p.unit[k]}` : "—"}
              </b>
            </button>
          ))}
          <button type="button" className="btn btn-outline btn-sm tnd-toggle" onClick={() => setTable((v) => !v)}>
            <Icon name={table ? "show_chart" : "table_chart"} style={{ fontSize: 16 }} />
            {table ? p.verGrafico : p.verTabela}
          </button>
        </div>

        {loading && !data && <p className="mgr-status" role="status">{p.carregando}</p>}
        {data && !hasData && !loading && <p className="mgr-status">{p.vazio}</p>}

        {data && hasData && !table && <TrendChart data={data} view={view} hidden={hidden} locale={locale} p={p} />}

        {data && hasData && table && (
          <div className="tnd-table-wrap">
            <table className="table tnd-table">
              <thead>
                <tr>
                  <th>{p.periodo}</th>
                  {view.series.map((k) => (
                    <th key={k} className="num">{p.series[k]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.points.map((pt) => (
                  <tr key={pt.start}>
                    <td>{formatIsoDate(pt.start, locale, { day: "2-digit", month: "2-digit", year: "numeric" })}</td>
                    {view.series.map((k) => (
                      <td key={k} className="num">{pt[k] === null ? "—" : fmt(pt[k] as number, locale)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>{p.total}</th>
                  {view.series.map((k) => (
                    <th key={k} className="num">{data.totals[k] === null ? "—" : fmt(data.totals[k] as number, locale)}</th>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="tnd-note">{p.nota}</p>
      </section>
    </div>
  );
}
