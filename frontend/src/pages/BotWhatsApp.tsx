import { useEffect, useMemo, useState } from "react";
import { botMessagesApi } from "../api/resources";
import type { BotMessageTemplate } from "../api/types";
import Icon from "../components/ui/Icon";

const LABELS: Record<BotMessageTemplate["message_type"], { title: string; subtitle: string; icon: string }> = {
  daily_tasks: { title: "Tarefas do dia", subtitle: "Resumo gerencial das 10h", icon: "checklist" },
  project_updates: { title: "Atualização de projetos", subtitle: "Mensagem das 17h por projeto", icon: "description" },
  daily_project_report: { title: "Relatório diário de projeto", subtitle: "Mensagem das 15h por projeto", icon: "summarize" },
  operations_print: { title: "Print da operação", subtitle: "Legenda da imagem operacional", icon: "photo_camera" },
};

export default function BotWhatsApp() {
  const [templates, setTemplates] = useState<BotMessageTemplate[]>([]);
  const [selectedType, setSelectedType] = useState<BotMessageTemplate["message_type"]>("daily_tasks");
  const [draft, setDraft] = useState<BotMessageTemplate | null>(null);
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setLoading(true);
    botMessagesApi
      .list()
      .then((data) => {
        setTemplates(data);
        setDraft(data.find((t) => t.message_type === selectedType) || data[0] || null);
      })
      .catch(() => setError("Não foi possível carregar as configurações do bot."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const current = templates.find((t) => t.message_type === selectedType);
    if (current) setDraft({ ...current, enabled_fields: { ...current.enabled_fields } });
  }, [selectedType, templates]);

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      botMessagesApi.preview(draft).then((data) => setPreview(data.preview)).catch(() => setPreview(""));
    }, 200);
    return () => clearTimeout(timer);
  }, [draft]);

  const activeMeta = draft ? LABELS[draft.message_type] : null;
  const enabledCount = useMemo(
    () => draft?.field_definitions.filter((f) => draft.enabled_fields[f.key]).length || 0,
    [draft]
  );

  function updateDraft(patch: Partial<BotMessageTemplate>) {
    setSaved(false);
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function toggleField(key: string) {
    if (!draft) return;
    updateDraft({ enabled_fields: { ...draft.enabled_fields, [key]: !draft.enabled_fields[key] } });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError("");
    try {
      const updated = await botMessagesApi.update(draft);
      setTemplates((prev) => prev.map((t) => (t.message_type === updated.message_type ? updated : t)));
      setDraft(updated);
      setSaved(true);
    } catch {
      setError("Não foi possível salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  return (
    <div>
      <div className="section-header-row" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "var(--text)" }}>Bot WhatsApp</h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)", fontSize: 13 }}>
            Configure visualmente quais informações pré-codadas entram nas mensagens automáticas.
          </p>
        </div>
        <button className="btn btn-primary" onClick={save} disabled={saving || !draft}>
          <Icon name="save" style={{ fontSize: 17 }} />
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
      {saved && <p style={{ color: "var(--green)", fontSize: 13 }}>Configuração salva.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 380px", gap: 16, alignItems: "start" }}>
        <div className="card" style={{ padding: 10 }}>
          {templates.map((template) => {
            const meta = LABELS[template.message_type];
            const active = template.message_type === selectedType;
            return (
              <button
                key={template.message_type}
                type="button"
                onClick={() => setSelectedType(template.message_type)}
                style={{
                  width: "100%",
                  border: active ? "1px solid var(--orange)" : "1px solid transparent",
                  background: active ? "rgba(255, 111, 32, 0.08)" : "transparent",
                  borderRadius: 8,
                  padding: 12,
                  display: "flex",
                  gap: 10,
                  textAlign: "left",
                  cursor: "pointer",
                  color: "var(--text)",
                }}
              >
                <Icon name={meta.icon} style={{ fontSize: 20, color: active ? "var(--orange)" : "var(--text-muted)" }} />
                <span>
                  <b style={{ display: "block", fontSize: 13 }}>{meta.title}</b>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{meta.subtitle}</span>
                </span>
              </button>
            );
          })}
        </div>

        {draft && activeMeta && (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 18 }}>{activeMeta.title}</h2>
                <p style={{ margin: "3px 0 0", color: "var(--text-muted)", fontSize: 12 }}>
                  {enabledCount} campo(s) selecionado(s)
                </p>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-muted)" }}>
                <input type="checkbox" checked={draft.is_active} onChange={(e) => updateDraft({ is_active: e.target.checked })} />
                Ativo
              </label>
            </div>

            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Título</label>
            <input className="input" value={draft.title} onChange={(e) => updateDraft({ title: e.target.value })} style={{ width: "100%", margin: "6px 0 12px" }} />

            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Texto inicial</label>
            <textarea className="input" value={draft.intro_text} onChange={(e) => updateDraft({ intro_text: e.target.value })} style={{ width: "100%", minHeight: 72, margin: "6px 0 12px" }} />

            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)", marginBottom: 8 }}>Informações da mensagem</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }}>
              {draft.field_definitions.map((field) => (
                <label key={field.key} style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "9px 10px", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                  <input type="checkbox" checked={!!draft.enabled_fields[field.key]} onChange={() => toggleField(field.key)} />
                  {field.label}
                </label>
              ))}
            </div>

            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Texto final</label>
            <textarea className="input" value={draft.footer_text} onChange={(e) => updateDraft({ footer_text: e.target.value })} style={{ width: "100%", minHeight: 72, marginTop: 6 }} />
          </div>
        )}

        <div className="card" style={{ padding: 18, position: "sticky", top: 88 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <Icon name="chat" style={{ fontSize: 18, color: "var(--green)" }} />
            <b>Prévia WhatsApp</b>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", background: "var(--bg-soft)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, minHeight: 360, fontFamily: "inherit", fontSize: 13, lineHeight: 1.45, color: "var(--text)" }}>
            {preview || "Selecione os campos para gerar uma prévia."}
          </pre>
        </div>
      </div>
    </div>
  );
}
