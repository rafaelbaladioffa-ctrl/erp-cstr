import { useEffect, useState } from "react";
import { collaboratorsApi, dailyUpdatesApi, projectsApi } from "../api/resources";
import type { Collaborator, DailyUpdate, Project } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasPerm } from "../utils/permissions";

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function initials(name: string) {
  const p = name.trim().split(" ");
  return p.length === 1 ? p[0].slice(0, 2).toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
}

const AV_COLORS = [
  { bg: "var(--blue-soft)", color: "var(--blue)" },
  { bg: "var(--green-soft)", color: "var(--green)" },
  { bg: "var(--amber-soft)", color: "var(--amber)" },
  { bg: "var(--purple-soft)", color: "var(--purple)" },
  { bg: "var(--teal-soft)", color: "var(--teal)" },
];
function avColor(id: number) { return AV_COLORS[id % AV_COLORS.length]; }

interface AllocationRow {
  projectId: number | "";
  collaboratorIds: number[];
  dateFrom: string;
  dateTo: string;
}

function emptyRow(): AllocationRow {
  const today = new Date().toISOString().slice(0, 10);
  return { projectId: "", collaboratorIds: [], dateFrom: today, dateTo: today };
}

function getDatesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const current = new Date(from + "T00:00:00");
  const end = new Date(to + "T00:00:00");
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ── Avatar stack ────────────────────────────────────────────────
function AvatarStack({ collaborators, max = 4 }: { collaborators: Collaborator[]; max?: number }) {
  const shown = collaborators.slice(0, max);
  const rest = collaborators.length - shown.length;
  return (
    <div className="du-avatar-stack">
      {shown.map((c, i) => {
        const ac = avColor(c.id);
        return (
          <div key={c.id} className="du-av" style={{ background: ac.bg, color: ac.color, zIndex: shown.length - i }}>
            {initials(c.name)}
          </div>
        );
      })}
      {rest > 0 && (
        <div className="du-av du-av-more" title={collaborators.slice(max).map((c) => c.name).join(", ")}>
          +{rest}
        </div>
      )}
    </div>
  );
}

