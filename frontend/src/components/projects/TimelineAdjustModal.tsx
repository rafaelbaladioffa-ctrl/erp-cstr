import { useEffect, useState } from "react";
import { adjustmentsApi, type AdjustmentTask } from "../../api/resources";
import { presenceLabel } from "../../utils/timeline";
import Modal from "../ui/Modal";

// Ferramenta interna do administrador (só PT): o backend também restringe a superusuário.
const STATUS_OPTIONS = [
  "available",
  "in_progress",
  "lunch",
  "meal",
  "personal",
  "meeting",
  "traveling",
  "support",
  "site_blocked",
  "awaiting_release",
  "off_duty",
];
const TASK_STATUS_LABEL: Record<string, string> = {
  not_started: "pendente",
  in_progress: "em andamento",
  paused: "pausada",
  completed: "concluída",
  waiting_qaqc: "aguardando QA/QC",
  canceled: "cancelada",
};

// Horário do Brasil fixo (UTC−3), como no resto do sistema.
const toIso = (date: string, time: string) => `${date}T${time}:00-03:00`;

type Tab = "execution" | "status";
type Pause = { start: string; end: string };

export default function TimelineAdjustModal({
  collaboratorId,
  collaboratorName,
  date,
  onClose,
  onSaved,
}: {
  collaboratorId: number;
  collaboratorName: string;
  date: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tab, setTab] = useState<Tab>("execution");
  const [tasks, setTasks] = useState<AdjustmentTask[]>([]);
  const [taskId, setTaskId] = useState<number | "">("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("09:00");
  const [pauses, setPauses] = useState<Pause[]>([]);
  const [status, setStatus] = useState("available");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    adjustmentsApi.tasks(collaboratorId, date).then(setTasks).catch(() => setTasks([]));
  }, [collaboratorId, date]);

  const dateLabel = new Date(`${date}T00:00`).toLocaleDateString("pt-BR");
  const canSave =
    reason.trim().length >= 3 && !!start && !!end && (tab === "status" || taskId !== "") && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      if (tab === "execution") {
        await adjustmentsApi.execution({
          collaborator_id: collaboratorId,
          task_id: Number(taskId),
          start: toIso(date, start),
          end: toIso(date, end),
          pauses: pauses.filter((p) => p.start && p.end).map((p) => ({ start: toIso(date, p.start), end: toIso(date, p.end) })),
          reason: reason.trim(),
        });
      } else {
        await adjustmentsApi.statusWindow({
          collaborator_id: collaboratorId,
          start: toIso(date, start),
          end: toIso(date, end),
          status,
          reason: reason.trim(),
        });
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      setError(detail || "Não foi possível salvar o ajuste.");
    } finally {
      setSaving(false);
    }
  }

  const row = { display: "flex", gap: 10, marginBottom: 12, alignItems: "flex-end" } as const;
  const field = { display: "flex", flexDirection: "column", gap: 4, flex: 1 } as const;
  const label = { fontSize: 12, color: "var(--text-muted)", fontWeight: 600 } as const;

  return (
    <Modal title={`Ajustar timeline — ${collaboratorName}`} subtitle={`Dia ${dateLabel}`} onClose={onClose} width={560}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button type="button" className={`btn btn-sm ${tab === "execution" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("execution")}>
          Registrar execução de tarefa
        </button>
        <button type="button" className={`btn btn-sm ${tab === "status" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("status")}>
          Ajustar status
        </button>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 14 }}>
        {tab === "execution"
          ? "Grava a execução como se o próprio técnico tivesse iniciado e concluído: as horas valem como reais. Substitui o apontamento dele nessa tarefa."
          : "Define o status no trecho informado (ex.: técnico esqueceu de sair do almoço). Os status dentro do trecho são substituídos."}
      </p>

      {tab === "execution" && (
        <div style={{ ...row, flexDirection: "column", alignItems: "stretch" }}>
          <label style={field}>
            <span style={label}>Tarefa</span>
            <select className="select" value={taskId} onChange={(e) => setTaskId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">Selecione a tarefa…</option>
              {tasks.map((t) => (
                <option key={t.task_id} value={t.task_id}>
                  {t.name} — {t.project_name} ({TASK_STATUS_LABEL[t.status] ?? t.status})
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {tab === "status" && (
        <div style={row}>
          <label style={field}>
            <span style={label}>Status no trecho</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {presenceLabel(s, "pt-BR")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div style={row}>
        <label style={field}>
          <span style={label}>{tab === "execution" ? "Início da execução" : "Início do trecho"}</span>
          <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label style={field}>
          <span style={label}>{tab === "execution" ? "Fim da execução" : "Fim do trecho"}</span>
          <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
      </div>

      {tab === "execution" && (
        <div style={{ marginBottom: 12 }}>
          {pauses.map((p, i) => (
            <div key={i} style={row}>
              <label style={field}>
                <span style={label}>Pausa {i + 1} — início</span>
                <input className="input" type="time" value={p.start} onChange={(e) => setPauses((prev) => prev.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))} />
              </label>
              <label style={field}>
                <span style={label}>fim</span>
                <input className="input" type="time" value={p.end} onChange={(e) => setPauses((prev) => prev.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))} />
              </label>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => setPauses((prev) => prev.filter((_, j) => j !== i))}>
                Remover
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-outline btn-sm" onClick={() => setPauses((prev) => [...prev, { start: "", end: "" }])}>
            + Pausa (não conta como hora trabalhada)
          </button>
        </div>
      )}

      <label style={{ ...field, marginBottom: 12 }}>
        <span style={label}>Motivo do ajuste (obrigatório — fica no histórico)</span>
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: técnico esqueceu de iniciar a atividade; confirmado com o supervisor." />
      </label>

      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button className="btn btn-outline" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" onClick={save} disabled={!canSave}>
          {saving ? "Salvando..." : "Salvar ajuste"}
        </button>
      </div>
    </Modal>
  );
}
