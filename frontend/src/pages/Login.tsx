import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { savedUsername } from "../api/client";
import { useAuth } from "../context/AuthContext";

const NODES = [
  { cx: 60,  cy: 48,  r: 5,   color: "#e05b2b" },
  { cx: 185, cy: 118, r: 3.5, color: "#1e7a4a" },
  { cx: 330, cy: 72,  r: 5.5, color: "#e05b2b" },
  { cx: 520, cy: 155, r: 3.5, color: "#1e7a4a" },
  { cx: 640, cy: 55,  r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 148, cy: 210, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 290, cy: 305, r: 4.5, color: "#e05b2b" },
  { cx: 565, cy: 325, r: 3.5, color: "#1e7a4a" },
  { cx: 65,  cy: 328, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 750, cy: 220, r: 3.5, color: "#1e7a4a" },
  { cx: 700, cy: 340, r: 3.5, color: "#1e4a72", stroke: "#4a8fb5" },
  { cx: 420, cy: 280, r: 3,   color: "#1e4a72", stroke: "#4a8fb5" },
];

const EDGES = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,2],[5,6],[6,3],[3,7],[6,8],[3,9],[9,10],[7,10],[6,11],[11,3],
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(savedUsername.get());
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(() => Boolean(savedUsername.get()));
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(username, password);
      if (remember) {
        savedUsername.set(username);
      } else {
        savedUsername.clear();
      }
      navigate("/");
    } catch {
      setError("Usuário ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07111f", padding: 16, position: "relative", overflow: "hidden" }}>

      {/* Fundo: rede de nós e conexões */}
      <svg
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.38, pointerEvents: "none" }}
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {EDGES.map(([a, b], i) => (
          <line
            key={i}
            x1={NODES[a].cx} y1={NODES[a].cy}
            x2={NODES[b].cx} y2={NODES[b].cy}
            stroke="#1e4a72" strokeWidth="1"
          />
        ))}
        {NODES.map((n, i) => (
          <circle
            key={i}
            cx={n.cx} cy={n.cy} r={n.r}
            fill={n.color}
            stroke={n.stroke ?? "none"}
            strokeWidth={n.stroke ? 1 : 0}
          />
        ))}
      </svg>

      {/* Card */}
      <form
        onSubmit={handleSubmit}
        style={{
          position: "relative",
          zIndex: 1,
          background: "#fff",
          borderRadius: 16,
          padding: "36px 32px",
          width: "100%",
          maxWidth: 360,
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
      >
        {/* Logo */}
        <div style={{ marginBottom: 20 }}>
          <img src="/consultimer-logo-light.png" alt="Consultimer" style={{ height: 34 }} />
        </div>

        <div style={{ fontSize: 18, fontWeight: 800, color: "#0d1f30", marginBottom: 4 }}>Acesse o sistema</div>
        <div style={{ fontSize: 13, color: "#7a8a96", marginBottom: 24 }}>Gestão de obras em data centers hyperscale</div>

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>Usuário</label>
        <input
          className="input"
          style={{ width: "100%", marginBottom: 14, background: "#f6f8fa", border: "1px solid #d8e0e8" }}
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>Senha</label>
        <input
          type="password"
          className="input"
          style={{ width: "100%", background: "#f6f8fa", border: "1px solid #d8e0e8" }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, marginBottom: 4 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#7a8a96", cursor: "pointer" }}>
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} style={{ accentColor: "#e05b2b" }} />
            Salvar usuário
          </label>
        </div>

        {error && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 8 }}>{error}</p>}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            height: 42,
            borderRadius: 9,
            background: loading ? "#c0452a" : "#e05b2b",
            color: "#fff",
            fontSize: 14.5,
            fontWeight: 700,
            border: "none",
            cursor: loading ? "not-allowed" : "pointer",
            marginTop: 20,
            letterSpacing: ".02em",
          }}
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 11, color: "#aab5c0" }}>ERP CSTR · v2.0</div>
      </form>
    </div>
  );
}
