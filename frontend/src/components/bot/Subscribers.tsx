import { useEffect, useState } from "react";
import { botSubscribersApi } from "../../api/resources";
import type { BotGroup, BotSubscriber } from "../../api/types";
import Icon from "../ui/Icon";

const LABEL = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" } as const;

const FLAGS: { key: keyof BotSubscriber; label: string }[] = [
  { key: "receives_daily_project_report", label: "Relatório diário de projeto" },
  { key: "receives_daily_tasks", label: "Tarefas do dia" },
  { key: "receives_project_updates", label: "Atualização de projetos" },
  { key: "receives_operations_print", label: "Print da operação" },
];

function emptySubscriber(): BotSubscriber {
  return {
    name: "",
    phone: "",
    group_jid: "",
    is_active: true,
    receives_daily_tasks: true,
    receives_project_updates: true,
    receives_operations_print: true,
    receives_daily_project_report: true,
  };
}

function SubscriberCard({
  initial,
  groups,
  onSaved,
  onDeleted,
}: {
  initial: BotSubscriber;
  groups: BotGroup[];
  onSaved: (s: BotSubscriber) => void;
  onDeleted: (id?: number) => void;
}) {
  const [sub, setSub] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const isGroup = !!sub.group_jid;

  function patch(change: Partial<BotSubscriber>) {
    setFeedback(null);
    setSub((prev) => ({ ...prev, ...change }));
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = sub.id ? await botSubscribersApi.update(sub.id, sub) : await botSubscribersApi.create(sub);
      setSub(saved);
      onSaved(saved);
      setFeedback({ kind: "ok", text: "Salvo." });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } }).response?.data;
      setFeedback({ kind: "error", text: data ? JSON.stringify(data) : "Não foi possível salvar." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!sub.id) return onDeleted(undefined);
    if (!window.confirm(`Excluir "${sub.name}"?`)) return;
    await botSubscribersApi.remove(sub.id);
    onDeleted(sub.id);
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 12, opacity: sub.is_active ? 1 : 0.75 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={LABEL}>Nome</div>
          <input className="input" value={sub.name} onChange={(e) => patch({ name: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
        </div>
        <div>
          <div style={LABEL}>Tipo de destino</div>
          <select className="input" value={isGroup ? "group" : "person"} onChange={(e) => patch(e.target.value === "group" ? { phone: "", group_jid: sub.group_jid || "@g.us" } : { group_jid: "" })} style={{ width: "100%", marginTop: 6 }}>
            <option value="person">Pessoa (telefone)</option>
            <option value="group">Grupo do WhatsApp</option>
          </select>
        </div>
        {isGroup ? (
          <div>
            <div style={LABEL}>Grupo</div>
            <select className="input" value={groups.some((g) => g.jid === sub.group_jid) ? sub.group_jid : ""} onChange={(e) => e.target.value && patch({ group_jid: e.target.value })} style={{ width: "100%", marginTop: 6 }}>
              <option value="">{groups.length ? "Escolher um grupo do bot…" : "Nenhum grupo carregado"}</option>
              {groups.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.nome}
                </option>
              ))}
            </select>
            <input className="input" value={sub.group_jid} onChange={(e) => patch({ group_jid: e.target.value })} placeholder="ou cole o ID (termina em @g.us)" style={{ width: "100%", marginTop: 6 }} />
          </div>
        ) : (
          <div>
            <div style={LABEL}>Telefone com DDD</div>
            <input className="input" value={sub.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="(11) 99999-9999" style={{ width: "100%", marginTop: 6 }} />
          </div>
        )}
      </div>

      <div style={{ ...LABEL, marginBottom: 6 }}>Recebe por padrão (quando a regra não escolhe destinatários)</div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 12 }}>
        {FLAGS.map((f) => (
          <label key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={!!sub[f.key]} onChange={(e) => patch({ [f.key]: e.target.checked } as Partial<BotSubscriber>)} />
            {f.label}
          </label>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !sub.name.trim()} type="button">
          <Icon name="save" style={{ fontSize: 17 }} />
          {saving ? "Salvando..." : "Salvar"}
        </button>
        <button className="btn" onClick={remove} type="button">
          <Icon name="delete" style={{ fontSize: 17 }} />
          Excluir
        </button>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", marginLeft: "auto" }}>
          <input type="checkbox" checked={sub.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
          Ativo
        </label>
        {feedback && <span style={{ fontSize: 13, color: feedback.kind === "ok" ? "var(--green)" : "var(--red)" }}>{feedback.text}</span>}
      </div>
    </div>
  );
}

export default function Subscribers() {
  const [subs, setSubs] = useState<BotSubscriber[] | null>(null);
  const [drafts, setDrafts] = useState<{ key: number }[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [groups, setGroups] = useState<BotGroup[]>([]);
  const [groupsError, setGroupsError] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    botSubscribersApi
      .list()
      .then(setSubs)
      .catch(() => setError("Não foi possível carregar os destinatários."));
    botSubscribersApi
      .groups()
      .then(setGroups)
      .catch((err) => setGroupsError(err?.response?.data?.detail || "Não foi possível listar os grupos do bot agora."));
  }, []);

  if (error) return <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>;
  if (!subs) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, maxWidth: 640 }}>
          <b style={{ color: "var(--text)" }}>Destinatários e grupos.</b> Pessoas ou grupos de WhatsApp que recebem os envios. Nas regras você pode escolher
          destinatários específicos; sem escolha, valem as caixas "recebe por padrão" de cada um.
          {groupsError && <span style={{ color: "var(--orange)" }}> {groupsError}</span>}
        </p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            setDrafts((prev) => [...prev, { key: nextKey }]);
            setNextKey((k) => k + 1);
          }}
        >
          <Icon name="add" style={{ fontSize: 17 }} />
          Novo destinatário
        </button>
      </div>

      {subs.map((s) => (
        <SubscriberCard key={s.id} initial={s} groups={groups} onSaved={(saved) => setSubs((prev) => (prev || []).map((x) => (x.id === saved.id ? saved : x)))} onDeleted={(id) => setSubs((prev) => (prev || []).filter((x) => x.id !== id))} />
      ))}
      {drafts.map(({ key }) => (
        <SubscriberCard
          key={`draft-${key}`}
          initial={emptySubscriber()}
          groups={groups}
          onSaved={(saved) => {
            setSubs((prev) => [...(prev || []), saved]);
            setDrafts((prev) => prev.filter((d) => d.key !== key));
          }}
          onDeleted={() => setDrafts((prev) => prev.filter((d) => d.key !== key))}
        />
      ))}
      {subs.length === 0 && drafts.length === 0 && <div className="empty-state">Nenhum destinatário cadastrado.</div>}
    </div>
  );
}