// ── Record detail view ───────────────────────────────────────────
function RecordDetail({
  update,
  onBack,
  onPdf,
  onSendEmail,
  downloadingId,
  canSend,
  consolidatedDate,
  setConsolidatedDate,
  onDownloadConsolidated,
}: {
  update: DailyUpdate;
  onBack: () => void;
  onPdf: (id: number, date: string) => void;
  onSendEmail: (id: number) => void;
  downloadingId: number | "consolidated" | null;
  canSend: boolean;
  consolidatedDate: string;
  setConsolidatedDate: (v: string) => void;
  onDownloadConsolidated: () => void;
}) {
  const allCollaborators = update.allocations.flatMap((a) => a.collaborators ?? []);
  const uniqueCollaborators = allCollaborators.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
  const projectCount = update.allocations.length;

  return (
    <div className="du-record">
      {/* Breadcrumb back */}
      <div className="du-record-breadcrumb">
        <button className="du-back-btn" onClick={onBack}>
          <Icon name="arrow_back" style={{ fontSize: 14 }} />
          Atualizações Diárias
        </button>
        <Icon name="chevron_right" style={{ fontSize: 14, color: "var(--text-faint)" }} />
        <span style={{ color: "var(--text)", fontWeight: 500 }}>{fmtDate(update.allocation_date)}</span>
      </div>

      {/* Record header */}
      <div className="du-record-header">
        <div>
          <div className="du-record-title">Atualização Diária — {fmtDate(update.allocation_date)}</div>
          <div className="du-record-sub">
            {projectCount} projeto(s) · Criado por {update.created_by_name ?? "—"}
          </div>
        </div>
        <div className="du-record-actions">
          {canSend && (
            <>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => onPdf(update.id, update.allocation_date)}
                disabled={downloadingId === update.id}
              >
                <Icon name="picture_as_pdf" style={{ fontSize: 14 }} />
                {downloadingId === update.id ? "Gerando..." : "PDF"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => onSendEmail(update.id)}>
                <Icon name="mail" style={{ fontSize: 14 }} />
                Enviar e-mail
              </button>
            </>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="du-record-kpis">
        <div className="du-kpi">
          <div className="du-kpi-label">Projetos</div>
          <div className="du-kpi-val" style={{ color: "var(--orange)" }}>{projectCount}</div>
        </div>
        <div className="du-kpi">
          <div className="du-kpi-label">Colaboradores</div>
          <div className="du-kpi-val">{uniqueCollaborators.length}</div>
        </div>
        <div className="du-kpi">
          <div className="du-kpi-label">Data da alocação</div>
          <div className="du-kpi-val" style={{ fontSize: 14 }}>{fmtDate(update.allocation_date)}</div>
        </div>
        <div className="du-kpi">
          <div className="du-kpi-label">Criado em</div>
          <div className="du-kpi-val" style={{ fontSize: 13 }}>{fmtDateTime(update.created_at)}</div>
        </div>
        <div className="du-kpi" style={{ borderRight: "none" }}>
          <div className="du-kpi-label">Enviado por</div>
          <div className="du-kpi-val" style={{ fontSize: 13 }}>{update.created_by_name ?? "—"}</div>
        </div>
      </div>

      {/* Related list — Projetos */}
      <div className="du-record-section">
        <div className="du-section-title">Projetos ({projectCount})</div>
        <table className="du-related-table">
          <thead>
            <tr>
              <th>Projeto</th>
              <th>Colaboradores</th>
            </tr>
          </thead>
          <tbody>
            {update.allocations.map((alloc, i) => {
              const collabs = alloc.collaborators ?? [];
              return (
                <tr key={i}>
                  <td style={{ fontWeight: 600 }}>{alloc.project_name ?? `Projeto ${alloc.project}`}</td>
                  <td>
                    <div className="du-collab-list">
                      {collabs.length > 0 ? (
                        <>
                          <AvatarStack collaborators={collabs} />
                          <span className="du-collab-names">
                            {collabs.map((c) => c.name).join(", ")}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* PDF Consolidado */}
      {canSend && (
        <div className="du-record-section">
          <div className="du-section-title">PDF Consolidado do dia</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <input
              type="date"
              className="input"
              style={{ width: 160 }}
              value={consolidatedDate}
              onChange={(e) => setConsolidatedDate(e.target.value)}
            />
            <button className="btn btn-outline btn-sm" onClick={onDownloadConsolidated} disabled={downloadingId === "consolidated"}>
              <Icon name="picture_as_pdf" style={{ fontSize: 14 }} />
              {downloadingId === "consolidated" ? "Gerando..." : "Gerar PDF Consolidado"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function DailyUpdates() {
  const { user } = useAuth();
  const canCreate = hasPerm(user, PERMS.addDailyUpdate);
  const canSend = hasPerm(user, PERMS.changeDailyUpdate);
  const [updates, setUpdates] = useState<DailyUpdate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [allocationRows, setAllocationRows] = useState<AllocationRow[]>([emptyRow()]);
  const [feedback, setFeedback] = useState("");
  const [createError, setCreateError] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);
  const [consolidatedDate, setConsolidatedDate] = useState(tomorrowIso);
  const [downloadingId, setDownloadingId] = useState<number | "consolidated" | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);
  const [selectedUpdate, setSelectedUpdate] = useState<DailyUpdate | null>(null);

  function reload(currentRange: DateRange | null) {
    if (!currentRange) { setUpdates([]); setLoading(false); return; }
    setLoading(true);
    dailyUpdatesApi
      .list({ date_from: currentRange.start, date_to: currentRange.end })
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => { reload(range); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    projectsApi.list({ status: "in_progress" }).then((data) => setProjects(data.results));
    collaboratorsApi.list().then((data) => setCollaborators(data.results));
  }, []);

  function addAllocationRow() { setAllocationRows((p) => [...p, emptyRow()]); }
  function removeAllocationRow(i: number) { setAllocationRows((p) => p.filter((_, j) => j !== i)); }
  function updateAllocationRow(i: number, patch: Partial<AllocationRow>) {
    setAllocationRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function handleCreate() {
    const valid = allocationRows.filter((r) => r.projectId && r.collaboratorIds.length > 0);
    if (valid.length === 0) { setCreateError("Adicione ao menos um projeto com técnico(s)."); return; }
    if (valid.find((r) => r.dateFrom > r.dateTo)) { setCreateError("Período inválido."); return; }
    setSavingCreate(true); setCreateError("");
    try {
      const reqs: Promise<unknown>[] = [];
      for (const row of valid)
        for (const d of getDatesInRange(row.dateFrom, row.dateTo))
          reqs.push(dailyUpdatesApi.create({ allocation_date: d, allocations: [{ project: Number(row.projectId), collaborator_ids: row.collaboratorIds }] } as never));
      await Promise.all(reqs);
      setCreating(false); setAllocationRows([emptyRow()]); reload(range);
    } catch (err: unknown) {
      const d = (err as { response?: { data?: Record<string, unknown> } }).response?.data;
      setCreateError(d ? JSON.stringify(d) : "Não foi possível salvar.");
    } finally { setSavingCreate(false); }
  }

  async function handleSendEmail(id: number) {
    const result = await dailyUpdatesApi.sendEmail(id);
    setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
  }

  async function handleDownloadPdf(id: number, date: string) {
    setDownloadingId(id);
    try { await downloadAuthenticatedFile(dailyUpdatesApi.pdfPath(id), `atualizacao-diaria-${date}.pdf`); }
    finally { setDownloadingId(null); }
  }

  async function handleDownloadConsolidated() {
    if (!consolidatedDate) return;
    setDownloadingId("consolidated");
    try { await downloadAuthenticatedFile(dailyUpdatesApi.consolidatedPdfPath(consolidatedDate), `atualizacao-diaria-${consolidatedDate}.pdf`); }
    catch { alert("Não foi possível gerar o PDF. Verifique se existem atualizações para a data."); }
    finally { setDownloadingId(null); }
  }

  // ── Record detail view ──────────────────────────────────────────
  if (selectedUpdate) {
    return (
      <RecordDetail
        update={selectedUpdate}
        onBack={() => setSelectedUpdate(null)}
        onPdf={handleDownloadPdf}
        onSendEmail={handleSendEmail}
        downloadingId={downloadingId}
        canSend={canSend}
        consolidatedDate={consolidatedDate}
        setConsolidatedDate={setConsolidatedDate}
        onDownloadConsolidated={handleDownloadConsolidated}
      />
    );
  }

  // ── List view ───────────────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div className="du-page-header">
        <div>
          <div className="du-page-eyebrow">Área Operacional</div>
          <h1 className="du-page-title">Atualizações Diárias</h1>
          <div className="du-page-subtitle">Consolidado diário de alocação da equipe</div>
        </div>
        <div className="du-header-actions">
          {canSend && (
            <button className="btn btn-outline btn-sm" onClick={handleDownloadConsolidated} disabled={downloadingId === "consolidated"}>
              <Icon name="picture_as_pdf" style={{ fontSize: 14 }} />
              PDF Consolidado
            </button>
          )}
          {canCreate && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => { setCreating((v) => !v); setAllocationRows([emptyRow()]); setCreateError(""); }}
            >
              <Icon name={creating ? "close" : "add"} style={{ fontSize: 15 }} />
              {creating ? "Cancelar" : "Nova Atualização"}
            </button>
          )}
        </div>
      </div>

      {/* Toolbar */}
      <div className="du-toolbar">
        <span className="du-toolbar-label">Período</span>
        <DateRangeCalendar value={range} onChange={(r) => { setRange(r); setSelectedUpdate(null); }} maxDays={7} />
        {canSend && (
          <>
            <div className="du-toolbar-sep" />
            <span className="du-toolbar-label">PDF Consolidado</span>
            <input type="date" className="input" style={{ width: 150, height: 30, fontSize: 12 }} value={consolidatedDate} onChange={(e) => setConsolidatedDate(e.target.value)} />
            <button className="btn btn-outline btn-sm" onClick={handleDownloadConsolidated} disabled={downloadingId === "consolidated"}>
              <Icon name="picture_as_pdf" style={{ fontSize: 13 }} />
              {downloadingId === "consolidated" ? "Gerando..." : "Gerar"}
            </button>
          </>
        )}
        {range && (
          <span className="du-record-count">{updates.length} registro(s)</span>
        )}
      </div>

      {feedback && (
        <div className="du-feedback">{feedback}</div>
      )}

      {/* Form de criação */}
      {creating && canCreate && (
        <div className="du-form-wrap">
          <div className="du-form-titlebar">
            Nova Atualização Diária
            <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
              <Icon name="close" style={{ fontSize: 16 }} />
            </button>
          </div>
          <div className="du-form-body">
            <table className="du-inline-table">
              <thead>
                <tr>
                  <th>Projeto</th>
                  <th style={{ width: 140 }}>Data inicial</th>
                  <th style={{ width: 140 }}>Data final</th>
                  <th>Técnicos</th>
                  <th style={{ width: 32 }}></th>
                </tr>
              </thead>
              <tbody>
                {allocationRows.map((row, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        className="input"
                        style={{ fontSize: 12, padding: "5px 8px" }}
                        value={row.projectId}
                        onChange={(e) => updateAllocationRow(index, { projectId: Number(e.target.value) })}
                      >
                        <option value="">Selecione...</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input"
                        style={{ fontSize: 12, padding: "5px 8px" }}
                        value={row.dateFrom}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateAllocationRow(index, { dateFrom: v, dateTo: v > row.dateTo ? v : row.dateTo });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="input"
                        style={{ fontSize: 12, padding: "5px 8px" }}
                        value={row.dateTo}
                        min={row.dateFrom}
                        onChange={(e) => updateAllocationRow(index, { dateTo: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        multiple
                        className="input"
                        style={{ fontSize: 12, padding: "4px 8px", height: 72 }}
                        value={row.collaboratorIds.map(String)}
                        onChange={(e) =>
                          updateAllocationRow(index, { collaboratorIds: Array.from(e.target.selectedOptions).map((o) => Number(o.value)) })
                        }
                      >
                        {collaborators.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ textAlign: "center", verticalAlign: "middle" }}>
                      {allocationRows.length > 1 && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: "var(--red)", padding: "4px 6px" }}
                          onClick={() => removeAllocationRow(index)}
                        >
                          <Icon name="delete" style={{ fontSize: 14 }} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ padding: "8px 10px" }}>
                    <button type="button" className="du-add-row-btn" onClick={addAllocationRow}>
                      <Icon name="add" style={{ fontSize: 14 }} /> Adicionar projeto
                    </button>
                  </td>
                </tr>
              </tfoot>
            </table>
            {createError && <p style={{ color: "var(--red)", fontSize: 12, padding: "0 12px 8px" }}>{createError}</p>}
          </div>
          <div className="du-form-footer">
            <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancelar</button>
            <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={savingCreate}>
              {savingCreate ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      )}

      {/* List view */}
      {loading ? (
        <p style={{ color: "var(--text-muted)", padding: "20px 0" }}>Carregando...</p>
      ) : !range ? (
        <div className="empty-state" style={{ marginTop: 24 }}>
          <Icon name="calendar_month" style={{ fontSize: 28, color: "var(--text-faint)" }} />
          <p style={{ marginTop: 8 }}>Selecione um período acima para ver as Atualizações Diárias.</p>
        </div>
      ) : (
        <div className="du-list-wrap">
          <div className="du-list-head">
            <div className="du-th" style={{ width: 120 }}>Data</div>
            <div className="du-th">Projetos</div>
            <div className="du-th" style={{ width: 200 }}>Colaboradores</div>
            <div className="du-th" style={{ width: 130 }}>Enviado por</div>
            <div className="du-th" style={{ width: 120 }}></div>
          </div>

          {updates.length === 0 && (
            <div className="du-list-empty">Nenhuma atualização encontrada no período.</div>
          )}

          {updates.map((update) => {
            const allCollabs = update.allocations.flatMap((a) => a.collaborators ?? []);
            const uniqueCollabs = allCollabs.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i);
            const projNames = update.allocations.map((a) => a.project_name ?? `Projeto ${a.project}`);

            return (
              <div
                key={update.id}
                className="du-list-row"
                onClick={() => setSelectedUpdate(update)}
              >
                <div className="du-td du-td-date">
                  {fmtDate(update.allocation_date)}
                </div>
                <div className="du-td du-td-projects">
                  {projNames.length === 1 ? (
                    <span className="du-proj-link">{projNames[0]}</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      {projNames.map((n, i) => <span key={i} className="du-proj-link">{n}</span>)}
                    </div>
                  )}
                </div>
                <div className="du-td">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <AvatarStack collaborators={uniqueCollabs} />
                    {uniqueCollabs.length > 0 && (
                      <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
                        {uniqueCollabs.length === 1 ? uniqueCollabs[0].name : `${uniqueCollabs[0].name.split(" ")[0]} +${uniqueCollabs.length - 1}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className="du-td" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {update.created_by_name ?? "—"}
                </div>
                <div className="du-td du-td-actions" onClick={(e) => e.stopPropagation()}>
                  {canSend && (
                    <>
                      <button
                        className="du-row-btn"
                        onClick={() => handleDownloadPdf(update.id, update.allocation_date)}
                        disabled={downloadingId === update.id}
                      >
                        {downloadingId === update.id ? "..." : "PDF"}
                      </button>
                      <button
                        className="du-row-btn du-row-btn-primary"
                        onClick={() => handleSendEmail(update.id)}
                      >
                        Enviar e-mail
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
