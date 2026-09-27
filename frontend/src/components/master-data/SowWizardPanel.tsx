import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collaboratorsApi, masterDataApi, planningApi, projectsApi, projectTasksApi } from "../../api/resources";
import type { Collaborator, Project, ProjectTask, SowImport, SowParsedItem } from "../../api/types";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";
import Icon from "../ui/Icon";

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

interface SowSummary {
  scope_items_created: number;
  templates_resolved: number;
  items_awaiting_resolution: number;
  tasks_generated: number;
}

interface EditForm {
  suggested_cable_family: number | "";
  suggested_cable_spec: number | "";
  suggested_network: number | "";
  suggested_workstream: number | "";
  suggested_paths: number[];
  quantity: number | "";
  unit: string;
  length_type: string;
  length_m: number | "";
  medium: string;
  preterminated: string;
  color: string;
  fiber_count: number | "";
}

function editFormFromItem(item: SowParsedItem): EditForm {
  return {
    suggested_cable_family: item.suggested_cable_family ?? "",
    suggested_cable_spec: item.suggested_cable_spec ?? "",
    suggested_network: item.suggested_network ?? "",
    suggested_workstream: item.suggested_workstream ?? "",
    suggested_paths: item.suggested_paths ?? [],
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
    length_type: item.length_type ?? "",
    length_m: item.length_m ? Number(item.length_m) : "",
    medium: item.medium ?? "",
    preterminated: item.preterminated === null ? "" : item.preterminated ? "true" : "false",
    color: item.color ?? "",
    fiber_count: item.fiber_count ?? "",
  };
}

const SOURCE_TYPE_OPTIONS = [
  { value: "TEXT", label: "Texto colado" },
  { value: "PDF", label: "Arquivo PDF" },
  { value: "DOCX", label: "Arquivo DOCX" },
  { value: "IMAGE", label: "Imagem" },
  { value: "OTHER", label: "Outro arquivo" },
];

const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  NEEDS_REVIEW: "Exige revisão",
};

const PRIORITY_OPTIONS = [
  { value: "low", label: "Baixa" },
  { value: "medium", label: "Média" },
  { value: "high", label: "Alta" },
  { value: "urgent", label: "Urgente" },
];

function confidenceColor(band: string | null) {
  if (band === "HIGH") return "var(--green)";
  if (band === "MEDIUM") return "var(--amber)";
  if (band === "LOW") return "var(--red)";
  return "var(--text-muted)";
}

function reviewStatusColor(status: string) {
  if (status === "APPROVED") return "var(--green)";
  if (status === "REJECTED") return "var(--red)";
  if (status === "NEEDS_REVIEW") return "var(--amber)";
  return "var(--text-muted)";
}

// ---------------------------------------------------------------------------
// Barra de progresso de etapas
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, label: "Importar SOW" },
  { n: 2, label: "Revisar Itens" },
  { n: 3, label: "Resolver Templates" },
  { n: 4, label: "Gerar Tarefas" },
  { n: 5, label: "Enviar ao Projeto" },
];

