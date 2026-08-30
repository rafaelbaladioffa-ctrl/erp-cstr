import { useState } from "react";
import { workBlocksApi } from "../../api/resources";
import type { WorkBlock } from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const FIELDS: FieldConfig[] = [
  { name: "name", label: "Nome", type: "text", required: true },
  { name: "code", label: "Código", type: "text" },
  { name: "order", label: "Ordem", type: "number" },
  { name: "description", label: "Descrição", type: "textarea", span: 2 },
];

export default function WorkBlockFormModal({
  projectId,
  workBlock,
  onClose,
  onSaved,
}: {
  projectId: number;
  workBlock: WorkBlock | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>(
    workBlock ? { ...workBlock } : { name: "", code: "", order: 0, description: "" }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (workBlock) {
        await workBlocksApi.update(workBlock.id, values);
      } else {
        await workBlocksApi.create({ ...values, project: projectId });
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
    <Modal title={workBlock ? `Editar Bloco — ${workBlock.name}` : "Novo Bloco de Trabalho"} onClose={onClose} width={480}>
      <DynamicForm fields={FIELDS} values={values} errors={errors} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
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
