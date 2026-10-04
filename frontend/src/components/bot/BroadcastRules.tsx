import { useEffect, useState } from "react";
import { botRulesApi } from "../../api/resources";
import type { BotBroadcastRule, BotBroadcastRuleOptions } from "../../api/types";
import Icon from "../ui/Icon";

export type RuleType = BotBroadcastRule["message_type"];

interface RuleTypeMeta {
  label: string;
  hint: string;
  formats: BotBroadcastRule["content_type"][];
  defaultTime: string;
  defaultStatuses: string[];
  defaultOffset: number;
  projectFilters: boolean; // clientes, categorias, regionais, status
  siteFilter: boolean;
  recipients: boolean;
  dateOffset: boolean;
  captionField: boolean;
}

export const RULE_TYPE_META: Record<RuleType, RuleTypeMeta> = {
  daily_project_report: {
    label: "Relatório diário de projeto",
    hint: "Texto: uma mensagem por projeto. Imagem: um print com todos os projetos.",
    formats: ["text", "image"],
    defaultTime: "15:00",
    defaultStatuses: ["in_progress"],
    defaultOffset: 0,
    projectFilters: true,
    siteFilter: true,
    recipients: true,
    dateOffset: true,
    captionField: true,
  },
  daily_tasks: {
    label: "Tarefas do dia",
    hint: "Uma mensagem consolidada com os projetos alocados no dia, técnicos e tarefas pendentes.",
    formats: ["text"],
    defaultTime: "10:00",
    defaultStatuses: [],
    defaultOffset: 0,
    projectFilters: true,
    siteFilter: true,
    recipients: true,
    dateOffset: true,
    captionField: false,
  },
  project_updates: {
    label: "Atualização de projetos",
    hint: "Uma mensagem por projeto alocado no dia, igual à atualização diária enviada ao cliente.",
    formats: ["text"],
    defaultTime: "17:00",
    defaultStatuses: [],
    defaultOffset: 0,
    projectFilters: true,
    siteFilter: true,
    recipients: true,
    dateOffset: true,
    captionField: false,
  },
  allocation: {
    label: "Alocação diária aos técnicos",
    hint: "Cada técnico alocado recebe a própria mensagem, no telefone cadastrado dele (não usa a lista de destinatários).",
    formats: ["text"],
    defaultTime: "18:00",
    defaultStatuses: [],
    defaultOffset: 1,
    projectFilters: true,
    siteFilter: true,
    recipients: false,
    dateOffset: true,
    captionField: false,
  },
  operations_print: {
    label: "Print da operação",
    hint: "Imagem da Central de Operações. Com sites selecionados, envia um print por site; sem sites, um print geral.",
    formats: ["image"],
    defaultTime: "08:00",
    defaultStatuses: [],
    defaultOffset: 0,
    projectFilters: false,
    siteFilter: true,
    recipients: true,
    dateOffset: false,
    captionField: false,
  },
};

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const LABEL_STYLE = { fontSize: 12, fontWeight: 700, color: "var(--text-muted)" } as const;

