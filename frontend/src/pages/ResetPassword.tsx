import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { passwordResetApi } from "../api/resources";

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

export default function ResetPassword() {
  const { uid, token } = useParams<{ uid: string; token: string }>();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!password) { setError("Informe a nova senha."); return; }
    if (password !== confirm) { setError("As senhas não coincidem."); return; }
    if (!uid || !token) { setError("Link inválido."); return; }
    setLoading(true);
    try {
      await passwordResetApi.confirm(uid, token, password);
      setDone(true);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Erro ao redefinir a senha. O link pode ter expirado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#07111f", padding: 16, position: "relative", overflow: "hidden" }}>
      <svg
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.38, pointerEvents: "none" }}
        viewBox="0 0 800 400"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        {EDGES.map(([a, b], i) => (
          <line key={i} x1={NODES[a].cx} y1={NODES[a].cy} x2={NODES[b].cx} y2={NODES[b].cy} stroke="#1e4a72" strokeWidth="1" />
        ))}
        {NODES.map((n, i) => (
          <circle key={i} cx={n.cx} cy={n.cy} r={n.r} fill={n.color} stroke={n.stroke ?? "none"} strokeWidth={n.stroke ? 1 : 0} />
        ))}
      </svg>

      <div style={{ position: "relative", zIndex: 1, background: "#fff", borderRadius: 16, padding: "36px 32px", width: "100%", maxWidth: 360, boxShadow: "0 20px 60px rgba(0,0,0,0.4)" }}>
        <div style={{ marginBottom: 20 }}>
          <img src="/consultimer-logo-light.png" alt="Consultimer" style={{ height: 34 }} />
        </div>

        {done ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0d1f30", marginBottom: 8 }}>Senha redefinida!</div>
            <div style={{ fontSize: 13, color: "#7a8a96", marginBottom: 24 }}>Sua senha foi alterada com sucesso.</div>
            <button
              onClick={() => navigate("/login")}
              style={{ width: "100%", height: 42, borderRadius: 9, background: "#e05b2b", color: "#fff", fontSize: 14.5, fontWeight: 700, border: "none", cursor: "pointer" }}
            >
              Ir para o login
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0d1f30", marginBottom: 4 }}>Redefinir senha</div>
            <div style={{ fontSize: 13, color: "#7a8a96", marginBottom: 24 }}>Escolha uma nova senha para sua conta.</div>

            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>Nova senha</label>
            <input
              type="password"
              className="input"
              style={{ width: "100%", marginBottom: 14, background: "#f6f8fa", border: "1px solid #d8e0e8" }}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />

            <label style={{ fontSize: 11.5, fontWeight: 600, color: "#3a4a56", display: "block", marginBottom: 5 }}>Confirmar senha</label>
            <input
              type="password"
              className="input"
              style={{ width: "100%", background: "#f6f8fa", border: "1px solid #d8e0e8" }}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />

            {error && <p style={{ color: "#c0392b", fontSize: 13, marginTop: 10 }}>{error}</p>}

            <button
              type="submit"
              disabled={loading}
              style={{ width: "100%", height: 42, borderRadius: 9, background: loading ? "#c0452a" : "#e05b2b", color: "#fff", fontSize: 14.5, fontWeight: 700, border: "none", cursor: loading ? "not-allowed" : "pointer", marginTop: 20 }}
            >
              {loading ? "Salvando..." : "Salvar nova senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
