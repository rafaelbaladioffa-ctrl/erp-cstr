import { useEffect, useState } from "react";
import { registryApi } from "../../api/resources";
import type {
  ActivityType,
  ProjectItemType,
  ScopeImportBlockDraft,
  ScopeImportItemDraft,
  ScopeImportPayload,
  ScopeImportTaskDraft,
} from "../../api/types";
import Icon from "../ui/Icon";

const PRIORITY_OPTIONS = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" },
];

const COMPLEXITY_OPTIONS = [
  { value: "simple", label: "Simples" },
  { value: "medium", label: "Média" },
  { value: "complex", label: "Complexa" },
];

const emptyTask = (): ScopeImportTaskDraft => ({
  activity_type_id: null,
  activity_type_name: "",
  activity_type_unmatched: true,
  quantity_planned: null,
  unit: "",
});

const emptyItem = (): ScopeImportItemDraft => ({
  internal_code: "",
  item_type_id: null,
  item_type_name: "",
  item_type_unmatched: true,
  technology: "",
  fiber_count: null,
  length_meters: null,
  origin: "",
  destination: "",
  route: "",
  priority: "medium",
  complexity: "medium",
  tasks: [emptyTask()],
});

const emptyBlock = (): ScopeImportBlockDraft => ({ name: "Novo Bloco", items: [emptyItem()] });

/** Uma proposta só pode ser confirmada quando todo item/tarefa tem um tipo
 * real do catálogo resolvido (nunca fica "unmatched" pendente) e cada bloco/
 * item/tarefa tem o mínimo de dado preenchido. */
export function scopeImportPayloadIsValid(payload: ScopeImportPayload): boolean {
  if (payload.work_blocks.length === 0) return false;
  return payload.work_blocks.every((block) => {
    if (!block.name.trim() || block.items.length === 0) return false;
    return block.items.every((item) => {
      if (!item.item_type_id || item.tasks.length === 0) return false;
      return item.tasks.every((task) => Boolean(task.activity_type_id));
    });
  });
}

