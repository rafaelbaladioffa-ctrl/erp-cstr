import { useEffect, useState } from "react";
import { collaboratorsApi, projectsApi, projectUpdatesApi, usersApi } from "../api/resources";
import type { Collaborator, Project, ProjectDailyUpdate, UserOption } from "../api/types";
import { useAuth } from "../context/AuthContext";
import DateRangeCalendar, { type DateRange } from "../components/ui/DateRangeCalendar";
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
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<ProjectDailyUpdate | null>(null);

  const [newProjectId, setNewProjectId] = useState<number | "">("");
  const [newDate, setNewDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [newSummary, setNewSummary] = useState("");
  const [generateError, setGenerateError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "sent" | "pending">("all");
  const [range, setRange] = useState<DateRange | null>(null);

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
    usersApi.options().then(setUserOptions);
  }, []);

  async function handleGenerate() {
    if (!newProjectId) return;
    setGenerating(true);
    setGenerateError("");
    try {
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
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: Record<string, string[]> } };
      const data = axiosErr.response?.data;
      const raw = data ? Object.values(data).flat().join(" ") : "";
      const message = raw.includes("devem criar um set único")
        ? "Já existe uma atualização para este projeto nesta data. Edite a atualização existente na lista abaixo."
        : raw || "Não foi possível gerar a atualização.";
      setGenerateError(message);
    } finally {
      setGenerating(false);
    }
  }

  const poByProject: Record<number, string> = {};
  projects.forEach((p) => {
    poByProject[p.id] = p.po || "";
  });

  const term = search.trim().toLowerCase();
  const hasFilter = term !== "" || range !== null;

  const filteredUpdates = hasFilter
    ? updates.filter((update) => {
        if (statusFilter === "sent" && !update.is_sent) return false;
        if (statusFilter === "pending" && update.is_sent) return false;
        if (range && (update.date < range.start || update.date > range.end)) return false;
        if (term) {
          const po = (poByProject[update.project] || "").toLowerCase();
          const matches =
            update.project_name.toLowerCase().includes(term) ||
            update.project_code.toLowerCase().includes(term) ||
            po.includes(term);
          if (!matches) return false;
        }
        return true;
      })
    : [];

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

      <div className="card" style={{ padding: 14, marginBottom: 16, display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">Período</span>
          <DateRangeCalendar value={range} onChange={setRange} maxDays={31} />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="field-label">Buscar</span>
          <input
            type="text"
            className="input"
            placeholder="PO ou nome do projeto..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 220 }}
          />
          {hasFilter && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {filteredUpdates.length} atualização(ões) encontrada(s)
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginLeft: "auto" }}>
          <div className="field-group">
            <span className="field-label">Status</span>
            <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
              <option value="all">Todos</option>
              <option value="sent">Enviado</option>
              <option value="pending">Não enviado</option>
            </select>
          </div>
        </div>
      </div>

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

          {generateError && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{generateError}</p>}

          <button className="btn btn-primary" onClick={handleGenerate} disabled={generating} style={{ marginTop: 14 }}>
            {generating ? "Gerando..." : "Gerar Atualização"}
          </button>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : !hasFilter ? (
        <div className="empty-state">
          <Icon name="calendar_month" style={{ fontSize: 28, color: "var(--text-faint)" }} />
          <p style={{ marginTop: 8 }}>Selecione um período ou busque por PO/nome do projeto acima para ver as Atualizações de Projeto.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {filteredUpdates.map((update) => {
            const expanded = selected?.id === update.id;
            return (
              <div key={update.id} className="card" style={{ padding: 16 }}>
                <div
                  onClick={() => setSelected(expanded ? null : update)}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
                >
                  <div>
                    <strong style={{ color: "var(--text)" }}>{update.project_name}</strong>
                    <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 2 }}>
                      {update.project_code} · {new Date(update.date + "T00:00:00").toLocaleDateString("pt-BR")} · {update.completion_percent}%
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, color: update.is_sent ? "var(--green)" : "var(--amber)" }}>
                      {update.is_sent ? "Enviado" : "Não enviado"}
                    </span>
                    <Icon name={expanded ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                  </div>
                </div>

                {expanded && (
                  <ProjectUpdateEditor
                    update={update}
                    collaborators={collaborators}
                    userOptions={userOptions}
                    canEdit={canEdit}
                    onChange={(u) => {
                      setSelected(u);
                      setUpdates((prev) => prev.map((item) => (item.id === u.id ? u : item)));
                    }}
                  />
                )}
              </div>
            );
          })}
          {filteredUpdates.length === 0 && <div className="empty-state">Nenhuma atualização encontrada para o filtro.</div>}
        </div>
      )}
    </div>
  );
}

