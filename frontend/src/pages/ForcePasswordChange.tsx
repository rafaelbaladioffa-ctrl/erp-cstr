import { useState, type FormEvent } from "react";
import { meApi } from "../api/resources";
import { useAuth } from "../context/AuthContext";

export default function ForcePasswordChange() {
  const { logout, refreshUser } = useAuth();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
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
      await meApi.changePassword(oldPassword, newPassword);
      await refreshUser();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível alterar a senha.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--navy)",
        padding: 16,
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ padding: 36, width: "100%", maxWidth: 380, background: "#fff" }}>
        <div style={{ marginBottom: 22 }}>
          <img src="/consultimer-logo-light.png" alt="Consultimer" style={{ height: 34 }} />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>
          Este é seu primeiro acesso — antes de continuar, defina uma nova senha.
        </p>

        <label className="form-label" style={{ margin: "0 0 6px" }}>Senha atual (a que você recebeu)</label>
        <input
          className="input"
          style={{ width: "100%" }}
          type="password"
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />

        <label className="form-label">Nova senha</label>
        <input
          className="input"
          style={{ width: "100%" }}
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
        />

        <label className="form-label">Confirmar nova senha</label>
        <input
          className="input"
          style={{ width: "100%" }}
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
        />

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 24, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline" onClick={logout}>
            Sair
          </button>
          <button type="submit" disabled={saving} className="btn btn-primary">
            {saving ? "Salvando..." : "Trocar senha e entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
