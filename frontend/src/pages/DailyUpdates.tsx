import { useEffect, useState } from "react";
import { collaboratorsApi, dailyUpdatesApi, projectsApi } from "../api/resources";
import type { Collaborator, DailyUpdate, Project } from "../api/types";
import { useAuth } from "../context/AuthContext";
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
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, color: "#172033" }}>Atualizações Diárias</h1>
        {canCreate && (
          <button onClick={() => setCreating((v) => !v)} style={primaryButton}>
            {creating ? "Cancelar" : "Nova Atualização"}
          </button>
        )}
      </div>

      {feedback && <p style={{ color: "#16A34A", marginBottom: 12 }}>{feedback}</p>}

      {creating && canCreate && (
        <div style={{ background: "#fff", border: "1px solid #DDE3EA", borderRadius: 12, padding: 20, marginBottom: 20 }}>
          <label style={label}>Data da alocação</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} />

          <label style={label}>Projeto</label>
          <select value={projectId} onChange={(e) => setProjectId(Number(e.target.value))} style={input}>
            <option value="">Selecione...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>

          <label style={label}>Colaboradores</label>
          <select
            multiple
            value={selectedCollaborators.map(String)}
            onChange={(e) =>
              setSelectedCollaborators(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))
            }
            style={{ ...input, height: 120 }}
          >
            {collaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <button onClick={handleCreate} style={{ ...primaryButton, marginTop: 12 }}>
            Salvar
          </button>
        </div>
      )}

      {loading ? (
        <p>Carregando...</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {updates.map((update) => (
            <div key={update.id} style={{ background: "#fff", border: "1px solid #DDE3EA", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ color: "#172033" }}>
                  {new Date(update.allocation_date + "T00:00:00").toLocaleDateString("pt-BR")}
                </strong>
                {canSend && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <a href={dailyUpdatesApi.pdfUrl(update.id)} target="_blank" rel="noreferrer" style={linkButton}>
                      PDF
                    </a>
                    <button onClick={() => handleSendEmail(update.id)} style={primaryButton}>
                      Enviar e-mail
                    </button>
                  </div>
                )}
              </div>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: 13, color: "#526174", marginTop: 10, fontFamily: "inherit" }}>
                {update.description}
              </pre>
            </div>
          ))}
          {updates.length === 0 && <p>Nenhuma atualização registrada.</p>}
        </div>
      )}
    </div>
  );
}

const label = { display: "block", fontSize: 12, fontWeight: 700, color: "#526174", margin: "12px 0 6px" };
const input = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #DDE3EA",
  fontSize: 14,
  boxSizing: "border-box" as const,
};
const primaryButton = {
  background: "#F16023",
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "8px 16px",
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};
const linkButton = {
  ...primaryButton,
  background: "#fff",
  color: "#F16023",
  border: "1px solid #F16023",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
