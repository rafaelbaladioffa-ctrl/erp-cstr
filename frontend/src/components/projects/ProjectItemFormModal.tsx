import { useState } from "react";
import { projectItemsApi } from "../../api/resources";
import type { ProjectItem, ProjectItemType, WorkBlock } from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

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

export default function ProjectItemFormModal({
  projectId,
  item,
  workBlocks,
  itemTypes,
  onClose,
  onSaved,
}: {
  projectId: number;
  item: ProjectItem | null;
  workBlocks: WorkBlock[];
  itemTypes: ProjectItemType[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>(
    item
      ? { ...item }
      : {
          work_block: workBlocks[0]?.id ?? null,
          internal_code: "",
          item_type: itemTypes[0]?.id ?? null,
          technology: "",
          fiber_count: null,
          connector_type_a: "",
          connector_type_b: "",
          part_number: "",
          length_meters: null,
          origin: "",
          destination: "",
          route: "",
          priority: "medium",
          complexity: "medium",
          notes: "",
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  const fields: FieldConfig[] = [
    { name: "internal_code", label: "Código Interno", type: "text" },
    { name: "item_type", label: "Tipo", type: "select", required: true, options: itemTypes.map((t) => ({ value: t.id, label: t.name })) },
    {
      name: "work_block",
      label: "Bloco de Trabalho",
      type: "select",
      options: [{ value: "", label: "Sem bloco" }, ...workBlocks.map((b) => ({ value: b.id, label: b.name }))],
    },
    { name: "technology", label: "Tecnologia", type: "text" },
    { name: "fiber_count", label: "Quantidade de Fibras", type: "number" },
    { name: "length_meters", label: "Metragem", type: "number" },
    { name: "connector_type_a", label: "Conector A", type: "text" },
    { name: "connector_type_b", label: "Conector B", type: "text" },
    { name: "part_number", label: "Part Number", type: "text" },
    { name: "origin", label: "Origem", type: "text" },
    { name: "destination", label: "Destino", type: "text" },
    { name: "route", label: "Rota", type: "text", span: 2 },
    { name: "priority", label: "Prioridade", type: "select", options: PRIORITY_OPTIONS },
    { name: "complexity", label: "Complexidade", type: "select", options: COMPLEXITY_OPTIONS },
    { name: "notes", label: "Observações", type: "textarea", span: 2 },
  ];

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const payload = { ...values, work_block: (values.work_block as number | null | undefined) || null };
      if (item) {
        await projectItemsApi.update(item.id, payload);
      } else {
        await projectItemsApi.create({ ...payload, project: projectId });
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={item ? `Editar Item — ${item.internal_code || item.item_type_name}` : "Novo Item do Projeto"} onClose={onClose} width={640}>
      <DynamicForm fields={fields} values={values} errors={errors} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
      {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