export default function ScopeImportReviewTree({
  payload,
  onChange,
}: {
  payload: ScopeImportPayload;
  onChange: (payload: ScopeImportPayload) => void;
}) {
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [itemTypes, setItemTypes] = useState<ProjectItemType[]>([]);

  useEffect(() => {
    Promise.allSettled([
      registryApi.activityTypes.list({ page_size: "500", is_active: "true" } as never),
      registryApi.projectItemTypes.list({ page_size: "500", is_active: "true" } as never),
    ]).then(([a, i]) => {
      if (a.status === "fulfilled") setActivityTypes(a.value.results);
      if (i.status === "fulfilled") setItemTypes(i.value.results);
    });
  }, []);

  function updateBlocks(updater: (blocks: ScopeImportBlockDraft[]) => ScopeImportBlockDraft[]) {
    onChange({ ...payload, work_blocks: updater(payload.work_blocks) });
  }

  function updateBlock(bi: number, patch: Partial<ScopeImportBlockDraft>) {
    updateBlocks((blocks) => blocks.map((b, i) => (i === bi ? { ...b, ...patch } : b)));
  }

  function removeBlock(bi: number) {
    updateBlocks((blocks) => blocks.filter((_, i) => i !== bi));
  }

  function addBlock() {
    updateBlocks((blocks) => [...blocks, emptyBlock()]);
  }

  function updateItem(bi: number, ii: number, patch: Partial<ScopeImportItemDraft>) {
    updateBlock(bi, {
      items: payload.work_blocks[bi].items.map((item, i) => (i === ii ? { ...item, ...patch } : item)),
    });
  }

  function removeItem(bi: number, ii: number) {
    updateBlock(bi, { items: payload.work_blocks[bi].items.filter((_, i) => i !== ii) });
  }

  function addItem(bi: number) {
    updateBlock(bi, { items: [...payload.work_blocks[bi].items, emptyItem()] });
  }

  function updateTask(bi: number, ii: number, ti: number, patch: Partial<ScopeImportTaskDraft>) {
    const item = payload.work_blocks[bi].items[ii];
    updateItem(bi, ii, { tasks: item.tasks.map((task, i) => (i === ti ? { ...task, ...patch } : task)) });
  }

  function removeTask(bi: number, ii: number, ti: number) {
    const item = payload.work_blocks[bi].items[ii];
    updateItem(bi, ii, { tasks: item.tasks.filter((_, i) => i !== ti) });
  }

  function addTask(bi: number, ii: number) {
    const item = payload.work_blocks[bi].items[ii];
    updateItem(bi, ii, { tasks: [...item.tasks, emptyTask()] });
  }

  return (
    <div>
      {payload.work_blocks.map((block, bi) => (
        <div key={bi} className="ops-tech-card" style={{ marginBottom: 14, padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <input
              className="input"
              style={{ fontWeight: 700, flex: 1 }}
              value={block.name}
              onChange={(e) => updateBlock(bi, { name: e.target.value })}
              placeholder="Nome do bloco"
            />
            <button className="btn btn-outline btn-sm" onClick={() => removeBlock(bi)}>
              <Icon name="delete" style={{ fontSize: 14 }} />
              Remover Bloco
            </button>
          </div>

          {block.items.map((item, ii) => (
            <div key={ii} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 12, marginBottom: 10 }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Código Interno
                  <input
                    className="input"
                    value={item.internal_code}
                    onChange={(e) => updateItem(bi, ii, { internal_code: e.target.value })}
                  />
                </label>
                <label style={{ fontSize: 11.5, color: item.item_type_unmatched ? "var(--red)" : "var(--text-faint)" }}>
                  Tipo {item.item_type_unmatched && "(selecione)"}
                  <select
                    className="select"
                    style={item.item_type_unmatched ? { borderColor: "var(--red)" } : undefined}
                    value={item.item_type_id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value ? Number(e.target.value) : null;
                      const matched = itemTypes.find((t) => t.id === id);
                      updateItem(bi, ii, { item_type_id: id, item_type_name: matched?.name ?? "", item_type_unmatched: !id });
                    }}
                  >
                    <option value="">Selecione...</option>
                    {itemTypes.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Tecnologia
                  <input className="input" value={item.technology} onChange={(e) => updateItem(bi, ii, { technology: e.target.value })} />
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Metragem
                  <input
                    type="number"
                    className="input"
                    value={item.length_meters ?? ""}
                    onChange={(e) => updateItem(bi, ii, { length_meters: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Origem
                  <input className="input" value={item.origin} onChange={(e) => updateItem(bi, ii, { origin: e.target.value })} />
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Destino
                  <input className="input" value={item.destination} onChange={(e) => updateItem(bi, ii, { destination: e.target.value })} />
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Prioridade
                  <select className="select" value={item.priority} onChange={(e) => updateItem(bi, ii, { priority: e.target.value })}>
                    {PRIORITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={{ fontSize: 11.5, color: "var(--text-faint)" }}>
                  Complexidade
                  <select className="select" value={item.complexity} onChange={(e) => updateItem(bi, ii, { complexity: e.target.value })}>
                    {COMPLEXITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginTop: 10 }}>
                {item.tasks.map((task, ti) => (
                  <div key={ti} style={{ display: "flex", alignItems: "flex-end", gap: 8, marginTop: 6, paddingTop: 6, borderTop: "1px dashed var(--border)" }}>
                    <label style={{ fontSize: 11.5, color: task.activity_type_unmatched ? "var(--red)" : "var(--text-faint)", flex: 2 }}>
                      Tipo de Atividade {task.activity_type_unmatched && "(selecione)"}
                      <select
                        className="select"
                        style={task.activity_type_unmatched ? { borderColor: "var(--red)" } : undefined}
                        value={task.activity_type_id ?? ""}
                        onChange={(e) => {
                          const id = e.target.value ? Number(e.target.value) : null;
                          const matched = activityTypes.find((t) => t.id === id);
                          updateTask(bi, ii, ti, { activity_type_id: id, activity_type_name: matched?.name ?? "", activity_type_unmatched: !id });
                        }}
                      >
                        <option value="">Selecione...</option>
                        {activityTypes.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={{ fontSize: 11.5, color: "var(--text-faint)", flex: 1 }}>
                      Qtd. Planejada
                      <input
                        type="number"
                        className="input"
                        value={task.quantity_planned ?? ""}
                        onChange={(e) => updateTask(bi, ii, ti, { quantity_planned: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </label>
                    <label style={{ fontSize: 11.5, color: "var(--text-faint)", flex: 1 }}>
                      Unidade
                      <input className="input" value={task.unit} onChange={(e) => updateTask(bi, ii, ti, { unit: e.target.value })} />
                    </label>
                    <button className="btn btn-outline btn-sm" onClick={() => removeTask(bi, ii, ti)} title="Remover tarefa">
                      <Icon name="close" style={{ fontSize: 13 }} />
                    </button>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                  <button className="btn btn-outline btn-sm" onClick={() => addTask(bi, ii)}>
                    <Icon name="add" style={{ fontSize: 13 }} />
                    Tarefa
                  </button>
                  <button className="btn btn-outline btn-sm" onClick={() => removeItem(bi, ii)}>
                    <Icon name="delete" style={{ fontSize: 13 }} />
                    Remover Item
                  </button>
                </div>
              </div>
            </div>
          ))}

          <button className="btn btn-outline btn-sm" onClick={() => addItem(bi)}>
            <Icon name="add" style={{ fontSize: 14 }} />
            Item
          </button>
        </div>
      ))}

      <button className="btn btn-outline btn-sm" onClick={addBlock}>
        <Icon name="add" style={{ fontSize: 14 }} />
        Bloco
      </button>
    </div>
  );
}
