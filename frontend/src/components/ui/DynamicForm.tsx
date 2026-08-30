import { formatBrazilPhone } from "../../utils/formatPhone";

export type FieldOption = { value: string | number; label: string };

export type FieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "multiselect" | "email" | "date" | "datetime" | "phone";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOption[];
  span?: 1 | 2;
  placeholder?: string;
  /** Mostra o campo só quando o predicado retorna true — usado para
   * formulários "com Tipo" onde só um subconjunto de campos se aplica
   * (ex: Responsável CSTR usa Empresa, Responsável Cliente usa Cliente). */
  visibleIf?: (values: FormValues) => boolean;
}

export type FormValues = Record<string, unknown>;

export default function DynamicForm({
  fields,
  values,
  errors,
  onChange,
}: {
  fields: FieldConfig[];
  values: FormValues;
  errors?: Record<string, string[]>;
  onChange: (name: string, value: unknown) => void;
}) {
  return (
    <div className="dynamic-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" }}>
      {fields.filter((field) => !field.visibleIf || field.visibleIf(values)).map((field) => {
        const fieldErrors = errors?.[field.name];
        const value = values[field.name];
        return (
          <div
            key={field.name}
            className="field-group"
            style={{ gridColumn: field.span === 2 ? "1 / -1" : undefined, marginBottom: 14 }}
          >
            <span className="field-label">
              {field.label}
              {field.required && <span style={{ color: "var(--red)" }}> *</span>}
            </span>
            {renderInput(field, value, onChange)}
            {fieldErrors && (
              <span style={{ fontSize: 11.5, color: "var(--red)", marginTop: 2 }}>{fieldErrors.join(" ")}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function renderInput(field: FieldConfig, value: unknown, onChange: (name: string, value: unknown) => void) {
  switch (field.type) {
    case "textarea":
      return (
        <textarea
          className="input"
          style={{ height: 80 }}
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
    case "checkbox":
      return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, height: 38 }}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(field.name, e.target.checked)} />
          {field.placeholder || "Ativo"}
        </label>
      );
    case "select":
      return (
        <select
          className="select"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value === "" ? null : Number(e.target.value) || e.target.value)}
        >
          <option value="">Selecione...</option>
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    case "multiselect": {
      const selected = Array.isArray(value) ? value.map(String) : [];
      return (
        <select
          multiple
          className="input"
          style={{ height: 96 }}
          value={selected}
          onChange={(e) => onChange(field.name, Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
        >
          {field.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    case "number":
      return (
        <input
          type="number"
          className="input"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(field.name, e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "date":
      return (
        <input
          type="date"
          className="input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.name, e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <input
          type="datetime-local"
          className="input"
          value={(value as string) ?? ""}
          onChange={(e) => onChange(field.name, e.target.value || null)}
        />
      );
    case "email":
      return (
        <input
          type="email"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
    case "phone":
      return (
        <input
          type="text"
          inputMode="tel"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder || "+55 (11) 99999-9999"}
          onChange={(e) => onChange(field.name, formatBrazilPhone(e.target.value))}
        />
      );
    default:
      return (
        <input
          type="text"
          className="input"
          value={(value as string) ?? ""}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.name, e.target.value)}
        />
      );
  }
}
