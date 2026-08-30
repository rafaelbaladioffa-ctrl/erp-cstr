import { useState } from "react";
import type { ProjectItem, ProjectTask, WorkBlock } from "../../api/types";
import Icon from "../ui/Icon";
import StatusBadge from "../ui/StatusBadge";

export default function PlanningBlockSection({
  block,
  items,
  tasks,
  open,
  onToggle,
  taskCount,
  completedTaskCount,
  selectedTaskIds,
  onToggleTaskSelection,
  canChangeTask,
  onAddItem,
  onAddTask,
  onGenerateFromRule,
}: {
  block: WorkBlock | null;
  items: ProjectItem[];
  tasks: ProjectTask[];
  open: boolean;
  onToggle: () => void;
  taskCount: number;
  completedTaskCount: number;
  selectedTaskIds: number[];
  onToggleTaskSelection: (taskId: number) => void;
  canChangeTask: boolean;
  onAddItem: () => void;
  onAddTask: (item: ProjectItem) => void;
  onGenerateFromRule: (item: ProjectItem) => void;
}) {
  const [openItems, setOpenItems] = useState<Record<number, boolean>>({});
  const pct = taskCount > 0 ? Math.round((completedTaskCount / taskCount) * 100) : 0;

  return (
    <div className="ops-tech-card" style={{ marginBottom: 12 }}>
      <button type="button" className="ops-card-head ops-card-head-toggle" onClick={onToggle}>
        <div className="ops-card-title">{block ? block.name : "Sem Bloco"}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div className="ops-card-hint">
            {completedTaskCount}/{taskCount} tarefas concluídas — {pct}%
          </div>
          <div className="ops-progress-ring" style={{ ["--pct" as string]: pct, width: 30, height: 30 }}>
            <div className="ops-progress-ring-inner" style={{ width: 22, height: 22, fontSize: 8 }}>{pct}%</div>
          </div>
          <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
        </div>
      </button>

      {open && (
        <div style={{ padding: "10px 16px 14px" }}>
          {items.length === 0 && <div className="empty-state">Nenhum item cadastrado neste bloco.</div>}
          {items.map((item) => {
            const itemTasks = tasks.filter((t) => t.project_item === item.id);
            const itemOpen = openItems[item.id] ?? false;
            return (
              <div key={item.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", marginBottom: 8 }}>
                <button
                  type="button"
                  className="ops-card-head-toggle"
                  style={{ width: "100%", padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  onClick={() => setOpenItems((prev) => ({ ...prev, [item.id]: !itemOpen }))}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {item.internal_code || item.item_type_name}
                    {item.technology && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · {item.technology}</span>}
                    {item.length_meters && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · {item.length_meters}m</span>}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <StatusBadge status={item.status} label={item.status_display} />
                    <Icon name={itemOpen ? "expand_less" : "expand_more"} style={{ fontSize: 18, color: "var(--text-faint)" }} />
                  </span>
                </button>
                {itemOpen && (
                  <div style={{ padding: "0 12px 10px" }}>
                    {itemTasks.length === 0 && <div className="empty-state" style={{ padding: "6px 0" }}>Nenhuma tarefa cadastrada pra este item.</div>}
                    {itemTasks.map((task) => (
                      <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderTop: "1px dashed var(--border)" }}>
                        {canChangeTask && (
                          <input
                            type="checkbox"
                            checked={selectedTaskIds.includes(task.id)}
                            onChange={() => onToggleTaskSelection(task.id)}
                          />
                        )}
                        <span style={{ fontSize: 12, flex: 1 }}>{task.task_name}</span>
                        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
                          {task.quantity_completed ?? 0}/{task.quantity_planned ?? "—"} {task.unit}
                        </span>
                        <StatusBadge status={task.status} label={task.status_display} />
                      </div>
                    ))}
                    {canChangeTask && (
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => onAddTask(item)}>
                          <Icon name="add" style={{ fontSize: 13 }} />
                          Tarefa
                        </button>
                        {item.technology && (
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => onGenerateFromRule(item)} title="Gerar tarefas a partir da Regra de Geração cadastrada pra essa tecnologia">
                            <Icon name="auto_fix_high" style={{ fontSize: 13 }} />
                            Gerar pela Regra
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {canChangeTask && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onAddItem} style={{ marginTop: 4 }}>
              <Icon name="add" style={{ fontSize: 14 }} />
              Novo Item
            </button>
          )}
        </div>
      )}
    </div>
  );
}
