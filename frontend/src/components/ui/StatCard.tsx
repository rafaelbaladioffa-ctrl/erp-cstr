import Icon from "./Icon";

export default function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "orange",
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon: string;
  tone?: "orange" | "blue" | "green" | "amber" | "teal";
}) {
  const tones: Record<string, { bg: string; color: string }> = {
    orange: { bg: "var(--orange-soft)", color: "var(--orange)" },
    blue: { bg: "var(--blue-soft)", color: "var(--blue)" },
    green: { bg: "var(--green-soft)", color: "var(--green)" },
    amber: { bg: "var(--amber-soft)", color: "var(--amber)" },
    teal: { bg: "var(--teal-soft)", color: "var(--teal)" },
  };
  const style = tones[tone];

  return (
    <div className="stat-card">
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
      <div className="stat-icon" style={{ background: style.bg, color: style.color }}>
        <Icon name={icon} />
      </div>
    </div>
  );
}
