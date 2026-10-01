import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n";

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function fromIso(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
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

function getWeekdayNames(locale: string): string[] {
  const names: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(2024, 0, 7 + i); // 7 jan 2024 = domingo
    names.push(d.toLocaleDateString(locale, { weekday: "short" }));
  }
  return names;
}

interface DateInputProps {
  value: string; // YYYY-MM-DD ou ""
  onChange: (value: string) => void;
  className?: string;
  style?: React.CSSProperties;
  min?: string;
  placeholder?: string;
  disabled?: boolean;
}

export default function DateInput({ value, onChange, className, style, min, disabled }: DateInputProps) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => (value ? fromIso(value) : new Date()));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (value) setViewDate(fromIso(value));
  }, [value]);

  function handleDayClick(day: Date) {
    const iso = toIso(day);
    if (min && iso < min) return;
    onChange(iso);
    setOpen(false);
  }

  const weekdays = getWeekdayNames(locale);
  const days = buildMonthGrid(viewDate);
  const today = toIso(new Date());

  const displayValue = value
    ? fromIso(value).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const monthYearLabel = viewDate.toLocaleDateString(locale, { month: "long", year: "numeric" });

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", ...style }}>
      <button
        type="button"
        className={className ?? "input"}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          cursor: disabled ? "default" : "pointer",
          textAlign: "left",
          width: "100%",
          fontWeight: "normal",
        }}
      >
        <span style={{ flex: 1, color: value ? "inherit" : "var(--text-muted)" }}>{displayValue}</span>
        <span style={{ fontSize: 15, color: "var(--text-muted)" }}>📅</span>
      </button>

      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 4px)",
          left: 0,
          zIndex: 999,
          background: "var(--surface-2)",
          border: "0.5px solid var(--border-strong)",
          borderRadius: 10,
          padding: 12,
          width: 224,
          boxShadow: "0 4px 16px rgba(0,0,0,.12)",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-secondary)", padding: "0 4px" }}
            >‹</button>
            <strong style={{ fontSize: 13, textTransform: "capitalize", color: "var(--text-primary)" }}>{monthYearLabel}</strong>
            <button
              type="button"
              onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
              style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "var(--text-secondary)", padding: "0 4px" }}
            >›</button>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
            {weekdays.map((w) => (
              <span key={w} style={{ fontSize: 10, color: "var(--text-muted)", textAlign: "center", padding: "2px 0 4px" }}>{w}</span>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {days.map((day) => {
              const iso = toIso(day);
              const outside = day.getMonth() !== viewDate.getMonth();
              const selected = iso === value;
              const isToday = iso === today;
              const disabled_ = !!(min && iso < min);
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => handleDayClick(day)}
                  disabled={disabled_}
                  style={{
                    fontSize: 12,
                    textAlign: "center",
                    padding: "5px 2px",
                    borderRadius: "50%",
                    border: "none",
                    cursor: disabled_ ? "default" : "pointer",
                    background: selected ? "var(--blue)" : isToday && !selected ? "var(--orange-soft, #fff3e0)" : "transparent",
                    color: selected ? "#fff" : outside || disabled_ ? "var(--text-muted)" : "var(--text-primary)",
                    fontWeight: isToday ? 600 : 400,
                  }}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
