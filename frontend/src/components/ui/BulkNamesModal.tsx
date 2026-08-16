import { useState } from "react";
import DynamicForm, { type FieldConfig, type FormValues } from "./DynamicForm";
import Modal from "./Modal";

export default function BulkNamesModal({
  title,
  helpText,
  extraFields,
  extraValues,
  onSave,
  onClose,
  onSaved,
}: {
  title: string;
  helpText: string;
  extraFields: FieldConfig[];
  extraValues: FormValues;
  onSave: (names: string[], extra: FormValues) => Promise<{ created: number }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [namesText, setNamesText] = useState("");
  const [values, setValues] = useState<FormValues>(extraValues);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    const names = namesText.split("\n").map((n) => n.trim()).filter(Boolean);
    if (!names.length) return;
    setSaving(true);
    setError("");
    try {
      const result = await onSave(names, values);
      alert(`${result.created} registro(s) cadastrado(s) com sucesso.`);
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível cadastrar os registros.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose} width={560}>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>{helpText}</p>
      <textarea
        className="input"
        style={{ height: 140, marginBottom: 14 }}
        placeholder={"Digite ou cole um nome por linha"}
        value={namesText}
        onChange={(e) => setNamesText(e.target.value)}
      />
      {extraFields.length > 0 && (
        <DynamicForm fields={extraFields} values={values} onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))} />
      )}
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
        <button className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !namesText.trim()}>
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </Modal>
  );
}
