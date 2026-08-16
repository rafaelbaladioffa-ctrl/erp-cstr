import { useState } from "react";
import { projectsApi } from "../../api/resources";
import Modal from "../ui/Modal";

export default function RackPositionBulkModal({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.rackPositionsBulk(projectId, text);
      let message = `${result.created} Rack Position(s) cadastrado(s) em massa.`;
      if (result.skipped) message += ` ${result.skipped} já existia(m) e foi(ram) ignorado(s).`;
      alert(message);
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível importar os Rack Positions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Adicionar Rack Positions em Massa" onClose={onClose} width={520}>
      <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
        Um Rack Position por linha, no formato <strong>Rack Position;DH;Links;UTP</strong> (DH, Links e UTP são
        opcionais — ex.: apenas "RACK03" também é válido).
      </p>
      <textarea
        className="input"
        style={{ height: 160, fontFamily: "monospace" }}
        placeholder={"RACK01;DH1;24;48\nRACK02;DH2;12;24\nRACK03"}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
        <button className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving || !text.trim()}>
          {saving ? "Importando..." : "Importar"}
        </button>
      </div>
    </Modal>
  );
}
