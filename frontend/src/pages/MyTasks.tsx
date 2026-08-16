import { useEffect, useState } from "react";
import { myTasksApi } from "../api/resources";
import type { ProjectTask } from "../api/types";
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

export default function MyTasks() {
  const { user } = useAuth();
  const canEdit = hasPerm(user, PERMS.changeMyTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    myTasksApi
      .list()
      .then((data) => {
        if (!cancelled) setTasks(data.results);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(id: number, patch: Partial<ProjectTask>) {
    setSavingId(id);
    try {
      const updated = await myTasksApi.update(id, patch);
      setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
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
    save(t.id, { status: "completed", actual_end: t.actual_end || nowISO() });
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

  const visibleTasks = tasks.filter((t) => tabOf(t.status) === activeTab);

  return (
    <div className="mt-screen">
      <div className="mt-title">Minhas Tarefas</div>

      <div className="mt-tabs">
        {TABS.map((tab) => {
          const count = tasks.filter((t) => tabOf(t.status) === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`mt-tab${activeTab === tab.key ? " active" : ""}`}
            >
              {tab.short}
              <span className="mt-tab-count">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-list">
        {visibleTasks.map((t) => {
          const expanded = expandedId === t.id;
          const saving = savingId === t.id;
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
                  <Icon name={expanded ? "expand_less" : "expand_more"} style={{ fontSize: 20 }} />
                </div>
              </button>

              {canEdit && (
                <div className="mt-actions">
                  {(t.status === "not_started" || t.status === "paused") && (
                    <button onClick={() => startTask(t)} disabled={saving} className="mt-btn mt-btn-start">
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