function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 0 }}>
      {STEPS.map((s, i) => (
        <Fragment key={s.n}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 700,
                background: s.n < current ? "var(--green)" : s.n === current ? "var(--orange)" : "var(--surface-2, #eee)",
                color: s.n <= current ? "#fff" : "var(--text-faint)",
                transition: "background 0.2s",
              }}
            >
              {s.n < current ? <Icon name="check" style={{ fontSize: 16 }} /> : s.n}
            </div>
            <div
              style={{
                fontSize: 11,
                marginTop: 4,
                color: s.n === current ? "var(--orange)" : s.n < current ? "var(--green)" : "var(--text-faint)",
                fontWeight: s.n === current ? 700 : 400,
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {s.label}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div
              style={{
                flex: 2,
                height: 2,
                marginBottom: 18,
                background: s.n < current ? "var(--green)" : "var(--border, #ddd)",
                transition: "background 0.2s",
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wizard principal
// ---------------------------------------------------------------------------

export default function SowWizardPanel({ refs }: { refs: ReferenceData }) {
  const [step, setStep] = useState(1);

  // Passo 1 — Importar SOW
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("TEXT");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // SOW importada (persiste por todo o wizard)
  const [activeImport, setActiveImport] = useState<SowImport | null>(null);

  // Passo 2 — Revisar itens parseados
  const [items, setItems] = useState<SowParsedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Passo 3 — Resolver templates
  const [summary, setSummary] = useState<SowSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Passo 4 — Gerar tarefas (usa summary)

  // Passo 5 — Enviar ao projeto
  const [projects, setProjects] = useState<Project[]>([]);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [projectId, setProjectId] = useState<number | "">("");
  const [planLoading, setPlanLoading] = useState(false);
  const [planData, setPlanData] = useState<{ project_tasks_to_create: number; project_tasks_existing: number } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [taskCreating, setTaskCreating] = useState(false);
  const [taskCreateResult, setTaskCreateResult] = useState<{ created_count: number; existing_count: number } | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<number>>(new Set());
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [assignMessage, setAssignMessage] = useState<string | null>(null);
  const [assignCollaboratorIds, setAssignCollaboratorIds] = useState<number[]>([]);
  const [assignDeadline, setAssignDeadline] = useState("");
  const [assignPriority, setAssignPriority] = useState("");

  // Carrega projetos/colaboradores quando chega no passo 5
  useEffect(() => {
    if (step === 5 && projects.length === 0) {
      projectsApi.list({ page_size: "500" }).then((r) => setProjects(r.results));
      collaboratorsApi.list({ page_size: "500" }).then((r) => setCollaborators(r.results));
    }
  }, [step, projects.length]);

  // ---------- helpers ----------

  function withBusy<T>(id: number, fn: () => Promise<T>) {
    setBusyIds((prev) => new Set(prev).add(id));
    return fn().finally(() =>
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      })
    );
  }

  async function loadItems(importId: number) {
    setLoadingItems(true);
    try {
      const data = await planningApi.sowImports.items(importId);
      setItems(data);
    } finally {
      setLoadingItems(false);
    }
  }

  async function loadSummary(importId: number) {
    setSummaryLoading(true);
    try {
      const data = await planningApi.sowImports.summary(importId);
      setSummary(data);
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }

  // ---------- Passo 1 ----------

  async function handleCreateAndProcess() {
    setCreateError(null);
    if (!sourceFile && !sourceText.trim()) {
      setCreateError("Cole o texto do SOW ou envie um arquivo.");
      return;
    }
    setCreating(true);
    try {
      const created = sourceFile
        ? await planningApi.sowImports.createWithFile({ title, source_type: sourceType, source_text: sourceText, source_file: sourceFile })
        : await planningApi.sowImports.create({ title, source_type: sourceType, source_text: sourceText } as never);

      if (created.status === "FAILED") {
        setActiveImport(created);
        setCreateError(`Falha no processamento: ${created.error_message}`);
        return;
      }

      const processed = await planningApi.sowImports.process(created.id);
      setActiveImport(processed);
      await loadItems(processed.id);
      await loadSummary(processed.id);
      setStep(2);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string; source_text?: string[] } } };
      setCreateError(e.response?.data?.detail || e.response?.data?.source_text?.[0] || "Não foi possível processar o SOW.");
    } finally {
      setCreating(false);
    }
  }

  // ---------- Passo 2 ----------

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function selectAll() {
    const ids = items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).map((i) => i.id);
    setSelectedIds(new Set(ids));
  }

  async function handleApproveSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    setActionMessage(null);
    setBulkBusy(true);
    try {
      const result = await planningApi.sowImports.approveSelected(activeImport.id, Array.from(selectedIds));
      setActiveImport(result.sow_import);
      if (result.errors.length > 0) setActionError(`${result.errors.length} item(ns) não puderam ser aprovados.`);
      if (result.approved.length > 0) setActionMessage(`${result.approved.length} item(ns) aprovado(s).`);
      setSelectedIds(new Set());
      await loadItems(activeImport.id);
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || "Erro ao aprovar itens.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleRejectSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    setBulkBusy(true);
    try {
      const result = await planningApi.sowImports.rejectSelected(activeImport.id, Array.from(selectedIds));
      setActiveImport(result.sow_import);
      setSelectedIds(new Set());
      await loadItems(activeImport.id);
    } catch {
      setActionError("Erro ao rejeitar itens.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleApproveItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.approve(item.id));
      if (activeImport) {
        const updated = await planningApi.sowImports.get(activeImport.id);
        setActiveImport(updated);
        await loadItems(activeImport.id);
        await loadSummary(activeImport.id);
      }
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || "Não foi possível aprovar.");
    }
  }

  async function handleRejectItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reject(item.id));
      if (activeImport) {
        const updated = await planningApi.sowImports.get(activeImport.id);
        setActiveImport(updated);
        await loadItems(activeImport.id);
      }
    } catch {
      setActionError("Não foi possível rejeitar.");
    }
  }

  async function handleReprocessItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reprocess(item.id));
      if (activeImport) await loadItems(activeImport.id);
    } catch {
      setActionError("Não foi possível reprocessar.");
    }
  }

  async function saveEdit(item: SowParsedItem) {
    if (!editForm) return;
    const payload = {
      suggested_cable_family: editForm.suggested_cable_family || null,
      suggested_cable_spec: editForm.suggested_cable_spec || null,
      suggested_network: editForm.suggested_network || null,
      suggested_workstream: editForm.suggested_workstream || null,
      suggested_paths: editForm.suggested_paths,
      quantity: editForm.quantity === "" ? null : editForm.quantity,
      unit: editForm.unit,
      length_type: editForm.length_type,
      length_m: editForm.length_m === "" ? null : editForm.length_m,
      medium: editForm.medium,
      preterminated: editForm.preterminated === "" ? null : editForm.preterminated === "true",
      color: editForm.color,
      fiber_count: editForm.fiber_count === "" ? null : editForm.fiber_count,
    };
    await planningApi.sowParsedItems.update(item.id, payload as never);
    setEditingId(null);
    setEditForm(null);
    if (activeImport) await loadItems(activeImport.id);
  }

  async function handleFinalize() {
    if (!activeImport) return;
    setActionError(null);
    setActionMessage(null);
    try {
      const updated = await planningApi.sowImports.finalize(activeImport.id);
      setActiveImport(updated);
      await loadSummary(updated.id);
      setActionMessage(`Importação finalizada. ${updated.total_items_approved} ScopeItem(ns) criado(s).`);
      setStep(3);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || "Ainda há itens pendentes de revisão.");
    }
  }

  // ---------- Passo 3 ----------

  async function handleResolveTemplates() {
    if (!activeImport) return;
    setActionError(null);
    setActionMessage(null);
    setBulkBusy(true);
    try {
      const result = await masterDataApi.scopeItems.resolveAll(activeImport.code);
      setActionMessage(
        `Resolução: ${result.resolved} resolvido(s), ${result.no_match} sem match, ${result.conflict} em conflito (de ${result.total} pendente(s)).`
      );
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || "Não foi possível resolver os templates.");
    } finally {
      setBulkBusy(false);
    }
  }

  // ---------- Passo 4 ----------

  async function handleGenerateTasks() {
    if (!activeImport) return;
    setActionError(null);
    setActionMessage(null);
    setBulkBusy(true);
    try {
      const result = await masterDataApi.scopeItems.generateTasksBulk(activeImport.code);
      setActionMessage(
        `${result.tasks_created} tarefa(s) gerada(s) para ${result.scope_items_processed} item(ns) de escopo.` +
          (result.tasks_existing > 0 ? ` (${result.tasks_existing} já existiam)` : "")
      );
      await loadSummary(activeImport.id);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setActionError(e.response?.data?.detail || "Não foi possível gerar as tarefas.");
    } finally {
      setBulkBusy(false);
    }
  }

  // ---------- Passo 5 ----------

  async function loadPlan() {
    if (!projectId || !activeImport) return;
    setPlanError(null);
    setPlanLoading(true);
    try {
      const data = await planningApi.projectPlan.get(Number(projectId), { sowImport: activeImport.code });
      setPlanData({ project_tasks_to_create: data.totals.project_tasks_to_create, project_tasks_existing: data.totals.project_tasks_existing });
      const tasksData = await projectTasksApi.list({ project: String(projectId), sow_import: activeImport.code });
      setProjectTasks(tasksData.results);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setPlanError(e.response?.data?.detail || "Não foi possível carregar o plano.");
    } finally {
      setPlanLoading(false);
    }
  }

  async function handleCreateTasks() {
    if (!projectId || !activeImport) return;
    setTaskCreating(true);
    setPlanError(null);
    try {
      const result = await planningApi.projectPlan.createTasks(Number(projectId), { sowImport: activeImport.code });
      setTaskCreateResult({ created_count: result.created_count, existing_count: result.existing_count });
      await loadPlan();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setPlanError(e.response?.data?.detail || "Não foi possível criar as tarefas.");
    } finally {
      setTaskCreating(false);
    }
  }

  async function handleAssign() {
    if (!projectId || selectedTaskIds.size === 0 || assignCollaboratorIds.length === 0) {
      setAssignMessage("Selecione ao menos uma tarefa e um técnico.");
      return;
    }
    setAssigning(true);
    setAssignMessage(null);
    try {
      const result = await projectsApi.tasksBulk(Number(projectId), {
        action: "update",
        task_ids: Array.from(selectedTaskIds),
        collaborator_ids: assignCollaboratorIds,
        planned_end: assignDeadline ? new Date(assignDeadline).toISOString() : null,
        priority: assignPriority || undefined,
      });
      setAssignMessage(`${result.updated ?? selectedTaskIds.size} tarefa(s) atribuída(s).`);
      setSelectedTaskIds(new Set());
      await loadPlan();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } } };
      setAssignMessage(e.response?.data?.detail || "Não foi possível atribuir.");
    } finally {
      setAssigning(false);
    }
  }

  // ---------- helpers de contagem ----------

  const pendingCount = items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).length;
  const approvedCount = items.filter((i) => i.active && i.review_status === "APPROVED").length;

  const selectedProject = projects.find((p) => p.id === projectId);

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="card" style={{ padding: 20 }}>
      {/* Cabeçalho */}
      <div className="toolbar" style={{ marginBottom: 8 }}>
        <div>
          <div className="toolbar-title">Novo Escopo de Projeto</div>
          <div className="toolbar-subtitle">
            Fluxo guiado: SOW → revisão → geração de tarefas → projeto
          </div>
        </div>
        {activeImport && (
          <div style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right" }}>
            <strong>{activeImport.code}</strong>
            {activeImport.title && <> — {activeImport.title}</>}
          </div>
        )}
      </div>

      <StepBar current={step} />

      {/* Mensagens globais */}
      {actionError && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 10, padding: "8px 12px", background: "var(--red-soft, #fff0f0)", borderRadius: 6 }}>
          {actionError}
        </div>
      )}
      {actionMessage && (
        <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 10, padding: "8px 12px", background: "var(--green-soft, #f0fff4)", borderRadius: 6 }}>
          ✓ {actionMessage}
        </div>
      )}

      {/* =====================================================================
          PASSO 1 — IMPORTAR SOW
      ===================================================================== */}
      {step === 1 && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            Cole o texto do SOW ou envie um arquivo. O parser vai propor os Itens de Escopo na próxima etapa para você revisar.
          </p>

          {createError && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{createError}</p>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
            <div className="field-group">
              <span className="field-label">Título (opcional)</span>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: GRU65 — Fase 2 — SOW v3" />
            </div>
            <div className="field-group">
              <span className="field-label">Tipo de origem</span>
              <select className="select" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
                {SOURCE_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Texto do SOW</span>
            <textarea
              className="input"
              rows={10}
              value={sourceText}
              onChange={(e) => setSourceText(e.target.value)}
              placeholder={"Uma linha por item, ex:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m"}
            />
          </div>

          <div className="field-group" style={{ marginBottom: 20 }}>
            <span className="field-label">Ou envie um arquivo</span>
            <input type="file" onChange={(e) => setSourceFile(e.target.files?.[0] || null)} />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn btn-primary" onClick={handleCreateAndProcess} disabled={creating}>
              {creating ? "Processando…" : "Processar SOW"}
              {!creating && <Icon name="arrow_forward" style={{ fontSize: 16, marginLeft: 6 }} />}
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          PASSO 2 — REVISAR ITENS PARSEADOS
      ===================================================================== */}
      {step === 2 && activeImport && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: 0 }}>
              {approvedCount} aprovado(s) · {pendingCount} pendente(s) de revisão de {items.length} itens detectados.
            </p>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn btn-outline btn-sm" onClick={selectAll}>Selecionar pendentes</button>
              <button className="btn btn-outline btn-sm" onClick={handleApproveSelected} disabled={bulkBusy || selectedIds.size === 0}>
                Aprovar selecionados ({selectedIds.size})
              </button>
              <button className="btn btn-outline btn-sm" onClick={handleRejectSelected} disabled={bulkBusy || selectedIds.size === 0}>
                Rejeitar selecionados ({selectedIds.size})
              </button>
            </div>
          </div>

          {loadingItems && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando itens…</p>}

          {!loadingItems && items.length > 0 && (
            <div className="table-wrap" style={{ marginBottom: 14 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        title="Selecionar todos os pendentes"
                        checked={
                          items.filter((i) => i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW").length > 0 &&
                          items.filter((i) => i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW").every((i) => selectedIds.has(i.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) selectAll();
                          else setSelectedIds(new Set());
                        }}
                      />
                    </th>
                    <th>Seq.</th>
                    <th>Texto Original</th>
                    <th>Família</th>
                    <th>Spec</th>
                    <th>Rede</th>
                    <th>WS</th>
                    <th>Qtd</th>
                    <th>Metragem</th>
                    <th>Confiança</th>
                    <th>Warnings</th>
                    <th>Revisão</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <Fragment key={item.id}>
                      <tr>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(item.id)}
                            disabled={item.review_status !== "PENDING" && item.review_status !== "NEEDS_REVIEW"}
                            onChange={() => toggleSelected(item.id)}
                          />
                        </td>
                        <td>{item.sequence}</td>
                        <td style={{ maxWidth: 240, fontSize: 12 }}>{item.raw_text}</td>
                        <td>{item.suggested_cable_family_code || "—"}</td>
                        <td>{item.suggested_cable_spec_code || "—"}</td>
                        <td>{item.suggested_network_code || "—"}</td>
                        <td>{item.suggested_workstream_code || "—"}</td>
                        <td>{item.quantity ?? "—"}</td>
                        <td>{item.length_m ? `${item.length_m}m` : "—"}</td>
                        <td style={{ color: confidenceColor(item.confidence_band) }}>{item.confidence_score ?? "—"}</td>
                        <td>
                          {item.warnings.map((w, i) => (
                            <div key={i} style={{ color: w.critical ? "var(--red)" : "var(--amber)", fontSize: 11 }}>⚠ {w.message}</div>
                          ))}
                        </td>
                        <td style={{ color: reviewStatusColor(item.review_status) }}>
                          {REVIEW_STATUS_LABELS[item.review_status] || item.review_status}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleApproveItem(item)}>✓</button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleRejectItem(item)}>✕</button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => (editingId === item.id ? setEditingId(null) : (setEditingId(item.id), setEditForm(editFormFromItem(item))))}>
                              <Icon name="edit" style={{ fontSize: 13 }} />
                            </button>
                            <button className="btn btn-outline btn-sm" disabled={busyIds.has(item.id) || item.review_status === "APPROVED"} onClick={() => handleReprocessItem(item)}>
                              <Icon name="refresh" style={{ fontSize: 13 }} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingId === item.id && editForm && (
                        <tr>
                          <td colSpan={13}>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, padding: 12, background: "var(--surface-2, #f7f7f8)", borderRadius: 8 }}>
                              <div className="field-group">
                                <span className="field-label">Família</span>
                                <select className="select" value={editForm.suggested_cable_family} onChange={(e) => setEditForm({ ...editForm, suggested_cable_family: e.target.value ? Number(e.target.value) : "" })}>
                                  <option value="">—</option>
                                  {refs.cableFamilies.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
                                </select>
                              </div>
                              <div className="field-group">
                                <span className="field-label">Spec</span>
                                <select className="select" value={editForm.suggested_cable_spec} onChange={(e) => setEditForm({ ...editForm, suggested_cable_spec: e.target.value ? Number(e.target.value) : "" })}>
                                  <option value="">—</option>
                                  {refs.cableSpecs.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
                                </select>
                              </div>
                              <div className="field-group">
                                <span className="field-label">Rede</span>
                                <select className="select" value={editForm.suggested_network} onChange={(e) => setEditForm({ ...editForm, suggested_network: e.target.value ? Number(e.target.value) : "" })}>
                                  <option value="">—</option>
                                  {refs.networks.map((n) => <option key={n.id} value={n.id}>{n.code}</option>)}
                                </select>
                              </div>
                              <div className="field-group">
                                <span className="field-label">Workstream</span>
                                <select className="select" value={editForm.suggested_workstream} onChange={(e) => setEditForm({ ...editForm, suggested_workstream: e.target.value ? Number(e.target.value) : "" })}>
                                  <option value="">—</option>
                                  {refs.workstreams.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
                                </select>
                              </div>
                              <div className="field-group">
                                <span className="field-label">Quantidade</span>
                                <input className="input" type="number" value={editForm.quantity} onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value ? Number(e.target.value) : "" })} />
                              </div>
                              <div className="field-group">
                                <span className="field-label">Metragem (m)</span>
                                <input className="input" type="number" value={editForm.length_m} onChange={(e) => setEditForm({ ...editForm, length_m: e.target.value ? Number(e.target.value) : "" })} />
                              </div>
                              <div className="field-group">
                                <span className="field-label">Meio</span>
                                <select className="select" value={editForm.medium} onChange={(e) => setEditForm({ ...editForm, medium: e.target.value })}>
                                  <option value="">—</option>
                                  <option value="FIBER">FIBER</option>
                                  <option value="COPPER">COPPER</option>
                                </select>
                              </div>
                              <div className="field-group">
                                <span className="field-label">Pré-terminado</span>
                                <select className="select" value={editForm.preterminated} onChange={(e) => setEditForm({ ...editForm, preterminated: e.target.value })}>
                                  <option value="">Não informado</option>
                                  <option value="true">Sim</option>
                                  <option value="false">Não</option>
                                </select>
                              </div>
                              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                                <button className="btn btn-primary btn-sm" onClick={() => saveEdit(item)}>Salvar</button>
                                <button className="btn btn-outline btn-sm" onClick={() => setEditingId(null)}>Cancelar</button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setStep(1)}>
              <Icon name="arrow_back" style={{ fontSize: 16, marginRight: 6 }} />Voltar
            </button>
            <button className="btn btn-primary" onClick={handleFinalize} disabled={pendingCount > 0}>
              Finalizar revisão e continuar
              <Icon name="arrow_forward" style={{ fontSize: 16, marginLeft: 6 }} />
            </button>
          </div>
          {pendingCount > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>
              {pendingCount} item(ns) ainda pendente(s) — aprove ou rejeite todos para continuar.
            </p>
          )}
        </div>
      )}

      {/* =====================================================================
          PASSO 3 — RESOLVER TEMPLATES
      ===================================================================== */}
      {step === 3 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            O motor de regras vai identificar qual Template de Tarefa corresponde a cada Item de Escopo. Itens sem match precisarão de revisão manual nos Cadastros Mestres antes de prosseguir.
          </p>

          {summaryLoading && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando resumo…</p>}

          {!summaryLoading && summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "ScopeItems criados", value: summary.scope_items_created },
                { label: "Templates resolvidos", value: summary.templates_resolved, color: summary.templates_resolved > 0 ? "var(--green)" : undefined },
                { label: "Aguardando resolução", value: summary.items_awaiting_resolution, color: summary.items_awaiting_resolution > 0 ? "var(--amber)" : undefined },
              ].map((tile) => (
                <div key={tile.label} style={{ padding: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: tile.color || "var(--text)" }}>{tile.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{tile.label}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(2)}>
              <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />Voltar
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {summary?.items_awaiting_resolution === 0 && (summary?.templates_resolved ?? 0) > 0 && (
                <span style={{ fontSize: 12, color: "var(--green)" }}>✓ Todos os templates resolvidos</span>
              )}
              <button className="btn btn-outline btn-sm" onClick={handleResolveTemplates} disabled={bulkBusy || (summary?.items_awaiting_resolution === 0 && (summary?.templates_resolved ?? 0) > 0)}>
                {bulkBusy ? "Resolvendo…" : "Resolver Templates"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setActionError(null); setActionMessage(null); setStep(4); }} disabled={(summary?.templates_resolved ?? 0) === 0}>
                Continuar para geração de tarefas
                <Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            </div>
          </div>
          {(summary?.templates_resolved ?? 0) === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>
              Resolva ao menos 1 template para continuar.
            </p>
          )}
        </div>
      )}

      {/* =====================================================================
          PASSO 4 — GERAR TAREFAS
      ===================================================================== */}
      {step === 4 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            Gere as Tarefas Operacionais a partir dos Itens de Escopo com template resolvido. Cada tarefa fica com status <em>Pendente</em> até ser atribuída no próximo passo.
          </p>

          {!summaryLoading && summary && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
              {[
                { label: "Templates resolvidos", value: summary.templates_resolved, color: "var(--green)" },
                { label: "Tarefas já geradas", value: summary.tasks_generated, color: summary.tasks_generated > 0 ? "var(--green)" : undefined },
                { label: "Aguardando resolução", value: summary.items_awaiting_resolution, color: summary.items_awaiting_resolution > 0 ? "var(--amber)" : undefined },
              ].map((tile) => (
                <div key={tile.label} style={{ padding: 14, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, textAlign: "center" }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: tile.color || "var(--text)" }}>{tile.value}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{tile.label}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
            <button className="btn btn-outline btn-sm" onClick={() => setStep(3)}>
              <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />Voltar
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {(summary?.tasks_generated ?? 0) > 0 && !bulkBusy && (
                <span style={{ fontSize: 12, color: "var(--green)" }}>
                  ✓ {summary!.tasks_generated} tarefa(s) gerada(s)
                </span>
              )}
              <button className="btn btn-outline btn-sm" onClick={handleGenerateTasks} disabled={bulkBusy || (summary?.templates_resolved ?? 0) === 0}>
                {bulkBusy ? "Gerando…" : "Gerar Tarefas"}
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => { setActionError(null); setActionMessage(null); setStep(5); }} disabled={(summary?.tasks_generated ?? 0) === 0}>
                Continuar para envio ao projeto
                <Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            </div>
          </div>
          {(summary?.tasks_generated ?? 0) === 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "right", marginTop: 4 }}>
              Gere ao menos 1 tarefa para habilitar o próximo passo.
            </p>
          )}
        </div>
      )}

      {/* =====================================================================
          PASSO 5 — ENVIAR AO PROJETO
      ===================================================================== */}
      {step === 5 && activeImport && (
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
            Selecione o projeto de destino e crie as tarefas. Depois atribua a equipe técnica responsável.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, marginBottom: 14, alignItems: "flex-end" }}>
            <div className="field-group">
              <span className="field-label">Projeto de destino</span>
              <select className="select" value={projectId} onChange={(e) => { setProjectId(e.target.value ? Number(e.target.value) : ""); setPlanData(null); setTaskCreateResult(null); }}>
                <option value="">Selecione o projeto…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
            <button className="btn btn-outline" onClick={loadPlan} disabled={!projectId || planLoading}>
              {planLoading ? "Carregando…" : "Verificar"}
            </button>
            <button className="btn btn-primary" onClick={handleCreateTasks} disabled={!projectId || taskCreating || (planData?.project_tasks_to_create === 0 && taskCreateResult !== null)}>
              {taskCreating ? "Criando…" : "Criar Tarefas no Projeto"}
            </button>
          </div>

          {planError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{planError}</p>}

          {planData && (
            <div style={{ padding: 12, background: "var(--surface-2, #f7f7f8)", borderRadius: 8, fontSize: 13, marginBottom: 14, lineHeight: 1.8 }}>
              <div>Tarefas a criar: <strong>{planData.project_tasks_to_create}</strong></div>
              <div>Tarefas já existentes: <strong>{planData.project_tasks_existing}</strong></div>
            </div>
          )}

          {taskCreateResult && (
            <div style={{ color: "var(--green)", fontSize: 13, marginBottom: 14 }}>
              ✓ {taskCreateResult.created_count} tarefa(s) criada(s) no projeto ({taskCreateResult.existing_count} já existiam).
              {selectedProject && (
                <Link className="btn btn-outline btn-sm" to={`/projetos/${selectedProject.id}`} style={{ marginLeft: 10 }}>
                  Abrir projeto
                </Link>
              )}
            </div>
          )}

          {/* Atribuição de equipe */}
          {projectTasks.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Atribuir Equipe</div>
              <div className="table-wrap" style={{ marginBottom: 10 }}>
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
                    {projectTasks.map((t) => (
                      <tr key={t.id}>
                        <td><input type="checkbox" checked={selectedTaskIds.has(t.id)} onChange={() => { setSelectedTaskIds((prev) => { const next = new Set(prev); next.has(t.id) ? next.delete(t.id) : next.add(t.id); return next; }); }} /></td>
                        <td>{t.task_name}</td>
                        <td>{t.activity_code || "—"}</td>
                        <td>{t.path_code || "—"}</td>
                        <td>{t.quantity_planned ?? "—"} {t.unit}</td>
                        <td>{t.status_display}</td>
                        <td>{t.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "flex-end" }}>
                <div className="field-group">
                  <span className="field-label">Técnico(s)</span>
                  <select className="select" multiple value={assignCollaboratorIds.map(String)} onChange={(e) => setAssignCollaboratorIds(Array.from(e.target.selectedOptions).map((o) => Number(o.value)))}>
                    {collaborators.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                    {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
                </div>
                <button className="btn btn-primary btn-sm" onClick={handleAssign} disabled={assigning}>
                  <Icon name="person_add" style={{ fontSize: 14 }} />
                  {assigning ? "Atribuindo…" : `Atribuir (${selectedTaskIds.size})`}
                </button>
              </div>
              {assignMessage && <p style={{ fontSize: 13, marginTop: 8 }}>{assignMessage}</p>}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => setStep(4)}>
              <Icon name="arrow_back" style={{ fontSize: 16, marginRight: 6 }} />Voltar
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              {selectedProject && (
                <Link className="btn btn-outline" to={`/projetos/${selectedProject.id}`}>
                  <Icon name="open_in_new" style={{ fontSize: 16, marginRight: 6 }} />Abrir Projeto
                </Link>
              )}
              <button className="btn btn-primary" onClick={() => {
                setStep(1);
                setTitle(""); setSourceType("TEXT"); setSourceText(""); setSourceFile(null); setCreateError(null);
                setActiveImport(null); setItems([]); setSummary(null);
                setProjectId(""); setPlanData(null); setTaskCreateResult(null); setProjectTasks([]);
                setActionError(null); setActionMessage(null);
              }}>
                <Icon name="add" style={{ fontSize: 16, marginRight: 6 }} />Nova Importação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
