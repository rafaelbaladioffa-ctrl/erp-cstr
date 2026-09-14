import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { collaboratorsApi, planningApi, projectTasksApi, projectsApi } from "../../api/resources";
import type { Collaborator, Project, ProjectPlan, ProjectTask, SowImport } from "../../api/types";
import Icon from "../ui/Icon";

/** Planejamento > Plano do Projeto — fecha o loop
 * SOW -> ScopeItems -> GeneratedTasks -> ProjectTask (tarefa operacional
 * real) -> atribuição a técnico -> Minhas Tarefas. Consolida uma SOW (ou
 * um conjunto de ScopeItems) dentro de um Projeto já existente; "Criar
 * tarefas do projeto" é sempre uma ação explícita do usuário, idempotente
 * por (projeto, GeneratedTask) — nunca duplica, nunca sobrescreve uma
 * ProjectTask já criada. Reaproveita a ProjectTask/ProjectTaskAssignment
 * já existentes (Minhas Tarefas, despacho) — não cria nenhuma estrutura
 * paralela de tarefas. */

const PRIORITY_OPTIONS = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

export default function ProjectPlanPanel() {
  const [searchParams] = useSearchParams();

  const [projects, setProjects] = useState<Project[]>([]);
  const [sowImports, setSowImports] = useState<SowImport[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);

  const [projectId, setProjectId] = useState<number | "">("");
  const [sowImportCode, setSowImportCode] = useState<string>("");

  const [plan, setPlan] = useState<ProjectPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);

  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [filterActivity, setFilterActivity] = useState("");
  const [filterPath, setFilterPath] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [assignCollaboratorIds, setAssignCollaboratorIds] = useState<number[]>([]);
  const [assignDeadline, setAssignDeadline] = useState("");
  const [assignPriority, setAssignPriority] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);

  useEffect(() => {
    projectsApi.list({ page_size: "500" }).then((r) => setProjects(r.results));
    planningApi.sowImports.list({ page_size: "100" }).then((r) => setSowImports(r.results));
    collaboratorsApi.list({ page_size: "500" }).then((r) => setCollaborators(r.results));

    const presetProject = searchParams.get("planProject");
    const presetSow = searchParams.get("planSow");
    if (presetProject) setProjectId(Number(presetProject));
    if (presetSow) setSowImportCode(presetSow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadPlan() {
    if (!projectId) {
      setPlanError("Selecione um projeto.");
      return;
    }
    setPlanError(null);
    setCreateMessage(null);
    setLoadingPlan(true);
    try {
      const data = await planningApi.projectPlan.get(projectId, sowImportCode ? { sowImport: sowImportCode } : {});
      setPlan(data);
      await loadTasks();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setPlanError(axiosErr.response?.data?.detail || "Não foi possível carregar o plano.");
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function loadTasks() {
    if (!projectId) return;
    setLoadingTasks(true);
    try {
      const params: Record<string, string> = { project: String(projectId) };
      if (sowImportCode) params.sow_import = sowImportCode;
      const data = await projectTasksApi.list(params);
      setTasks(data.results);
    } finally {
      setLoadingTasks(false);
    }
  }

  useEffect(() => {
    if (projectId && searchParams.get("planProject")) {
      loadPlan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreateTasks() {
    if (!projectId) return;
    setCreating(true);
    setCreateMessage(null);
    try {
      const result = await planningApi.projectPlan.createTasks(projectId, sowImportCode ? { sowImport: sowImportCode } : {});
      setCreateMessage(`${result.created_count} tarefa(s) criada(s) no projeto (${result.existing_count} já existiam).`);
      await loadPlan();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setCreateMessage(null);
      setPlanError(axiosErr.response?.data?.detail || "Não foi possível criar as tarefas.");
    } finally {
      setCreating(false);
    }
  }

  function toggleTask(id: number) {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filteredTasks = tasks.filter((t) => {
    if (filterActivity && t.activity_code !== filterActivity) return false;
    if (filterPath && t.path_code !== filterPath) return false;
    if (filterStatus && t.status !== filterStatus) return false;
    return true;
  });

  const distinctActivities = Array.from(new Set(tasks.map((t) => t.activity_code).filter(Boolean))) as string[];
  const distinctPaths = Array.from(new Set(tasks.map((t) => t.path_code).filter(Boolean))) as string[];
  const distinctStatuses = Array.from(new Set(tasks.map((t) => t.status)));

  async function handleAssign() {
    if (!projectId || selectedTaskIds.size === 0 || assignCollaboratorIds.length === 0) {
      setAssignMessage("Selecione ao menos uma tarefa e um técnico.");
      return;
    }
    setAssigning(true);
    setAssignMessage(null);
    try {
      const result = await projectsApi.tasksBulk(projectId, {
        action: "update",
        task_ids: Array.from(selectedTaskIds),
        collaborator_ids: assignCollaboratorIds,
        planned_end: assignDeadline ? new Date(assignDeadline).toISOString() : null,
        priority: assignPriority || undefined,
      });
      setAssignMessage(`${result.updated ?? selectedTaskIds.size} tarefa(s) atribuída(s).`);
      setSelectedTaskIds(new Set());
      await loadTasks();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setAssignMessage(axiosErr.response?.data?.detail || "Não foi possível atribuir as tarefas.");
    } finally {
      setAssigning(false);
    }
  }

  const selectedProject = projects.find((p) => p.id === projectId);

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <div className="toolbar-title">Plano do Projeto</div>
          <div className="toolbar-subtitle">
            Consolida uma SOW (ou um conjunto de Itens de Escopo) dentro de um Projeto e transforma as Tarefas
            Geradas já resolvidas em Tarefas do Projeto reais — atribuíveis a técnicos, visíveis em Minhas Tarefas.
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
        <div className="field-group">
          <span className="field-label">Projeto</span>
          <select className="select" value={projectId} onChange={(e) => setProjectId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Selecione...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field-group">
          <span className="field-label">Importação SOW</span>
          <select className="select" value={sowImportCode} onChange={(e) => setSowImportCode(e.target.value)}>
            <option value="">(nenhuma — usar todos os Itens de Escopo do projeto)</option>
            {sowImports.map((s) => (
              <option key={s.id} value={s.code}>
                {s.code} — {s.title || "sem título"}
              </option>
            ))}
          </select>
        </div>
        <button className="btn btn-primary" onClick={loadPlan} disabled={!projectId || loadingPlan}>
          {loadingPlan ? "Carregando…" : "Carregar"}
        </button>
      </div>

      {planError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{planError}</p>}

      {plan && (
        <>
          <div
            style={{
              padding: 12,
              marginBottom: 14,
              background: "var(--surface-2, #f7f7f8)",
              borderRadius: 8,
              fontSize: 13,
              lineHeight: 1.8,
            }}
          >
            <div>
              Projeto: <strong>{plan.project.name}</strong>
            </div>
            <div>
              ScopeItems prontos: <strong>{plan.totals.scope_items_ready}</strong> de {plan.totals.scope_items_total} (
              {plan.totals.scope_items_pending_resolution} aguardando resolução de template)
            </div>
            <div>
              Tarefas operacionais a criar: <strong>{plan.totals.project_tasks_to_create}</strong>
            </div>
            <div>
              Tarefas já existentes: <strong>{plan.totals.project_tasks_existing}</strong>
            </div>
            <div>
              Expansão por Path A/B:{" "}
              <strong>{plan.totals.paths_involved.length > 0 ? `sim (${plan.totals.paths_involved.join(", ")})` : "não"}</strong>
            </div>
            {plan.totals.warnings.length > 0 && (
              <div style={{ color: "var(--amber)", marginTop: 4 }}>
                {plan.totals.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateTasks}
                disabled={creating || plan.totals.project_tasks_to_create === 0}
              >
                {creating ? "Criando…" : "Criar tarefas do projeto"}
              </button>
            </div>
          </div>

          {createMessage && (
            <div style={{ marginBottom: 14, fontSize: 13 }}>
              <p style={{ color: "var(--green)" }}>✓ {createMessage}</p>
              <div style={{ display: "flex", gap: 8 }}>
                {selectedProject && (
                  <Link className="btn btn-outline btn-sm" to={`/projetos/${selectedProject.id}`}>
                    Abrir tarefas do projeto
                  </Link>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => document.getElementById("plan-assign-section")?.scrollIntoView({ behavior: "smooth" })}>
                  Atribuir equipe
                </button>
              </div>
            </div>
          )}

          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Item de Escopo</th>
                  <th>Status da Regra</th>
                  <th>Template</th>
                  <th>Revisão</th>
                  <th>Tarefas Geradas</th>
                  <th>Tarefas do Projeto já existentes</th>
                </tr>
              </thead>
              <tbody>
                {plan.scope_items.map((si) => (
                  <tr key={si.id}>
                    <td title={si.raw_text}>{si.code}</td>
                    <td>{si.rule_resolution_status}</td>
                    <td>{si.resolved_template_code || "—"}</td>
                    <td>{si.requires_review ? "Exige revisão" : "—"}</td>
                    <td>{si.generated_tasks_count}</td>
                    <td>{si.project_tasks_existing_count}</td>
                  </tr>
                ))}
                {plan.scope_items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      Nenhum Item de Escopo encontrado para este filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div id="plan-assign-section">
            <div className="toolbar-title" style={{ fontSize: 15, marginBottom: 8 }}>
              Tarefas do projeto {sowImportCode ? `(SOW ${sowImportCode})` : ""}
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <select className="select" style={{ maxWidth: 200 }} value={filterActivity} onChange={(e) => setFilterActivity(e.target.value)}>
                <option value="">Todas as Atividades</option>
                {distinctActivities.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <select className="select" style={{ maxWidth: 160 }} value={filterPath} onChange={(e) => setFilterPath(e.target.value)}>
                <option value="">Todos os Paths</option>
                {distinctPaths.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select className="select" style={{ maxWidth: 180 }} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                <option value="">Todos os Status</option>
                {distinctStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {loadingTasks && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando tarefas…</p>}

            {!loadingTasks && (
              <div className="table-wrap" style={{ marginBottom: 14 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Tarefa</th>
                      <th>Atividade</th>
                      <th>Path</th>
                      <th>Qtd</th>
                      <th>Status</th>
                      <th>Responsáveis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <input type="checkbox" checked={selectedTaskIds.has(t.id)} onChange={() => toggleTask(t.id)} />
                        </td>
                        <td>{t.task_name || t.custom_name}</td>
                        <td>{t.activity_code || "—"}</td>
                        <td>{t.path_code || "—"}</td>
                        <td>
                          {t.quantity_planned ?? "—"} {t.unit}
                        </td>
                        <td>{t.status_display}</td>
                        <td>{t.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                      </tr>
                    ))}
                    {filteredTasks.length === 0 && (
                      <tr>
                        <td colSpan={7} className="table-empty">
                          Nenhuma tarefa do projeto ainda — clique em "Criar tarefas do projeto" acima.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
              <div className="field-group">
                <span className="field-label">Técnico(s)</span>
                <select
                  className="select"
                  multiple
                  value={assignCollaboratorIds.map(String)}
                  onChange={(e) => setAssignCollaboratorIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}
                >
                  {collaborators.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <span className="field-label">Prazo</span>
                <input className="input" type="date" value={assignDeadline} onChange={(e) => setAssignDeadline(e.target.value)} />
              </div>
              <div className="field-group">
                <span className="field-label">Prioridade</span>
                <select className="select" value={assignPriority} onChange={(e) => setAssignPriority(e.target.value)}>
                  <option value="">(não alterar)</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={assigning}>
                <Icon name="person_add" style={{ fontSize: 14 }} />
                {assigning ? "Atribuindo…" : `Confirmar atribuição (${selectedTaskIds.size})`}
              </button>
            </div>
            {assignMessage && <p style={{ fontSize: 13, marginTop: 8 }}>{assignMessage}</p>}
          </div>
        </>
      )}
    </div>
  );
}
