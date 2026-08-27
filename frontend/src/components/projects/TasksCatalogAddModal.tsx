import { useEffect, useMemo, useState } from "react";
import { projectsApi, registryApi } from "../../api/resources";
import type { Project, ProjectTask, RackPosition, TaskFull } from "../../api/types";
import Modal from "../ui/Modal";

export default function TasksCatalogAddModal({
  project,
  existingTasks,
  rackPositions,
  onClose,
  onSaved,
}: {
  project: Project;
  existingTasks: ProjectTask[];
  rackPositions: RackPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalogTasks, setCatalogTasks] = useState<TaskFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTasks, setSelectedTasks] = useState<number[]>([]);
  const [selectedRackPositions, setSelectedRackPositions] = useState<number[]>(() => rackPositions.map((rp) => rp.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const usesRackPositions = project.has_rack_positions && rackPositions.length > 0;

  useEffect(() => {
    registryApi.tasks
      .list({ page_size: "500", is_active: "true" } as never)
      .then((r) => setCatalogTasks(r.results))
      .finally(() => setLoading(false));
  }, []);

  const availableTasks = useMemo(() => {
    // Tarefas avulsas (sem Tarefa de catálogo) não entram nessa checagem de
    // "catálogo já usado" — só existe uma pra tarefas vinculadas ao catálogo.
    const catalogLinked = existingTasks.filter((t): t is ProjectTask & { task: number } => t.task !== null);
    if (usesRackPositions) {
      // Com Rack Position, uma Tarefa do catálogo só fica indisponível
      // quando JÁ cobre todos os Rack Positions do projeto — senão ainda
      // falta cobrir algum, então continua selecionável (o backend cria só
      // as instâncias que faltam e ignora as que já existem).
      const coveredByTask = new Map<number, Set<number>>();
      catalogLinked.forEach((t) => {
        const set = coveredByTask.get(t.task) ?? new Set<number>();
        t.rack_positions.forEach((rpId) => set.add(rpId));
        coveredByTask.set(t.task, set);
      });
      return catalogTasks.filter((t) => (coveredByTask.get(t.id)?.size ?? 0) < rackPositions.length);
    }
    const alreadyUsed = new Set(catalogLinked.map((t) => t.task));
    return catalogTasks.filter((t) => !alreadyUsed.has(t.id));
  }, [catalogTasks, existingTasks, usesRackPositions, rackPositions]);

  function toggleTask(id: number) {
    setSelectedTasks((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  function toggleRackPosition(id: number) {
    setSelectedRackPositions((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));
  }

  async function handleSave() {
    if (!selectedTasks.length) return;
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, {
        action: "add",
        add_task_ids: selectedTasks,
        rack_position_ids: usesRackPositions ? selectedRackPositions : undefined,
      });
      alert(`${result.created} Tarefa(s) adicionada(s) ao Projeto.`);
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível adicionar as tarefas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar Tarefas do Catálogo" onClose={onClose} width={560}>
      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          {usesRackPositions && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
              Cada tarefa selecionada é criada uma vez para cada Rack Position marcado abaixo (que ainda não a tem).
            </p>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <div style={{ flex: 2, minWidth: 220 }}>
              <span className="field-label">Tarefas do Catálogo</span>
              <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                {availableTasks.map((task) => (
                  <label
                    key={task.id}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13.5, borderBottom: "1px solid var(--border)" }}
                  >
                    <input type="checkbox" checked={selectedTasks.includes(task.id)} onChange={() => toggleTask(task.id)} />
                    {task.name}
                  </label>
                ))}
                {availableTasks.length === 0 && (
                  <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
                    Todas as tarefas do catálogo já foram adicionadas a este projeto.
                  </div>
                )}
              </div>
            </div>
            {usesRackPositions && (
              <div style={{ flex: 1, minWidth: 160 }}>
                <span className="field-label">Rack Positions</span>
                <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6 }}>
                  {rackPositions.map((rp) => (
                    <label
                      key={rp.id}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", fontSize: 13.5, borderBottom: "1px solid var(--border)" }}
                    >
                      <input type="checkbox" checked={selectedRackPositions.includes(rp.id)} onChange={() => toggleRackPosition(rp.id)} />
                      {rp.position}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            <button className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving || !selectedTasks.length || (usesRackPositions && !selectedRackPositions.length)}
            >
              {saving ? "Adicionando..." : `Adicionar (${selectedTasks.length})`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
