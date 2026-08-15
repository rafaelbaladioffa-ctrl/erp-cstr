import { useState, type CSSProperties, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
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
        background: "#F7F9FB",
        fontFamily: "Manrope, Arial, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "#fff",
          padding: 32,
          borderRadius: 12,
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          width: 340,
        }}
      >
        <h1 style={{ fontSize: 20, color: "#172033", marginBottom: 4 }}>ERP CSTR</h1>
        <p style={{ fontSize: 13, color: "#526174", marginBottom: 24 }}>Entre com seu usuário do sistema</p>
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Usuário</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          style={inputStyle}
          autoFocus
        />
        <label style={{ display: "block", fontSize: 13, fontWeight: 600, margin: "14px 0 6px" }}>Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        {error && <p style={{ color: "#DC2626", fontSize: 13, marginTop: 12 }}>{error}</p>}
        <button type="submit" disabled={loading} style={buttonStyle}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #DDE3EA",
  fontSize: 14,
  boxSizing: "border-box",
};

const buttonStyle: CSSProperties = {
  width: "100%",
  marginTop: 24,
  padding: "10px 12px",
  borderRadius: 8,
  border: "none",
  background: "#F16023",
  color: "#fff",
  fontWeight: 700,
  fontSize: 14,
  cursor: "pointer",
};
