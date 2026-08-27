import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password, remember);
      navigate("/projetos");
    } catch {
      setError("Usuário ou senha inválidos.");
    } finally {
      setLoading(false);
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
      }}
    >
      <form onSubmit={handleSubmit} className="card" style={{ padding: 36, width: 360, background: "#fff" }}>
        <div style={{ marginBottom: 22 }}>
          <img src="/consultimer-logo-light.png" alt="Consultimer" style={{ height: 34 }} />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 22 }}>Entre com seu usuário do sistema</p>

        <label className="form-label" style={{ margin: "0 0 6px" }}>Usuário</label>
        <input className="input" style={{ width: "100%" }} value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />

        <label className="form-label">Senha</label>
        <input type="password" className="input" style={{ width: "100%" }} value={password} onChange={(e) => setPassword(e.target.value)} />

        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, fontSize: 13, color: "var(--text-muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Manter-me conectado neste dispositivo
        </label>

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-primary" style={{ width: "100%", justifyContent: "center", marginTop: 24 }}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
