import { useEffect, useState } from "react";
import { collaboratorsApi, projectsApi, projectUpdatesApi } from "../api/resources";
import type { Collaborator, Project, ProjectDailyUpdate } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
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
    <div>
      <PageHeader
        eyebrow="Área Operacional"
        title="Atualizações de Projeto"
        subtitle="Gere, edite e envie o status consolidado de cada projeto."
        actions={
          canCreate ? (
            <button className="btn btn-primary" onClick={() => setCreating((v) => !v)}>
              <Icon name={creating ? "close" : "add"} style={{ fontSize: 18 }} />
              {creating ? "Cancelar" : "Nova Atualização"}
            </button>
          ) : undefined
        }
      />

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {creating && canCreate && (
            <div className="form-card">
              <label className="form-label">Projeto</label>
              <select className="input" value={newProjectId} onChange={(e) => setNewProjectId(Number(e.target.value))}>
                <option value="">Selecione...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </option>
                ))}
              </select>

              <label className="form-label">Data</label>
              <input type="date" className="input" value={newDate} onChange={(e) => setNewDate(e.target.value)} />

              <label className="form-label">Observações (opcional)</label>
              <textarea className="input" value={newSummary} onChange={(e) => setNewSummary(e.target.value)} style={{ height: 80 }} />

              <button className="btn btn-primary" onClick={handleGenerate} style={{ marginTop: 14 }}>
                Gerar Atualização
              </button>
            </div>
          )}

          {loading ? (
            <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {updates.map((update) => (
                <div
                  key={update.id}
                  onClick={() => setSelected(update)}
                  className="card"
                  style={{
                    padding: 14,
                    cursor: "pointer",
                    borderColor: selected?.id === update.id ? "var(--orange)" : undefined,
                    borderWidth: selected?.id === update.id ? 2 : undefined,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <strong style={{ color: "var(--text)" }}>{update.project_name}</strong>
                    <span style={{ fontSize: 12, fontWeight: 700, color: update.is_sent ? "var(--green)" : "var(--amber)" }}>
                      {update.is_sent ? "Enviado" : "Não enviado"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    {new Date(update.date + "T00:00:00").toLocaleDateString("pt-BR")} · {update.completion_percent}%
                  </div>
                </div>
              ))}
              {updates.length === 0 && <div className="empty-state">Nenhuma atualização registrada.</div>}
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
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  async function handleDownloadPdf() {
    setDownloadingPdf(true);
    try {
      await downloadAuthenticatedFile(projectUpdatesApi.pdfPath(update.id), `atualizacao-projeto-${update.project}-${update.date}.pdf`);
    } finally {
      setDownloadingPdf(false);
    }
  }

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
    <div className="card" style={{ flex: 1, padding: 20, maxWidth: 440, flexShrink: 0 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>{update.project_name}</h2>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>{update.project_code}</p>

      <label className="form-label">Colaboradores</label>
      <select
        multiple
        disabled={!canEdit}
        className="input"
        value={update.collaborators.map((c) => String(c.id))}
        onChange={(e) => {
          const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
          save({ collaborators: collaborators.filter((c) => ids.includes(c.id)) });
        }}
        style={{ height: 100 }}
      >
        {collaborators.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>

      <label className="form-label">Percentual de Conclusão</label>
      <input
        type="number"
        min={0}
        max={100}
        disabled={!canEdit}
        className="input"
        value={update.completion_percent}
        onChange={(e) => onChange({ ...update, completion_percent: Number(e.target.value) })}
        onBlur={(e) => save({ completion_percent: Number(e.target.value) })}
      />

      <label className="form-label">Atividades Executadas</label>
      <textarea
        disabled={!canEdit}
        className="input"
        value={update.activities_text}
        onChange={(e) => onChange({ ...update, activities_text: e.target.value })}
        onBlur={(e) => save({ activities_text: e.target.value })}
        style={{ height: 90 }}
      />

      <div style={{ display: "flex", gap: 16, margin: "14px 0" }}>
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

      <label className="form-label">Observações</label>
      <textarea
        disabled={!canEdit}
        className="input"
        value={update.summary}
        onChange={(e) => onChange({ ...update, summary: e.target.value })}
        onBlur={(e) => save({ summary: e.target.value })}
        style={{ height: 70 }}
      />

      {saving && <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Salvando...</p>}

      <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 16, fontSize: 12, whiteSpace: "pre-wrap", maxHeight: 220, overflowY: "auto" }}>
        {update.preview}
      </div>

      {feedback && <p style={{ fontSize: 12, color: "var(--green)", marginTop: 8, fontWeight: 600 }}>{feedback}</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={copyText} className="btn btn-secondary">
          {copied ? "Copiado!" : "Copiar Texto"}
        </button>
        {canEdit && (
          <>
            <button onClick={handleDownloadPdf} disabled={downloadingPdf} className="btn btn-secondary">
              {downloadingPdf ? "Gerando..." : "Baixar PDF"}
            </button>
            <button onClick={handleSendEmail} className="btn btn-primary">
              Enviar por E-mail
            </button>
          </>
        )}
      </div>
    </div>
  );
}
