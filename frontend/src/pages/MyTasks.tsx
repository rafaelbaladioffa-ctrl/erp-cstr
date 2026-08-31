import { useEffect, useState } from "react";
import { myTasksApi, presenceApi } from "../api/resources";
import type { ProjectTask, TechnicianPresence } from "../api/types";
import { useAuth } from "../context/AuthContext";
import Icon from "../components/ui/Icon";
import { PERMS, hasPerm } from "../utils/permissions";

const STATUS_LABELS: Record<string, string> = {
  not_started: "Não Iniciada",
  in_progress: "Em Andamento",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
};

const STATUS_TONE: Record<string, string> = {
  not_started: "var(--text-faint)",
  in_progress: "var(--blue)",
  paused: "var(--amber)",
  completed: "var(--green)",
  canceled: "var(--red)",
};

const PRESENCE_DOT_COLOR: Record<string, string> = {
  not_started: "var(--text-faint)",
  available: "var(--green)",
  in_progress: "var(--amber)",
  lunch: "var(--purple)",
  personal: "var(--blue)",
  site_blocked: "var(--red)",
  awaiting_release: "var(--orange)",
  off_duty: "var(--text-faint)",
};

const PRESENCE_STATUS_OPTIONS: { key: string; label: string }[] = [
  { key: "available", label: "Disponível" },
  { key: "lunch", label: "Horário de Almoço" },
  { key: "personal", label: "Particular" },
  { key: "site_blocked", label: "Sem Acesso ao Site" },
  { key: "awaiting_release", label: "Aguardando Liberações" },
  { key: "off_duty", label: "Fim de Expediente" },
];

const OUTCOME_OPTIONS: { key: string; label: string }[] = [
  { key: "completed", label: "Concluída" },
  { key: "partial", label: "Parcial" },
  { key: "blocked", label: "Bloqueada" },
];

type TabKey = "pending" | "in_progress" | "completed";

const TABS: { key: TabKey; label: string; short: string }[] = [
  { key: "pending", label: "Pendentes", short: "Pendentes" },
  { key: "in_progress", label: "Em Andamento", short: "Em curso" },
  { key: "completed", label: "Finalizadas", short: "Finalizadas" },
];

function tabOf(status: string): TabKey | null {
  if (status === "not_started") return "pending";
  if (status === "in_progress" || status === "paused") return "in_progress";
  if (status === "completed") return "completed";
  return null;
}

