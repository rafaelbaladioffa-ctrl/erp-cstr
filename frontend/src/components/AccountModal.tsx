import { useState, type FormEvent } from "react";
import { meApi } from "../api/resources";
import { useAuth } from "../context/AuthContext";
import Modal from "./ui/Modal";

export default function AccountModal({ onClose }: { onClose: () => void }) {
  const { user, logout } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const displayName = user?.full_name || user?.username || "";
  const email = user?.email || user?.username || "";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (!oldPassword || !newPassword) {
      setError("Preencha a senha atual e a nova senha.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    setSaving(true);
    try {
      const result = await meApi.changePassword(oldPassword, newPassword);
      setSuccess(result.detail || "Senha alterada com sucesso.");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Minha Conta" subtitle={`${displayName} · ${email}`} onClose={onClose} width={440}>
      <form onSubmit={handleSubmit}>
        <label className="form-label" style={{ marginTop: 0 }}>
          Senha atual
        </label>
        <input
          className="input"
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
        />

        <label className="form-label">Nova senha</label>
        <input
          className="input"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />

        <label className="form-label">Confirmar nova senha</label>
        <input
          className="input"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
        {success && <p style={{ color: "var(--green)", fontSize: 13, marginTop: 10 }}>{success}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-outline" onClick={logout}>
            Sair da conta
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Salvando..." : "Alterar senha"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
