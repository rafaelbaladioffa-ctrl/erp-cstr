import { useEffect, useState } from "react";
import { collaboratorsApi, projectsApi, projectUpdatesApi } from "../api/resources";
import type { Collaborator, Project, ProjectDailyUpdate } from "../api/types";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

export default function ProjectUpdates() {
  const { user } = useAuth();
  const canCreate = hasPerm(user, PERMS.addProjectUpdate);
  const canEdit = hasPerm(user, PERMS.changeProjectUpdate);
  const [updates, setUpdates] = useState<ProjectDailyUpdate[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ProjectDailyUpdate | null>(null);

  const [newProjectId, setNewProjectId] = useState<number | "">("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSummary, setNewSummary] = useState("");

  function reload() {
    setLoading(true);
    projectUpdatesApi
      .list()
      .then((data) => setUpdates(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    projectsApi.list().then((data) => setProjects(data.results));
    collaboratorsApi.list().then((data) => setCollaborators(data.results));
  }, []);

  async function handleGenerate() {
    if (!newProjectId) return;
    const created = await projectUpdatesApi.create({
      project: Number(newProjectId),
      date: newDate,
      summary: newSummary,
    });
    setCreating(false);
    setNewProjectId("");
    setNewSummary("");
    reload();
    setSelected(created);
  }

  return (
    <div style={{ display: "flex", gap: 24 }}>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h1 style={{ fontSize: 22, color: "#172033" }}>Atualizações de Projeto</h1>
          {canCreate && (
            <button onClick={() => setCreating((v) => !v)} style={primaryButton}>
              {creating ? "Cancelar" : "Nova Atualização"}
            </button>
          )}
        </div>

        {creating && canCreate && (
          <div style={{ background: "#fff", border: "1px solid #DDE3EA", borderRadius: 12, padding: 20, marginBottom: 20 }}>
            <label style={label}>Projeto</label>
            <select value={newProjectId} onChange={(e) => setNewProjectId(Number(e.target.value))} style={input}>
              <option value="">Selecione...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} — {p.name}
                </option>
              ))}
            </select>

            <label style={label}>Data</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} style={input} />

            <label style={label}>Observações (opcional)</label>
            <textarea value={newSummary} onChange={(e) => setNewSummary(e.target.value)} style={{ ...input, height: 80 }} />

            <button onClick={handleGenerate} style={{ ...primaryButton, marginTop: 12 }}>
              Gerar Atualização
            </button>
          </div>
        )}

        {loading ? (
          <p>Carregando...</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {updates.map((update) => (
              <div
                key={update.id}
                onClick={() => setSelected(update)}
                style={{
                  background: "#fff",
                  border: selected?.id === update.id ? "2px solid #F16023" : "1px solid #DDE3EA",
                  borderRadius: 12,
                  padding: 14,
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong style={{ color: "#172033" }}>{update.project_name}</strong>
                  <span style={{ fontSize: 12, color: update.is_sent ? "#16A34A" : "#D97706" }}>
                    {update.is_sent ? "Enviado" : "Não enviado"}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#526174" }}>
                  {new Date(update.date + "T00:00:00").toLocaleDateString("pt-BR")} · {update.completion_percent}%
                </div>
              </div>
            ))}
            {updates.length === 0 && <p>Nenhuma atualização registrada.</p>}
          </div>
        )}
      </div>

      {selected && (
        <ProjectUpdateEditor
          update={selected}
          collaborators={collaborators}
          canEdit={canEdit}
          onChange={(u) => {
            setSelected(u);
            setUpdates((prev) => prev.map((item) => (item.id === u.id ? u : item)));
          }}
        />
      )}
    </div>
  );
}

function ProjectUpdateEditor({
  update,
  collaborators,
  canEdit,
  onChange,
}: {
  update: ProjectDailyUpdate;
  collaborators: Collaborator[];
  canEdit: boolean;
  onChange: (u: ProjectDailyUpdate) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [copied, setCopied] = useState(false);

  async function save(patch: Partial<ProjectDailyUpdate>) {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { ...patch };
      if (patch.collaborators) {
        payload.collaborator_ids = patch.collaborators.map((c) => c.id);
        delete payload.collaborators;
      }
      const updated = await projectUpdatesApi.update(update.id, payload);
      onChange(updated);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEmail() {
    const result = await projectUpdatesApi.sendEmail(update.id);
    if (result.detail) {
      setFeedback(result.detail);
    } else {
      setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
      const refreshed = await projectUpdatesApi.get(update.id);
      onChange(refreshed);
    }
  }

  function copyText() {
    if (!update.preview) return;
    navigator.clipboard.writeText(update.preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ flex: 1, background: "#fff", border: "1px solid #DDE3EA", borderRadius: 12, padding: 20, maxWidth: 460 }}>
      <h2 style={{ fontSize: 16, color: "#172033", marginBottom: 4 }}>{update.project_name}</h2>
      <p style={{ fontSize: 13, color: "#526174", marginBottom: 16 }}>{update.project_code}</p>

      <label style={label}>Colaboradores</label>
      <select
        multiple
        disabled={!canEdit}
        value={update.collaborators.map((c) => String(c.id))}
        onChange={(e) => {
          const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
          save({ collaborators: collaborators.filter((c) => ids.includes(c.id)) });
        }}
        style={{ ...input, height: 100 }}
      >
        {collaborators.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label style={label}>Percentual de Conclusão</label>
      <input
        type="number"
        min={0}
        max={100}
        disabled={!canEdit}
        value={update.completion_percent}
        onChange={(e) => onChange({ ...update, completion_percent: Number(e.target.value) })}
        onBlur={(e) => save({ completion_percent: Number(e.target.value) })}
        style={input}
      />

      <label style={label}>Atividades Executadas</label>
      <textarea
        disabled={!canEdit}
        value={update.activities_text}
        onChange={(e) => onChange({ ...update, activities_text: e.target.value })}
        onBlur={(e) => save({ activities_text: e.target.value })}
        style={{ ...input, height: 90 }}
      />

      <div style={{ display: "flex", gap: 16, margin: "12px 0" }}>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={update.certification_done}
            onChange={(e) => save({ certification_done: e.target.checked })}
          />
          Certificação Finalizada
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={update.project_finished}
            onChange={(e) => save({ project_finished: e.target.checked })}
          />
          Projeto Finalizado
        </label>
      </div>

      <label style={label}>Observações</label>
      <textarea
        disabled={!canEdit}
        value={update.summary}
        onChange={(e) => onChange({ ...update, summary: e.target.value })}
        onBlur={(e) => save({ summary: e.target.value })}
        style={{ ...input, height: 70 }}
      />

      {saving && <p style={{ fontSize: 12, color: "#526174" }}>Salvando...</p>}

      <div style={{ background: "#F7F9FB", border: "1px solid #DDE3EA", borderRadius: 8, padding: 12, marginTop: 16, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>
        {update.preview}
      </div>

      {feedback && <p style={{ fontSize: 12, color: "#16A34A", marginTop: 8 }}>{feedback}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={copyText} style={secondaryButton}>
          {copied ? "Copiado!" : "Copiar Texto"}
        </button>
        {canEdit && (
          <>
            <a href={projectUpdatesApi.pdfUrl(update.id)} target="_blank" rel="noreferrer" style={secondaryButton}>
              Baixar PDF
            </a>
            <button onClick={handleSendEmail} style={primaryButton}>
              Enviar por E-mail
            </button>
          </>
        )}
      </div>
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
const secondaryButton = {
  ...primaryButton,
  background: "#fff",
  color: "#F16023",
  border: "1px solid #F16023",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};