function emptyRule(type: RuleType): BotBroadcastRule {
  const meta = RULE_TYPE_META[type];
  return {
    name: "Nova regra",
    is_active: true,
    message_type: type,
    date_offset_days: meta.defaultOffset,
    content_type: meta.formats[0],
    send_time: meta.defaultTime,
    weekdays: [],
    statuses: meta.defaultStatuses,
    client_ids: [],
    category_ids: [],
    include_no_category: false,
    region_ids: [],
    site_ids: [],
    recipient_ids: [],
    image_caption: "",
  };
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function CheckList<T extends number | string>({
  title,
  hint,
  allLabel,
  extra,
  items,
  selected,
  onChange,
}: {
  title: string;
  hint: string;
  allLabel: string;
  extra?: { label: string; checked: boolean; onChange: (checked: boolean) => void };
  items: { id: T; name: string; sub?: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}) {
  return (
    <div>
      <div style={LABEL_STYLE}>
        {title} <span style={{ fontWeight: 400 }}>— {selected.length ? `${selected.length} selecionado(s)` : hint}</span>
      </div>
      <div style={{ border: "1px solid var(--border)", borderRadius: 8, marginTop: 6, maxHeight: 140, overflowY: "auto", padding: 6 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 4px", fontWeight: 700 }}>
          <input type="checkbox" checked={selected.length === 0} onChange={() => selected.length > 0 && onChange([])} />
          {allLabel}
        </label>
        {extra && selected.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 4px", fontWeight: 700 }}>
            <input type="checkbox" checked={extra.checked} onChange={(e) => extra.onChange(e.target.checked)} />
            {extra.label}
          </label>
        )}
        {items.map((item) => (
          <label key={String(item.id)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 4px" }}>
            <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onChange(toggle(selected, item.id))} />
            <span>
              {item.name}
              {item.sub && <span style={{ color: "var(--text-muted)" }}> · {item.sub}</span>}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function RuleCard({
  initial,
  options,
  onSaved,
  onDeleted,
}: {
  initial: BotBroadcastRule;
  options: BotBroadcastRuleOptions;
  onSaved: (rule: BotBroadcastRule) => void;
  onDeleted: (id?: number) => void;
}) {
  const meta = RULE_TYPE_META[initial.message_type];
  const [rule, setRule] = useState<BotBroadcastRule>(initial);
  const [saving, setSaving] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function patch(change: Partial<BotBroadcastRule>) {
    setFeedback(null);
    setRule((prev) => ({ ...prev, ...change }));
  }

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const saved = rule.id ? await botRulesApi.update(rule.id, rule) : await botRulesApi.create(rule);
      setRule(saved);
      onSaved(saved);
      setFeedback({ kind: "ok", text: "Regra salva." });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: unknown } }).response?.data;
      setFeedback({ kind: "error", text: data ? JSON.stringify(data) : "Não foi possível salvar a regra." });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!rule.id) return onDeleted(undefined);
    if (!window.confirm(`Excluir a regra "${rule.name}"?`)) return;
    await botRulesApi.remove(rule.id);
    onDeleted(rule.id);
  }

  async function sendTest() {
    setTesting(true);
    setFeedback(null);
    try {
      // Envia na hora, com a regra exatamente como está na tela (salva ou não).
      const result = await botRulesApi.test(rule, testTo.trim());
      setFeedback({ kind: "ok", text: result.detail });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { detail?: string } } }).response?.data;
      setFeedback({ kind: "error", text: data?.detail || "Não foi possível enviar o teste." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16, opacity: rule.is_active ? 1 : 0.75 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 14 }}>
        <input className="input" value={rule.name} onChange={(e) => patch({ name: e.target.value })} style={{ flex: 1, fontWeight: 700 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)" }}>
          <input type="checkbox" checked={rule.is_active} onChange={(e) => patch({ is_active: e.target.checked })} />
          Ativa
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 14 }}>
        <div>
          <div style={LABEL_STYLE}>Horário (Brasília)</div>
          <input className="input" type="time" value={rule.send_time} onChange={(e) => patch({ send_time: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
        </div>
        {meta.formats.length > 1 && (
          <div>
            <div style={LABEL_STYLE}>Formato</div>
            <select className="input" value={rule.content_type} onChange={(e) => patch({ content_type: e.target.value as BotBroadcastRule["content_type"] })} style={{ width: "100%", marginTop: 6 }}>
              <option value="text">Texto (uma mensagem por projeto)</option>
              <option value="image">Imagem (print)</option>
            </select>
          </div>
        )}
        {meta.dateOffset && (
          <div>
            <div style={LABEL_STYLE}>Dados de</div>
            <select className="input" value={rule.date_offset_days} onChange={(e) => patch({ date_offset_days: Number(e.target.value) })} style={{ width: "100%", marginTop: 6 }}>
              <option value={0}>Hoje</option>
              <option value={1}>Amanhã</option>
            </select>
          </div>
        )}
        <div>
          <div style={LABEL_STYLE}>Dias da semana {rule.weekdays.length === 0 && <span style={{ fontWeight: 400 }}>— todos</span>}</div>
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {WEEKDAYS.map((label, index) => {
              const on = rule.weekdays.includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => patch({ weekdays: toggle(rule.weekdays, index).sort() })}
                  style={{
                    padding: "6px 9px",
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: "pointer",
                    border: on ? "1px solid var(--orange)" : "1px solid var(--border)",
                    background: on ? "rgba(255, 111, 32, 0.1)" : "transparent",
                    color: "var(--text)",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {meta.captionField && rule.content_type === "image" && (
        <div style={{ marginBottom: 14 }}>
          <div style={LABEL_STYLE}>Legenda da imagem</div>
          <input className="input" value={rule.image_caption} placeholder="Vazio = Status de Projetos AZ4 - data" onChange={(e) => patch({ image_caption: e.target.value })} style={{ width: "100%", marginTop: 6 }} />
        </div>
      )}

      <div style={{ ...LABEL_STYLE, marginBottom: 8, color: "var(--text)" }}>
        {meta.projectFilters ? "Quais projetos entram (nada selecionado = todos)" : "Quais sites entram (nada selecionado = todos)"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginBottom: 14 }}>
        {meta.projectFilters && (
          <>
            <CheckList title="Clientes" hint="todos" allLabel="Todos os clientes" items={options.clients} selected={rule.client_ids} onChange={(client_ids) => patch({ client_ids })} />
            <CheckList
              title="Categorias"
              hint="todas"
              allLabel="Todas (inclui projetos sem categoria)"
              extra={{ label: "Incluir projetos sem categoria", checked: rule.include_no_category, onChange: (include_no_category) => patch({ include_no_category }) }}
              items={options.categories}
              selected={rule.category_ids}
              onChange={(category_ids) => patch(category_ids.length ? { category_ids } : { category_ids, include_no_category: false })}
            />
            <CheckList title="Regionais" hint="todas" allLabel="Todas as regionais" items={options.regions} selected={rule.region_ids} onChange={(region_ids) => patch({ region_ids })} />
          </>
        )}
        {meta.siteFilter && <CheckList title="Sites" hint="todos" allLabel="Todos os sites" items={options.sites} selected={rule.site_ids} onChange={(site_ids) => patch({ site_ids })} />}
        {meta.projectFilters && <CheckList title="Status do projeto" hint="qualquer" allLabel="Qualquer status" items={options.statuses} selected={rule.statuses} onChange={(statuses) => patch({ statuses })} />}
      </div>

      {meta.recipients && (
        <div style={{ marginBottom: 14 }}>
          <CheckList
            title="Destinatários"
            hint="todos os destinatários padrão deste tipo de mensagem"
            allLabel="Destinatários padrão (aba Destinatários e grupos)"
            items={options.subscribers.map((s) => ({ id: s.id, name: s.name, sub: s.target }))}
            selected={rule.recipient_ids}
            onChange={(recipient_ids) => patch({ recipient_ids })}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", borderTop: "1px solid var(--border)", paddingTop: 14 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving || !rule.name.trim() || !rule.send_time}>
          <Icon name="save" style={{ fontSize: 17 }} />
          {saving ? "Salvando..." : "Salvar regra"}
        </button>
        <button className="btn" onClick={remove} type="button">
          <Icon name="delete" style={{ fontSize: 17 }} />
          Excluir
        </button>
        <span style={{ flex: 1 }} />
        <input className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Telefone com DDD ou ID do grupo (@g.us)" style={{ width: 300 }} />
        <button className="btn" onClick={sendTest} disabled={!testTo.trim() || testing} type="button" title="Envia agora, só para o destino ao lado, com a regra como está na tela">
          <Icon name="send" style={{ fontSize: 17 }} />
          {testing ? "Enviando..." : "Enviar teste"}
        </button>
      </div>
      {feedback && <p style={{ margin: "10px 0 0", fontSize: 13, color: feedback.kind === "ok" ? "var(--green)" : "var(--red)" }}>{feedback.text}</p>}
    </div>
  );
}

export default function BroadcastRules({ messageType }: { messageType: RuleType }) {
  const meta = RULE_TYPE_META[messageType];
  const [rules, setRules] = useState<BotBroadcastRule[]>([]);
  const [drafts, setDrafts] = useState<{ key: number; rule: BotBroadcastRule }[]>([]);
  const [options, setOptions] = useState<BotBroadcastRuleOptions | null>(null);
  const [error, setError] = useState("");
  const [nextKey, setNextKey] = useState(1);

  useEffect(() => {
    Promise.all([botRulesApi.list(), botRulesApi.options()])
      .then(([list, opts]) => {
        setRules(list);
        setOptions(opts);
      })
      .catch(() => setError("Não foi possível carregar as regras de envio."));
  }, []);

  if (error) return <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>;
  if (!options) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  const typeRules = rules.filter((r) => r.message_type === messageType);

  function addDraft() {
    setDrafts((prev) => [...prev, { key: nextKey, rule: emptyRule(messageType) }]);
    setNextKey((k) => k + 1);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12.5, maxWidth: 640 }}>
          <b style={{ color: "var(--text)" }}>{meta.label}.</b> {meta.hint} Cada regra define horário, dias, quais dados entram e quem recebe.
          Sem nenhuma regra ativa, este envio não acontece.
        </p>
        <button className="btn btn-primary" onClick={addDraft} type="button">
          <Icon name="add" style={{ fontSize: 17 }} />
          Nova regra
        </button>
      </div>

      {typeRules.map((rule) => (
        <RuleCard
          key={rule.id}
          initial={rule}
          options={options}
          onSaved={(saved) => setRules((prev) => prev.map((r) => (r.id === saved.id ? saved : r)))}
          onDeleted={(id) => setRules((prev) => prev.filter((r) => r.id !== id))}
        />
      ))}
      {drafts.map(({ key, rule }) => (
        <RuleCard
          key={`draft-${key}`}
          initial={rule}
          options={options}
          onSaved={(saved) => {
            setRules((prev) => [...prev, saved]);
            setDrafts((prev) => prev.filter((d) => d.key !== key));
          }}
          onDeleted={() => setDrafts((prev) => prev.filter((d) => d.key !== key))}
        />
      ))}
      {typeRules.length === 0 && drafts.length === 0 && (
        <div className="empty-state">Nenhuma regra para este envio. Clique em "Nova regra" para agendar.</div>
      )}
    </div>
  );
}
