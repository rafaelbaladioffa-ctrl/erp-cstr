/** Barra simples comparando quantidade planejada x executada — duas faixas
 * de largura proporcional sobre a mesma escala, sem biblioteca de gráfico.
 * Se o executado passar do planejado, a faixa some em vermelho/âmbar em vez
 * de estourar a largura, pra deixar claro que passou do previsto. */
export default function PlannedVsExecutedBar({ planned, executed }: { planned: number; executed: number }) {
  const max = Math.max(planned, executed, 1);
  const plannedPct = Math.min(100, (planned / max) * 100);
  const executedPct = Math.min(100, (executed / max) * 100);
  const overExecuted = executed > planned;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 120 }}>
      <div style={{ position: "relative", height: 6, background: "var(--bg)", borderRadius: 3, overflow: "hidden" }}>
        <div
          style={{
            position: "absolute", top: 0, left: 0, height: "100%", width: `${plannedPct}%`,
            background: "var(--border)", borderRadius: 3,
          }}
        />
        <div
          style={{
            position: "absolute", top: 0, left: 0, height: "100%", width: `${executedPct}%`,
            background: overExecuted ? "var(--red)" : "var(--orange)", borderRadius: 3,
          }}
        />
      </div>
      <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
        {executed} / {planned}
      </span>
    </div>
  );
}