function ProjectUpdateEditor({
  update,
  collaborators,
  userOptions,
  canEdit,
  onChange,
}: {
  update: ProjectDailyUpdate;
  collaborators: Collaborator[];
  userOptions: UserOption[];
  canEdit: boolean;
  onChange: (u: ProjectDailyUpdate) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [recipientsOpen, setRecipientsOpen] = useState(false);
  const [extraUserIds, setExtraUserIds] = useState<number[]>([]);
  const [extraEmailsText, setExtraEmailsText] = useState("");

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
    const emails = extraEmailsText
      .split(/[,;\n]/)
      .map((e) => e.trim())
      .filter(Boolean);
    setSendingEmail(true);
    setFeedback("");
    setFeedbackError("");
    try {
      const result = await projectUpdatesApi.sendEmail(update.id, { user_ids: extraUserIds, emails });
      if (result.detail) {
        setFeedbackError(result.detail);
      } else {
        setFeedback(`${result.sent.length} e-mail(s) enviado(s).${result.skipped.length ? ` Sem e-mail: ${result.skipped.join(", ")}` : ""}`);
        const refreshed = await projectUpdatesApi.get(update.id);
        onChange(refreshed);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setFeedbackError(axiosErr.response?.data?.detail || "Não foi possível enviar o e-mail.");
    } finally {
      setSendingEmail(false);
    }
  }

  function copyText() {
    if (!update.preview) return;
    navigator.clipboard.writeText(update.preview);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid var(--border)" }} onClick={(e) => e.stopPropagation()}>
      <label className="form-label">Técnicos</label>
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
      {feedbackError && <p style={{ fontSize: 12, color: "var(--red)", marginTop: 8, fontWeight: 600 }}>{feedbackError}</p>}

      {canEdit && (
        <div style={{ marginTop: 14 }}>
          <button
            type="button"
            onClick={() => setRecipientsOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--text-muted)", fontSize: 12.5 }}
          >
            <Icon name={recipientsOpen ? "expand_less" : "expand_more"} style={{ fontSize: 16 }} />
            Destinatários adicionais {extraUserIds.length + extraEmailsText.split(/[,;\n]/).filter((e) => e.trim()).length > 0
              ? `(${extraUserIds.length + extraEmailsText.split(/[,;\n]/).filter((e) => e.trim()).length})`
              : ""}
          </button>

          {recipientsOpen && (
            <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginTop: 8 }}>
              <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 8 }}>
                Além dos responsáveis do cliente vinculado ao projeto, você pode escolher usuários do sistema e/ou digitar e-mails avulsos.
              </p>

              <label className="form-label">Usuários do sistema</label>
              <select
                multiple
                className="input"
                value={extraUserIds.map(String)}
                onChange={(e) => setExtraUserIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
                style={{ height: 90 }}
              >
                {userOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} — {u.email}
                  </option>
                ))}
              </select>

              <label className="form-label">E-mails avulsos</label>
              <textarea
                className="input"
                placeholder="Separe por vírgula ou uma linha por e-mail"
                value={extraEmailsText}
                onChange={(e) => setExtraEmailsText(e.target.value)}
                style={{ height: 60 }}
              />
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        <button onClick={copyText} className="btn btn-secondary">
          {copied ? "Copiado!" : "Copiar Texto"}
        </button>
        {canEdit && (
          <>
            <button onClick={handleDownloadPdf} disabled={downloadingPdf} className="btn btn-secondary">
              {downloadingPdf ? "Gerando..." : "Baixar PDF"}
            </button>
            <button onClick={handleSendEmail} disabled={sendingEmail} className="btn btn-primary">
              {sendingEmail ? "Enviando..." : "Enviar por E-mail"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
