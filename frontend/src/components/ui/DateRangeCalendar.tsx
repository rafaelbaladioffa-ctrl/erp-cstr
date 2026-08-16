import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export interface DateRange {
  start: string;
  end: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fromIso(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(s: string) {
  const d = fromIso(s);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function buildMonthGrid(viewDate: Date) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    days.push(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
  }
  return days;
}

export default function DateRangeCalendar({
  value,
  onChange,
  maxDays = 7,
}: {
  value: DateRange | null;
  onChange: (range: DateRange | null) => void;
  maxDays?: number;
}) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? fromIso(value.start) : new Date()));
  const [pendingStart, setPendingStart] = useState<string | null>(null);
  const [warning, setWarning] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPendingStart(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleDayClick(day: Date) {
    const iso = toIso(day);
    setWarning("");
    if (!pendingStart) {
      setPendingStart(iso);
      onChange({ start: iso, end: iso });
      return;
    }
    if (iso === pendingStart) {
      setPendingStart(null);
      setOpen(false);
      return;
    }
    let start = pendingStart < iso ? pendingStart : iso;
    let end = pendingStart < iso ? iso : pendingStart;
    const span = Math.round((fromIso(end).getTime() - fromIso(start).getTime()) / 86400000) + 1;
    if (span > maxDays) {
      const clampedEnd = new Date(fromIso(start));
      clampedEnd.setDate(clampedEnd.getDate() + (maxDays - 1));
      end = toIso(clampedEnd);
      setWarning(`Período limitado a ${maxDays} dias.`);
    }
    onChange({ start, end });
    setPendingStart(null);
    setOpen(false);
  }

  function handleClear() {
    onChange(null);
    setPendingStart(null);
    setWarning("");
    setOpen(false);
  }

  function inRange(day: Date) {
    if (!value) return false;
    const iso = toIso(day);
    return iso >= value.start && iso <= value.end;
  }

  function isEdge(day: Date) {
    if (!value) return null;
    const iso = toIso(day);
    if (iso === value.start) return "start";
    if (iso === value.end) return "end";
    return null;
  }

  const days = buildMonthGrid(viewDate);
  const today = toIso(new Date());
  const label = value
    ? value.start === value.end
      ? formatShort(value.start)
      : `${formatShort(value.start)} – ${formatShort(value.end)}`
    : "Selecionar período";

  return (
    <div className="daterange" ref={ref}>
      <button className="daterange-trigger" onClick={() => setOpen((v) => !v)}>
        <Icon name="calendar_month" style={{ fontSize: 17 }} />
        {label}
        <Icon name="expand_more" style={{ fontSize: 16 }} />
      </button>
      {value && (
        <button className="daterange-clear" onClick={handleClear} aria-label="Limpar período">
          <Icon name="close" style={{ fontSize: 14 }} />
        </button>
      )}

      {open && (
        <div className="daterange-popover">
          <div className="daterange-popover-head">
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>
              <Icon name="chevron_left" style={{ fontSize: 18 }} />
            </button>
            <strong>
              {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
            </strong>
            <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>
              <Icon name="chevron_right" style={{ fontSize: 18 }} />
            </button>
          </div>

          <div className="daterange-hint">
            {pendingStart ? "Escolha o dia final (até 7 dias)..." : "Clique num dia, ou dois dias para um período."}
          </div>

          <div className="daterange-grid daterange-weekdays">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="daterange-grid">
            {days.map((day) => {
              const iso = toIso(day);
              const outside = day.getMonth() !== viewDate.getMonth();
              const edge = isEdge(day);
              const pending = pendingStart === iso;
              return (
                <button
                  key={iso}
                  className={[
                    "daterange-day",
                    outside ? "outside" : "",
                    inRange(day) ? "in-range" : "",
                    edge ? "edge" : "",
                    pending ? "pending" : "",
                    iso === today ? "today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => handleDayClick(day)}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {warning && <div className="daterange-warning">{warning}</div>}

          <div className="daterange-popover-foot">
            <button className="btn-outline btn-sm" onClick={handleClear}>
              Limpar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
