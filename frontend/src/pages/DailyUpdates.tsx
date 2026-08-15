import { useEffect, useState } from "react";
import { collaboratorsApi, dailyUpdatesApi, projectsApi } from "../api/resources";
import type { Collaborator, DailyUpdate, Project } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { PERMS, hasPerm } from "../utils/permissions";

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

  function reload() {
    setLoading(true);
    dailyUpdatesApi
      .list()
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
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
    reload();
  }

  async function handleSendEmail(id: number) {
    const result = await dailyUpdatesApi.sendEmail(id);
    setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
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

          <label className="form-label">Colaboradores</label>
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
                    <a href={dailyUpdatesApi.pdfUrl(update.id)} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
                      PDF
                    </a>
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
