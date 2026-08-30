import { useEffect, useState } from "react";
import { dashboardApi, operationsApi, sitesApi, type Site } from "../api/resources";
import type { ActivityProductivityRow, OperationsReports } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatHours(value: number) {
  const h = Math.floor(value);
  const m = Math.round((value - h) * 60);
  if (h === 0 && m === 0) return "0min";
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function formatClock(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function OperationsReportsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<number | "all">("all");
  const [dateFrom, setDateFrom] = useState(() => daysAgoISO(29));
  const [dateTo, setDateTo] = useState(() => todayISO());
  const [data, setData] = useState<OperationsReports | null>(null);
  const [loading, setLoading] = useState(false);
  const [productivityRows, setProductivityRows] = useState<ActivityProductivityRow[]>([]);

  useEffect(() => {
    sitesApi.list().then((res) => setSites(res.results));
    dashboardApi.activityProductivity().then((res) => setProductivityRows(res.rows)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    operationsApi
      .reports(siteId, dateFrom, dateTo)
      .then(setData)
      .finally(() => setLoading(false));
  }, [siteId, dateFrom, dateTo]);

  const stats = data?.stats;
  const technicians = data?.technicians || [];
  const activities = data?.activities || [];
  const todayTechnicians = data?.today_technicians || [];
  const unproductiveByReason = data?.unproductive_by_reason || [];
  const logEntries = data?.log_entries || [];
  const maxReasonHours = Math.max(1, ...unproductiveByReason.map((r) => r.hours));

  return (
    <div>
      <PageHeader
        eyebrow="Central de Operações"
        title="Relatórios e Indicadores"
        subtitle="Desempenho por técnico e por tipo de atividade no período"
        actions={
          <div className="ops-toolbar">
            <input type="date" className="input" style={{ width: 150 }} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>até</span>
            <input type="date" className="input" style={{ width: 150 }} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            <select className="select" value={siteId} onChange={(e) => setSiteId(e.target.value === "all" ? "all" : Number(e.target.value))}>
              <option value="all">Todos os sites</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {loading && !data ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <div>
                <div className="stat-label">Utilização Média</div>
                <div className="stat-value">{stats?.avg_utilization_pct ?? 0}%</div>
              </div>
              <div className="stat-icon" style={{ background: "var(--orange-soft)", color: "var(--orange)" }}>
                <Icon name="percent" />
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Horas Produtivas Hoje</div>
                <div className="stat-value">{formatHours(stats?.today_productive_hours ?? 0)}</div>
              </div>
              <div className="stat-icon" style={{ background: "var(--green-soft)", color: "var(--green)" }}>
                <Icon name="login" />
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Horas Improdutivas Hoje</div>
                <div className="stat-value">{formatHours(stats?.today_unproductive_hours ?? 0)}</div>
              </div>
              <div className="stat-icon" style={{ background: "var(--red-soft)", color: "var(--red)" }}>
                <Icon name="hourglass_disabled" />
              </div>
            </div>
            <div className="stat-card">
              <div>
                <div className="stat-label">Concluídas no Mês</div>
                <div className="stat-value">{stats?.completed_this_month ?? 0}</div>
              </div>
              <div className="stat-icon" style={{ background: "var(--teal-soft)", color: "var(--teal)" }}>
                <Icon name="checklist" />
              </div>
            </div>
          </div>

          <div className="reports-two-col">
            <div className="ops-pool-card">
              <div className="ops-card-head">
                <div className="ops-card-title">Log Automático — Hoje</div>
                <div className="ops-card-hint">Gerado pelo sistema a cada mudança de status</div>
              </div>
              <div className="log-feed">
                {logEntries.map((e, idx) => (
                  <div key={idx} className="log-item">
                    <span className="log-dot" />
                    <div className="log-time">{formatClock(e.at)}</div>
                    <div className="log-text">
                      <strong>{e.name}</strong> {e.text}
                    </div>
                  </div>
                ))}
                {logEntries.length === 0 && <div className="empty-state">Nenhum evento registrado hoje.</div>}
              </div>
            </div>

            <div className="ops-pool-card">
              <div className="ops-card-head">
                <div className="ops-card-title">Desempenho por Técnico — Hoje</div>
                <div className="ops-card-hint">{todayTechnicians.length} técnicos com atividade hoje</div>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Técnico</th>
                      <th>Jornada</th>
                      <th>Em Atividades</th>
                      <th>Disponível</th>
                      <th>Intervalos</th>
                      <th>Utilização</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayTechnicians.map((t) => (
                      <tr key={t.id}>
                        <td style={{ fontWeight: 700 }}>{t.name}</td>
                        <td>{t.journey_hours > 0 ? formatHours(t.journey_hours) : "—"}</td>
                        <td>{formatHours(t.active_hours)}</td>
                        <td>{formatHours(t.available_hours)}</td>
                        <td>{formatHours(t.break_hours)}</td>
                        <td>
                          {t.utilization_pct != null ? (
                            <div className="util-cell">
                              <div className="util-track">
                                <div className="util-fill" style={{ width: `${Math.min(100, t.utilization_pct)}%` }} />
                              </div>
                              {t.utilization_pct}%
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {todayTechnicians.length === 0 && <div className="table-empty">Nenhuma atividade hoje.</div>}
              </div>
            </div>
          </div>

          <div className="ops-pool-card" style={{ marginBottom: 16 }}>
            <div className="ops-card-head">
              <div className="ops-card-title">Desempenho por Técnico — Histórico</div>
              <div className="ops-card-hint">{technicians.length} técnicos com atividade no período</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Técnico</th>
                    <th>Site</th>
                    <th>Jornada</th>
                    <th>Em Atividades</th>
                    <th>Concluídas</th>
                    <th>Utilização</th>
                  </tr>
                </thead>
                <tbody>
                  {technicians.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 700 }}>{t.name}</td>
                      <td>{t.site_name}</td>
                      <td>{t.journey_hours > 0 ? formatHours(t.journey_hours) : "—"}</td>
                      <td>{formatHours(t.worked_hours)}</td>
                      <td>{t.completed_count}</td>
                      <td>
                        {t.utilization_pct != null ? (
                          <div className="util-cell">
                            <div className="util-track">
                              <div className="util-fill" style={{ width: `${Math.min(100, t.utilization_pct)}%` }} />
                            </div>
                            {t.utilization_pct}%
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {technicians.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
            </div>
          </div>

          <div className="ops-pool-card" style={{ marginBottom: 16 }}>
            <div className="ops-card-head">
              <div className="ops-card-title">Tempo por Tipo de Atividade — Histórico</div>
              <div className="ops-card-hint">{activities.length} tipos de atividade</div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Atividade</th>
                    <th>Execuções</th>
                    <th>Tempo Médio</th>
                    <th>Melhor Tempo</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.map((a, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 700 }}>{a.name}</td>
                      <td>{a.executions}</td>
                      <td>{formatHours(a.avg_hours)}</td>
                      <td>{formatHours(a.best_hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {activities.length === 0 && <div className="table-empty">Nenhuma atividade concluída no período.</div>}
            </div>
          </div>

          <div className="ops-pool-card" style={{ marginBottom: 16 }}>
            <div className="ops-card-head">
              <div className="ops-card-title">Produtividade por Atividade e Tecnologia</div>
              <div className="ops-card-hint">
                Horas por unidade concluída — histórico completo (não filtra por período/site). {productivityRows.length} combinação(ões)
              </div>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Atividade</th>
                    <th>Tecnologia</th>
                    <th>Complexidade</th>
                    <th>Horas / Unidade</th>
                    <th>Amostras</th>
                  </tr>
                </thead>
                <tbody>
                  {productivityRows.map((row, idx) => (
                    <tr key={idx}>
                      <td style={{ fontWeight: 700 }}>{row.activity_type_name}</td>
                      <td>{row.technology || "—"}</td>
                      <td>{row.complexity_display || "—"}</td>
                      <td>{row.avg_hours_per_unit}h</td>
                      <td>{row.sample_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {productivityRows.length === 0 && (
                <div className="table-empty">
                  Ainda sem dado suficiente — precisa de tarefas concluídas com quantidade planejada e concluída.
                </div>
              )}
            </div>
          </div>

          <div className="ops-pool-card">
            <div className="ops-card-head">
              <div className="ops-card-title">Horas Improdutivas por Motivo — Mês</div>
              <div className="ops-card-hint">Status classificados como improdutivos, mês corrente</div>
            </div>
            <div className="reason-bars">
              {unproductiveByReason.map((r) => (
                <div key={r.status} className="reason-bar-row">
                  <div className="reason-bar-label">{r.status_display}</div>
                  <div className="reason-bar-track">
                    <div className="reason-bar-fill" style={{ width: `${(r.hours / maxReasonHours) * 100}%` }} />
                  </div>
                  <div className="reason-bar-value">{formatHours(r.hours)}</div>
                </div>
              ))}
              {unproductiveByReason.length === 0 && <div className="empty-state">Nenhuma hora improdutiva registrada no mês.</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
