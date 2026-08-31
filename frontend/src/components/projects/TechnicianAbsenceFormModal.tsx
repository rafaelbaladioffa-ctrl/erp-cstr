import { useEffect, useState } from "react";
import { technicianAbsencesApi } from "../../api/resources";
import type { TechnicianAbsence } from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const FIELDS: FieldConfig[] = [
  { name: "date_from", label: "De", type: "date", required: true },
  { name: "date_to", label: "Até", type: "date", required: true },
  { name: "reason", label: "Motivo", type: "text", placeholder: "Ex: Férias, Atestado médico, Folga", span: 2 },
];

export default function TechnicianAbsenceFormModal({
  collaboratorId,
  collaboratorName,
  onClose,
  onSaved,
}: {
  collaboratorId: number;
  collaboratorName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<FormValues>({ date_from: "", date_to: "", reason: "" });
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<TechnicianAbsence[]>([]);
  const [removingId, setRemovingId] = useState<number | null>(null);

  useEffect(() => {
    technicianAbsencesApi.list(collaboratorId).then((data) => setExisting(data.results));
  }, [collaboratorId]);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const created = await technicianAbsencesApi.create({
        collaborator: collaboratorId,
        date_from: String(values.date_from),
        date_to: String(values.date_to),
        reason: values.reason ? String(values.reason) : "",
      });
      setExisting((prev) => [created, ...prev]);
      setValues({ date_from: "", date_to: "", reason: "" });
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: number) {
    setRemovingId(id);
    try {
      await technicianAbsencesApi.remove(id);
      setExisting((prev) => prev.filter((a) => a.id !== id));
      onSaved();
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <Modal title={`Ausências — ${collaboratorName}`} onClose={onClose} width={480}>
      {existing.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          {existing.map((a) => (
            <div
              key={a.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "6px 0",
                borderBottom: "1px solid var(--border)",
                fontSize: 13,
              }}
            >
              <span>
                {new Date(`${a.date_from}T00:00`).toLocaleDateString("pt-BR")} a {new Date(`${a.date_to}T00:00`).toLocaleDateString("pt-BR")}
                {a.reason ? ` — ${a.reason}` : ""}
              </span>
              <button
                type="button"
                className="btn btn-outline btn-sm"
                disabled={removingId === a.id}
                onClick={() => handleRemove(a.id)}
              >
                {removingId === a.id ? "Removendo..." : "Remover"}
              </button>
            </div>
          ))}
        </div>
      )}
      <DynamicForm fields={FIELDS} values={values} errors={errors} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
      {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>
          Fechar
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !values.date_from || !values.date_to}>
          {saving ? "Salvando..." : "Adicionar Ausência"}
        </button>
      </div>
    </Modal>
  );
}
