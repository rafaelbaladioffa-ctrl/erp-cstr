import { useEffect, useState } from "react";
import { myTasksApi } from "../api/resources";
import type { ProjectTask } from "../api/types";
import { useAuth } from "../context/AuthContext";
import PageHeader from "../components/ui/PageHeader";
import { PERMS, hasPerm } from "../utils/permissions";

const STATUS_LABELS: Record<string, string> = {
  not_started: "Não Iniciada",
  in_progress: "Em Andamento",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
};

type TabKey = "pending" | "in_progress" | "completed";

const TABS: { key: TabKey; label: string }[] = [
  { key: "pending", label: "Tarefas Pendentes" },
  { key: "in_progress", label: "Tarefas em Andamento" },
  { key: "completed", label: "Tarefas Finalizadas" },
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
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function MyTasks() {
  const { user } = useAuth();
  const canEdit = hasPerm(user, PERMS.changeMyTasks);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("pending");

  useEffect(() => {
    myTasksApi
      .list()
      .then((data) => setTasks(data.results))
      .finally(() => setLoading(false));
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
    save(t.id, { status: "completed", actual_end: t.actual_end || nowISO() });
  }

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;

  if (!user?.has_collaborator_profile) {
    return (
      <div>
        <PageHeader eyebrow="Área Técnica" title="Minhas Tarefas" />
        <div className="empty-state">
          Seu usuário ainda não está vinculado a um Colaborador. Peça para o administrador vincular seu
          usuário no cadastro de Colaboradores.
        </div>
      </div>
    );
  }

  const visibleTasks = tasks.filter((t) => tabOf(t.status) === activeTab);

  return (
    <div>
      <PageHeader eyebrow="Área Técnica" title="Minhas Tarefas" subtitle="Acompanhe e atualize o andamento das suas atividades." />

      <div className="tabs">
        {TABS.map((tab) => {
          const count = tasks.filter((t) => tabOf(t.status) === tab.key).length;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`tab-btn${activeTab === tab.key ? " active" : ""}`}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visibleTasks.map((t) => (
          <div key={t.id} className="card" style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <strong style={{ color: "var(--text)" }}>{t.task_name}</strong>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {t.project_name} {t.project_code ? `(${t.project_code})` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {savingId === t.id && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Salvando...</span>}
                <span className="badge" style={{ background: "var(--blue-soft)", color: "var(--blue)" }}>
                  {STATUS_LABELS[t.status] || t.status_display}
                </span>
              </div>
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                {(t.status === "not_started" || t.status === "paused") && (
                  <button onClick={() => startTask(t)} disabled={savingId === t.id} className="btn" style={{ background: "var(--blue)", color: "#fff" }}>
                    Iniciar Tarefa
                  </button>
                )}
                {t.status === "in_progress" && (
                  <>
                    <button onClick={() => pauseTask(t)} disabled={savingId === t.id} className="btn" style={{ background: "var(--amber)", color: "#fff" }}>
                      Pausar Tarefa
                    </button>
                    <button onClick={() => completeTask(t)} disabled={savingId === t.id} className="btn" style={{ background: "var(--green)", color: "#fff" }}>
                      Concluir Tarefa
                    </button>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <div className="field-label" style={{ marginBottom: 4 }}>Início Real</div>
                <div className="input" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>{formatDateTime(t.actual_start)}</div>
              </div>
              <div>
                <div className="field-label" style={{ marginBottom: 4 }}>Término Real</div>
                <div className="input" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>{formatDateTime(t.actual_end)}</div>
              </div>
              <div>
                <div className="field-label" style={{ marginBottom: 4 }}>Horas Realizadas</div>
                <div className="input" style={{ background: "var(--bg)", color: "var(--text-muted)" }}>{t.actual_hours ? `${t.actual_hours}h` : "—"}</div>
              </div>
            </div>

            <label className="form-label">Observações</label>
            <textarea
              disabled={!canEdit}
              className="input"
              defaultValue={t.notes}
              onBlur={(e) => save(t.id, { notes: e.target.value })}
              style={{ height: 60 }}
            />
          </div>
        ))}
        {visibleTasks.length === 0 && <div className="empty-state">Nenhuma tarefa nesta aba.</div>}
      </div>
    </div>
  );
}
