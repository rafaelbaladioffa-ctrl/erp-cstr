import { useMemo, useState } from "react";
import { projectsApi } from "../../api/resources";
import type { ActivityType, CollaboratorFull, Project, RackPosition, WorkBlock } from "../../api/types";
import Icon from "../ui/Icon";

const STATUS_OPTIONS = [
  { value: "", label: "Manter status atual" },
  { value: "not_started", label: "Não Iniciada" },
  { value: "in_progress", label: "Em Andamento" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluída" },
  { value: "canceled", label: "Cancelada" },
];

export default function TasksBulkUpdatePanel({
  project,
  selectedIds,
  collaborators,
  rackPositions,
  workBlocks,
  activityTypes,
  onClear,
  onApplied,
}: {
  project: Project;
  selectedIds: number[];
  collaborators: CollaboratorFull[];
  rackPositions: RackPosition[];
  workBlocks?: WorkBlock[];
  activityTypes?: ActivityType[];
  onClear: () => void;
  onApplied: () => void;
}) {
  const [status, setStatus] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [collaboratorIds, setCollaboratorIds] = useState<number[]>([]);
  const [rackPositionIds, setRackPositionIds] = useState<number[]>([]);
  const [workBlockId, setWorkBlockId] = useState("");
  const [activityTypeId, setActivityTypeId] = useState("");
  const [quantityPlanned, setQuantityPlanned] = useState("");
  const [quantityCompleted, setQuantityCompleted] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const companyCollaborators = useMemo(
    () => collaborators.filter((c) => !project.company || c.company === project.company),
    [collaborators, project.company]
  );

  async function applyUpdate() {
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, {
        action: "update",
        task_ids: selectedIds,
        status: status || undefined,
        planned_start: plannedStart || undefined,
        planned_end: plannedEnd || undefined,
        estimated_hours: estimatedHours || undefined,
        collaborator_ids: collaboratorIds,
        rack_position_ids: rackPositionIds,
        work_block: workBlockId ? Number(workBlockId) : undefined,
        activity_type: activityTypeId ? Number(activityTypeId) : undefined,
        quantity_planned: quantityPlanned || undefined,
        quantity_completed: quantityCompleted || undefined,
      });
      alert(`${result.updated} Tarefa(s) atualizada(s) em massa.`);
      onApplied();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível atualizar as tarefas selecionadas.");
    } finally {
      setSaving(false);
    }
  }

  async function applyDelete() {
    if (!confirm(`Excluir ${selectedIds.length} tarefa(s) selecionada(s)?`)) return;
    setSaving(true);
    setError("");
    try {
      const result = await projectsApi.tasksBulk(project.id, { action: "delete", task_ids: selectedIds });
      alert(`${result.deleted} Tarefa(s) excluída(s) do Projeto.`);
      onApplied();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Não foi possível excluir as tarefas selecionadas.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--orange)" }}>
      <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <strong style={{ fontSize: 13.5 }}>{selectedIds.length} tarefa(s) selecionada(s) — Ações em Massa</strong>
        <button className="btn btn-outline btn-sm" onClick={onClear}>
          <Icon name="close" style={{ fontSize: 14 }} />
          Limpar seleção
        </button>
      </div>

      <div className="dynamic-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
        <div className="field-group">
          <span className="field-label">Status</span>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <span className="field-label">Início</span>
          <input type="datetime-local" className="input" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} />
        </div>
        <div className="field-group">
          <span className="field-label">Término</span>
          <input type="datetime-local" className="input" value={plannedEnd} onChange={(e) => setPlannedEnd(e.target.value)} />
        </div>
        <div className="field-group">
          <span className="field-label">Horas</span>
          <input type="number" className="input" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} />
        </div>
        <div className="field-group" style={{ gridColumn: "1 / 3" }}>
          <span className="field-label">Responsáveis (substitui os atuais)</span>
          <select
            multiple
            className="input"
            style={{ height: 84 }}
            value={collaboratorIds.map(String)}
            onChange={(e) => setCollaboratorIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
          >
            {companyCollaborators.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {project.has_rack_positions && (
          <div className="field-group" style={{ gridColumn: "3 / 5" }}>
            <span className="field-label">Rack Positions (substitui os atuais)</span>
            <select
              multiple
              className="input"
              style={{ height: 84 }}
              value={rackPositionIds.map(String)}
              onChange={(e) => setRackPositionIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
            >
              {rackPositions.map((rp) => (
                <option key={rp.id} value={rp.id}>
                  {rp.position}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {(workBlocks || activityTypes) && (
        <div className="dynamic-form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 10 }}>
          {workBlocks && (
            <div className="field-group">
              <span className="field-label">Bloco de Trabalho</span>
              <select className="select" value={workBlockId} onChange={(e) => setWorkBlockId(e.target.value)}>
                <option value="">Manter bloco atual</option>
                {workBlocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {activityTypes && (
            <div className="field-group">
              <span className="field-label">Tipo de Atividade</span>
              <select className="select" value={activityTypeId} onChange={(e) => setActivityTypeId(e.target.value)}>
                <option value="">Manter tipo atual</option>
                {activityTypes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="field-group">
            <span className="field-label">Quantidade Planejada</span>
            <input type="number" className="input" value={quantityPlanned} onChange={(e) => setQuantityPlanned(e.target.value)} />
          </div>
          <div className="field-group">
            <span className="field-label">Quantidade Concluída</span>
            <input type="number" className="input" value={quantityCompleted} onChange={(e) => setQuantityCompleted(e.target.value)} />
          </div>
        </div>
      )}

      {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={applyUpdate} disabled={saving}>
          Atualizar selecionadas
        </button>
        <button className="btn btn-outline" onClick={applyDelete} disabled={saving} style={{ color: "var(--red)" }}>
          Excluir selecionadas
        </button>
      </div>
    </div>
  );
}
