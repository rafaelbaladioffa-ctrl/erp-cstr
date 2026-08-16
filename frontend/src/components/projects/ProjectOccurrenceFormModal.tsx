import { useState } from "react";
import { projectOccurrencesApi } from "../../api/resources";
import type { CollaboratorFull, ProjectOccurrence } from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const SEVERITY_OPTIONS = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Crítica" },
];

const STATUS_OPTIONS = [
  { value: "open", label: "Aberta" },
  { value: "in_progress", label: "Em Andamento" },
  { value: "resolved", label: "Resolvida" },
  { value: "canceled", label: "Cancelada" },
];

export default function ProjectOccurrenceFormModal({
  projectId,
  occurrence,
  collaborators,
  onClose,
  onSaved,
}: {
  projectId: number;
  occurrence: ProjectOccurrence | null;
  collaborators: CollaboratorFull[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const fields: FieldConfig[] = [
    { name: "title", label: "Título", type: "text", required: true, span: 2 },
    { name: "description", label: "Descrição", type: "textarea", span: 2 },
    { name: "responsible", label: "Responsável", type: "select", options: collaborators.map((c) => ({ value: c.id, label: c.name })) },
    { name: "severity", label: "Criticidade", type: "select", required: true, options: SEVERITY_OPTIONS },
    { name: "status", label: "Status", type: "select", required: true, options: STATUS_OPTIONS },
    { name: "occurred_at", label: "Data da Ocorrência", type: "date", required: true },
  ];

  const [values, setValues] = useState<FormValues>(
    occurrence
      ? { ...occurrence }
      : {
          title: "",
          description: "",
          responsible: "",
          severity: "medium",
          status: "open",
          occurred_at: new Date().toISOString().slice(0, 10),
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const payload = { ...values, responsible: (values.responsible as number | "" | null) || null } as Partial<ProjectOccurrence>;
      if (occurrence) {
        await projectOccurrencesApi.update(occurrence.id, payload);
      } else {
        await projectOccurrencesApi.create({ ...payload, project: projectId });
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
    <Modal title={occurrence ? `Editar Ocorrência — ${occurrence.title}` : "Nova Ocorrência"} onClose={onClose} width={560}>
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
