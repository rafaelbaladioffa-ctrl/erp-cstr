import { Fragment, useEffect, useMemo, useState } from "react";
import { auditLogApi } from "../api/resources";
import type { AuditLogEntry } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import Pagination from "../components/ui/Pagination";

const ACTION_OPTIONS = [
  { value: "", label: "Todas" },
  { value: "create", label: "Inclusão" },
  { value: "update", label: "Alteração" },
  { value: "delete", label: "Exclusão" },
  { value: "m2m_add", label: "Vínculo adicionado" },
  { value: "m2m_remove", label: "Vínculo removido" },
  { value: "m2m_clear", label: "Vínculos removidos" },
  { value: "export", label: "Exportação" },
];

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR");
}

export default function AuditLog() {
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [appLabel, setAppLabel] = useState("");
  const [modelName, setModelName] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  function reload() {
    setLoading(true);
    const params: Record<string, string> = { page_size: "1000" };
    if (action) params.action = action;
    if (appLabel) params.app_label = appLabel;
    if (modelName) params.model_name = modelName;
    if (search) params.search = search;
    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    auditLogApi
      .list(params)
      .then((data) => setRows(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, appLabel, modelName, search, dateFrom, dateTo]);

  const appOptions = useMemo(() => Array.from(new Set(rows.map((r) => r.app_label))).sort(), [rows]);
  const paged = rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div>
      <PageHeader
        eyebrow="Segurança"
        title="Log de Auditoria"
        subtitle="Histórico de alterações no sistema — visível apenas para superusuários."
      />

      <div className="card">
        <div className="filter-row">
          <div className="search-input-wrap" style={{ flex: 1, minWidth: 220 }}>
            <Icon name="search" />
            <input
              className="input"
              placeholder="Buscar por registro ou usuário..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="field-group">
            <span className="field-label">Ação</span>
            <select className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              {ACTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Aplicação</span>
            <select className="select" value={appLabel} onChange={(e) => setAppLabel(e.target.value)}>
              <option value="">Todas</option>
              {appOptions.map((app) => (
                <option key={app} value={app}>
                  {app}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <span className="field-label">Cadastro</span>
            <input className="input" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="ex: project" />
          </div>
          <div className="field-group">
            <span className="field-label">De</span>
            <input type="date" className="input" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="field-group">
            <span className="field-label">Até</span>
            <input type="date" className="input" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>Carregando...</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data/Hora</th>
                  <th>Usuário</th>
                  <th>Aplicação</th>
                  <th>Cadastro</th>
                  <th>Registro</th>
                  <th>Ação</th>
                  <th>Campo</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <Fragment key={row.id}>
                    <tr onClick={() => setExpandedId(expandedId === row.id ? null : row.id)} style={{ cursor: "pointer" }}>
                      <td>{formatDateTime(row.created_at)}</td>
                      <td>{row.actor_name || "—"}</td>
                      <td>{row.app_label}</td>
                      <td>{row.model_name}</td>
                      <td>{row.object_repr || row.object_pk || "—"}</td>
                      <td>{row.action_display}</td>
                      <td>{row.field_name || "—"}</td>
                      <td>
                        <Icon name={expandedId === row.id ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr>
                        <td colSpan={8} style={{ background: "var(--bg)" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, padding: "10px 4px", fontSize: 12.5 }}>
                            <div>
                              <strong>Valor anterior</strong>
                              <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{row.old_value || "—"}</div>
                            </div>
                            <div>
                              <strong>Novo valor</strong>
                              <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{row.new_value || "—"}</div>
                            </div>
                            <div>
                              <strong>Origem</strong>
                              <div style={{ color: "var(--text-muted)" }}>{row.origin || "—"}</div>
                            </div>
                            <div>
                              <strong>Caminho</strong>
                              <div style={{ color: "var(--text-muted)" }}>{row.path || "—"}</div>
                            </div>
                            <div>
                              <strong>Endereço IP</strong>
                              <div style={{ color: "var(--text-muted)" }}>{row.ip_address || "—"}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={8}>
                      <div className="table-empty">Nenhum registro encontrado.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination page={page} pageSize={pageSize} total={rows.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>
    </div>
  );
}
