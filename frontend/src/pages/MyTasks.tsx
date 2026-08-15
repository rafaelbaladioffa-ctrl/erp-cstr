import { useEffect, useState } from "react";
import { myTasksApi } from "../api/resources";
import type { ProjectTask } from "../api/types";
import { useAuth } from "../context/AuthContext";
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

  if (loading) return <p>Carregando...</p>;

  if (!user?.has_collaborator_profile) {
    return (
      <div>
        <h1 style={{ fontSize: 22, color: "#172033", marginBottom: 8 }}>Minhas Tarefas</h1>
        <p style={{ color: "#526174" }}>
          Seu usuário ainda não está vinculado a um Colaborador. Peça para o administrador vincular seu
          usuário no cadastro de Colaboradores.
        </p>
      </div>
    );
  }

  const visibleTasks = tasks.filter((t) => tabOf(t.status) === activeTab);

  return (
    <div>
      <h1 style={{ fontSize: 22, color: "#172033", marginBottom: 4 }}>Minhas Tarefas</h1>
      <p style={{ color: "#526174", marginBottom: 20 }}>Técnico</p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid #DDE3EA" }}>
        {TABS.map((tab) => {
          const count = tasks.filter((t) => tabOf(t.status) === tab.key).length;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              style={{
                padding: "10px 16px",
                border: "none",
                borderBottom: isActive ? "2px solid #2563EB" : "2px solid transparent",
                background: "transparent",
                color: isActive ? "#2563EB" : "#526174",
                fontWeight: isActive ? 700 : 500,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              {tab.label} ({count})
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {visibleTasks.map((t) => (
          <div key={t.id} style={{ background: "#fff", border: "1px solid #DDE3EA", borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <strong style={{ color: "#172033" }}>{t.task_name}</strong>
                <div style={{ fontSize: 13, color: "#526174" }}>
                  {t.project_name} {t.project_code ? `(${t.project_code})` : ""}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {savingId === t.id && <span style={{ fontSize: 12, color: "#526174" }}>Salvando...</span>}
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#2563EB",
                    background: "#EFF4FF",
                    padding: "4px 10px",
                    borderRadius: 999,
                  }}
                >
                  {STATUS_LABELS[t.status] || t.status_display}
                </span>
              </div>
            </div>

            {canEdit && (
              <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
                {(t.status === "not_started" || t.status === "paused") && (
                  <button onClick={() => startTask(t)} disabled={savingId === t.id} style={btnPrimary}>
                    Iniciar Tarefa
                  </button>
                )}
                {t.status === "in_progress" && (
                  <>
                    <button onClick={() => pauseTask(t)} disabled={savingId === t.id} style={btnSecondary}>
                      Pausar Tarefa
                    </button>
                    <button onClick={() => completeTask(t)} disabled={savingId === t.id} style={btnSuccess}>
                      Concluir Tarefa
                    </button>
                  </>
                )}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
              <div>
                <label style={label}>Início Real</label>
                <div style={readOnly}>{formatDateTime(t.actual_start)}</div>
              </div>
              <div>
                <label style={label}>Término Real</label>
                <div style={readOnly}>{formatDateTime(t.actual_end)}</div>
              </div>
              <div>
                <label style={label}>Horas Realizadas</label>
                <div style={readOnly}>{t.actual_hours ? `${t.actual_hours}h` : "—"}</div>
              </div>
            </div>

            <label style={{ ...label, marginTop: 10 }}>Observações</label>
            <textarea
              disabled={!canEdit}
              defaultValue={t.notes}
              onBlur={(e) => save(t.id, { notes: e.target.value })}
              style={{ ...input, height: 60 }}
            />
          </div>
        ))}
        {visibleTasks.length === 0 && <p>Nenhuma tarefa nesta aba.</p>}
      </div>
    </div>
  );
}

const label = { display: "block", fontSize: 11, fontWeight: 700, color: "#526174", margin: "0 0 4px" };
const input = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid #DDE3EA",
  fontSize: 13,
  boxSizing: "border-box" as const,
};
const readOnly = {
  ...input,
  background: "#F5F7FA",
  color: "#526174",
};
const btnBase = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "none",
  fontSize: 13,
  fontWeight: 700,
  cursor: "pointer",
};
const btnPrimary = { ...btnBase, background: "#2563EB", color: "#fff" };
const btnSecondary = { ...btnBase, background: "#F59E0B", color: "#fff" };
const btnSuccess = { ...btnBase, background: "#16A34A", color: "#fff" };