function nowISO() {
  return new Date().toISOString();
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export default function MyTasks() {
  const { user } = useAuth();
  const canEdit = hasPerm(user, PERMS.changeMyTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [presence, setPresence] = useState<TechnicianPresence | null>(null);
  const [outcomeByTask, setOutcomeByTask] = useState<Record<number, string>>({});
  const [quantityByTask, setQuantityByTask] = useState<Record<number, string>>({});

  function loadTasks() {
    return myTasksApi.list().then((data) => setTasks(data.results));
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadTasks(), presenceApi.me().then((data) => !cancelled && setPresence(data)).catch(() => {})]).finally(() => {
      if (!cancelled) setLoading(false);
    });
    const timer = setInterval(() => {
      if (!cancelled) loadTasks();
    }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setPresenceStatus(status: string) {
    const label = PRESENCE_STATUS_OPTIONS.find((opt) => opt.key === status)?.label || status;
    const question = status === "off_duty" ? "Encerrar seu expediente?" : `Alterar seu status para "${label}"?`;
    if (!confirm(question)) return;
    const updated = await presenceApi.setStatus(status);
    setPresence(updated);
  }

  async function save(id: number, patch: Partial<ProjectTask>) {
    setSavingId(id);
    try {
      const updated = await myTasksApi.update(id, patch);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      // Iniciar/pausar/concluir uma tarefa muda o status de presença
      // automaticamente no backend (ver MyTaskViewSet._sync_presence_with_task) —
      // recarrega pra refletir isso na UI sem esperar o próximo poll.
      if (patch.status) {
        presenceApi.me().then(setPresence).catch(() => {});
      }
    } finally {
      setSavingId(null);
    }
  }

  function startTask(t: ProjectTask) {
    save(t.id, { status: "in_progress", actual_start: t.actual_start || nowISO() });
  }

  function pauseTask(t: ProjectTask) {
    save(t.id, { status: "paused" });
  }

  function completeTask(t: ProjectTask) {
    if (!confirm(`Concluir "${t.task_name}"?`)) return;
    save(t.id, {
      status: "completed",
      actual_end: t.actual_end || nowISO(),
      completion_outcome: outcomeByTask[t.id] || "completed",
      quantity_done: quantityByTask[t.id] || "",
    });
  }

  if (loading) return <p style={{ color: "var(--text-muted)", padding: 20 }}>Carregando...</p>;

  if (!user?.has_collaborator_profile) {
    return (
      <div>
        <div className="mt-title">Minhas Tarefas</div>
        <div className="empty-state">
          Seu usuário ainda não está vinculado a um Técnico. Peça para o administrador vincular seu
          usuário no cadastro de Técnicos.
        </div>
      </div>
    );
  }

  const hasActiveTask = tasks.some((t) => t.status === "in_progress");
  const visibleTasks = tasks.filter((t) => tabOf(t.status) === activeTab);
  const isOffDuty = presence?.status === "off_duty";
  const isAutoInProgress = presence?.status === "in_progress";

  return (
    <div className="mt-screen">
      <div className="mt-title">Minhas Tarefas</div>

      {presence && (
        <div className="mt-presence-bar">
          <div className="mt-presence-left">
            <div className="mt-presence-dot" style={{ background: PRESENCE_DOT_COLOR[presence.status] }} />
            <div>
              <div className="mt-presence-label">{presence.status_display}</div>
              {presence.checked_in_at && !isOffDuty && (
                <div className="mt-presence-since">desde {formatTime(presence.checked_in_at)}</div>
              )}
              {isOffDuty && presence.checked_out_at && (
                <div className="mt-presence-since">às {formatTime(presence.checked_out_at)}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {presence && (
        <div className="mt-status-select-row">
          <label className="mt-status-select-label">Meu status</label>
          {isAutoInProgress ? (
            <div className="input" style={{ color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
              Em Execução — definido automaticamente enquanto uma tarefa está em andamento
            </div>
          ) : (
            <select
              className="select"
              value={presence.status === "not_started" ? "" : presence.status}
              onChange={(e) => setPresenceStatus(e.target.value)}
            >
              {presence.status === "not_started" && (
                <option value="" disabled>
                  Selecione seu status
                </option>
              )}
              {PRESENCE_STATUS_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          {isOffDuty && (
            <div className="mt-status-reopen-hint">
              Expediente encerrado — escolha "Disponível" acima pra reabrir, se precisar.
            </div>
          )}
        </div>
      )}

      <div className="mt-tabs">
        {TABS.map((tab) => {
          const count = tasks.filter((t) => tabOf(t.status) === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`mt-tab${activeTab === tab.key ? " active" : ""}`}
            >
              <span className="mt-tab-label">{tab.short}</span>
              <span className="mt-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-list">
        {visibleTasks.map((t) => {
          const expanded = expandedId === t.id;
          const saving = savingId === t.id;
          const blockedByAnother = t.status !== "in_progress" && hasActiveTask;
          return (
            <div key={t.id} className="mt-card" style={{ borderLeftColor: STATUS_TONE[t.status] || "var(--border)" }}>
              <button className="mt-card-header" onClick={() => setExpandedId(expanded ? null : t.id)}>
                <div className="mt-card-heading">
                  <div className="mt-task-name">{t.task_name}</div>
                  <div className="mt-project-name">
                    {t.project_name} {t.project_code ? `· ${t.project_code}` : ""}
                  </div>
                </div>
                <div className="mt-card-status" style={{ color: STATUS_TONE[t.status] || "var(--text-muted)" }}>
                  {STATUS_LABELS[t.status] || t.status_display}
                  {t.status === "not_started" && t.queue_order != null && (
                    <span className="mt-queue-badge">Fila #{t.queue_order}</span>
                  )}
                  <Icon name={expanded ? "expand_less" : "expand_more"} style={{ fontSize: 20 }} />
                </div>
              </button>

              {canEdit && t.status === "in_progress" && (
                <>
                  <div className="mt-outcome-row">
                    {OUTCOME_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        type="button"
                        className={`mt-outcome-pill${(outcomeByTask[t.id] || "completed") === opt.key ? " on" : ""}`}
                        onClick={() => setOutcomeByTask((prev) => ({ ...prev, [t.id]: opt.key }))}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <input
                    className="input mt-quantity-input"
                    style={{ width: "calc(100% - 32px)" }}
                    placeholder="Quantidade executada (opcional)"
                    value={quantityByTask[t.id] ?? ""}
                    onChange={(e) => setQuantityByTask((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  />
                </>
              )}

              {canEdit && (
                <div className="mt-actions">
                  {(t.status === "not_started" || t.status === "paused") && (
                    <button
                      onClick={() => startTask(t)}
                      disabled={saving || blockedByAnother}
                      className="mt-btn mt-btn-start"
                    >
                      <Icon name="play_arrow" style={{ fontSize: 20 }} />
                      {saving ? "Salvando..." : "Iniciar"}
                    </button>
                  )}
                  {t.status === "in_progress" && (
                    <>
                      <button onClick={() => pauseTask(t)} disabled={saving} className="mt-btn mt-btn-pause">
                        <Icon name="pause" style={{ fontSize: 20 }} />
                        Pausar
                      </button>
                      <button onClick={() => completeTask(t)} disabled={saving} className="mt-btn mt-btn-complete">
                        <Icon name="check" style={{ fontSize: 20 }} />
                        Concluir
                      </button>
                    </>
                  )}
                  {t.status === "completed" && (
                    <div className="mt-done-note">
                      <Icon name="task_alt" style={{ fontSize: 18 }} />
                      Concluída em {formatDateTime(t.actual_end)}
                    </div>
                  )}
                </div>
              )}
              {canEdit && blockedByAnother && (t.status === "not_started" || t.status === "paused") && (
                <div className="mt-start-disabled-note">Finalize ou pause a atividade atual para iniciar esta.</div>
              )}

              {expanded && (
                <div className="mt-details">
                  <div className="mt-meta-grid">
                    <div className="mt-meta">
                      <span className="mt-meta-label">Início real</span>
                      <span className="mt-meta-value">{formatDateTime(t.actual_start)}</span>
                    </div>
                    <div className="mt-meta">
                      <span className="mt-meta-label">Término real</span>
                      <span className="mt-meta-value">{formatDateTime(t.actual_end)}</span>
                    </div>
                    <div className="mt-meta">
                      <span className="mt-meta-label">Horas realizadas</span>
                      <span className="mt-meta-value">{t.actual_hours ? `${t.actual_hours}h` : "—"}</span>
                    </div>
                  </div>

                  {t.quantity_done && (
                    <div className="mt-meta" style={{ marginBottom: 12 }}>
                      <span className="mt-meta-label">Quantidade executada</span>
                      <span className="mt-meta-value">{t.quantity_done}</span>
                    </div>
                  )}

                  <label className="mt-notes-label">Observações</label>
                  <textarea
                    disabled={!canEdit}
                    className="input mt-notes"
                    defaultValue={t.notes}
                    onBlur={(e) => save(t.id, { notes: e.target.value })}
                    placeholder="Anote algo sobre esta tarefa..."
                  />
                </div>
              )}
            </div>
          );
        })}
        {visibleTasks.length === 0 && <div className="empty-state">Nenhuma tarefa nesta aba.</div>}
      </div>
    </div>
  );
}
