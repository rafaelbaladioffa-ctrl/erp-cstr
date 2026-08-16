import { useEffect, useState } from "react";
import { collaboratorsApi, dailyUpdatesApi, projectsApi } from "../api/resources";
import type { Collaborator, DailyUpdate, Project } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasPerm } from "../utils/permissions";

function tomorrowIso() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function DailyUpdates() {
  const { user } = useAuth();
  const canCreate = hasPerm(user, PERMS.addDailyUpdate);
  const canSend = hasPerm(user, PERMS.changeDailyUpdate);
  const [updates, setUpdates] = useState<DailyUpdate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState<number | "">("");
  const [selectedCollaborators, setSelectedCollaborators] = useState<number[]>([]);
  const [feedback, setFeedback] = useState("");
  const [consolidatedDate, setConsolidatedDate] = useState(tomorrowIso);
  const [downloadingId, setDownloadingId] = useState<number | "consolidated" | null>(null);
  const [range, setRange] = useState<DateRange | null>(null);

  function reload(currentRange: DateRange | null) {
    if (!currentRange) {
      setUpdates([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    dailyUpdatesApi
      .list({ date_from: currentRange.start, date_to: currentRange.end })
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range]);

  useEffect(() => {
    projectsApi.list({ status: "in_progress" }).then((data) => setProjects(data.results));
    collaboratorsApi.list().then((data) => setCollaborators(data.results));
  }, []);

  async function handleCreate() {
    if (!projectId || selectedCollaborators.length === 0) return;
    await dailyUpdatesApi.create({
      allocation_date: date,
      allocations: [{ project: Number(projectId), collaborator_ids: selectedCollaborators }],
    } as never);
    setCreating(false);
    setProjectId("");
    setSelectedCollaborators([]);
    reload(range);
  }

  async function handleSendEmail(id: number) {
    const result = await dailyUpdatesApi.sendEmail(id);
    setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
  }

  async function handleDownloadPdf(id: number, date: string) {
    setDownloadingId(id);
    try {
      await downloadAuthenticatedFile(dailyUpdatesApi.pdfPath(id), `atualizacao-diaria-${date}.pdf`);
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDownloadConsolidated() {
    if (!consolidatedDate) return;
    setDownloadingId("consolidated");
    try {
      await downloadAuthenticatedFile(dailyUpdatesApi.consolidatedPdfPath(consolidatedDate), `atualizacao-diaria-${consolidatedDate}.pdf`);
    } catch {
      alert("Não foi possível gerar o PDF consolidado. Verifique se existem Atualizações Diárias para a data selecionada.");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="Área Operacional"
        title="Atualizações Diárias"
        subtitle="Registre e envie o consolidado diário de alocação da equipe."
        actions={
          canCreate ? (
            <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
              <Icon name={creating ? "close" : "add"} style={{ fontSize: 18 }} />
              {creating ? "Cancelar" : "Nova Atualização"}
            </button>
          ) : undefined
        }
      />

      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">Período</span>
          <DateRangeCalendar value={range} onChange={setRange} maxDays={7} />
          {range && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {updates.length} atualização(ões) encontrada(s)
            </span>
          )}
        </div>

        {canSend && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginLeft: "auto" }}>
            <div className="field-group">
              <span className="field-label">Gerar PDF Consolidado do dia</span>
              <input type="date" className="input" value={consolidatedDate} onChange={(e) => setConsolidatedDate(e.target.value)} />
            </div>
            <button className="btn btn-outline" onClick={handleDownloadConsolidated} disabled={downloadingId === "consolidated"}>
              <Icon name="picture_as_pdf" style={{ fontSize: 16 }} />
              {downloadingId === "consolidated" ? "Gerando..." : "Gerar PDF Consolidado"}
            </button>
          </div>
        )}
      </div>

      {feedback && (
        <div className="card" style={{ padding: 12, marginBottom: 16, color: "var(--green)", fontSize: 13, fontWeight: 600 }}>
          {feedback}
        </div>
      )}

      {creating && canCreate && (
        <div className="form-card">
          <label className="form-label">Data da alocação</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />

          <label className="form-label">Projeto</label>
          <select className="input" value={projectId} onChange={(e) => setProjectId(Number(e.target.value))}>
            <option value="">Selecione...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <label className="form-label">Técnicos</label>
          <select
            multiple
            className="input"
            value={selectedCollaborators.map(String)}
            onChange={(e) =>
              setSelectedCollaborators(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
            }
            style={{ height: 120 }}
          >
            {collaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button className="btn btn-primary" onClick={handleCreate} style={{ marginTop: 14 }}>
            Salvar
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : !range ? (
        <div className="empty-state">
          <Icon name="calendar_month" style={{ fontSize: 28, color: "var(--text-faint)" }} />
          <p style={{ marginTop: 8 }}>Selecione um período acima para ver as Atualizações Diárias.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {updates.map((update) => (
            <div key={update.id} className="card" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "var(--text)" }}>
                  {new Date(update.allocation_date + "T00:00:00").toLocaleDateString("pt-BR")}
                </strong>
                {canSend && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={() => handleDownloadPdf(update.id, update.allocation_date)}
                      disabled={downloadingId === update.id}
                      className="btn btn-secondary btn-sm"
                    >
                      {downloadingId === update.id ? "Gerando..." : "PDF"}
                    </button>
                    <button onClick={() => handleSendEmail(update.id)} className="btn btn-primary btn-sm">
                      Enviar e-mail
                    </button>
                  </div>
                )}
              </div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "var(--text-muted)", marginTop: 10, fontFamily: "inherit" }}>
                {update.description}
              </pre>
            </div>
          ))}
          {updates.length === 0 && <div className="empty-state">Nenhuma atualização registrada.</div>}
        </div>
      )}
    </div>
  );
}
