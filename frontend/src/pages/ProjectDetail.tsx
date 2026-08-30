import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  projectAttachmentsApi,
  projectItemsApi,
  projectOccurrencesApi,
  projectsApi,
  projectTasksApi,
  rackPositionsApi,
  registryApi,
  workBlocksApi,
} from "../api/resources";
import type {
  ActivityType,
  CollaboratorFull,
  CollaboratorHours,
  PlanningSummaryRow,
  Project,
  ProjectAttachment,
  ProjectItem,
  ProjectItemType,
  ProjectOccurrence,
  ProjectTask,
  RackPosition,
  WorkBlock,
} from "../api/types";
import PlanningBlockSection from "../components/projects/PlanningBlockSection";
import ProjectItemFormModal from "../components/projects/ProjectItemFormModal";
import ProjectOccurrenceFormModal from "../components/projects/ProjectOccurrenceFormModal";
import ProjectTaskFormModal from "../components/projects/ProjectTaskFormModal";
import RackPositionBulkModal from "../components/projects/RackPositionBulkModal";
import RackPositionFormModal from "../components/projects/RackPositionFormModal";
import TasksBulkUpdatePanel from "../components/projects/TasksBulkUpdatePanel";
import TasksCatalogAddModal from "../components/projects/TasksCatalogAddModal";
import WorkBlockFormModal from "../components/projects/WorkBlockFormModal";
import BulkNamesModal from "../components/ui/BulkNamesModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import PlannedVsExecutedBar from "../components/ui/PlannedVsExecutedBar";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasPerm } from "../utils/permissions";

type DetailTab = "tasks" | "hours" | "occurrences" | "attachments" | "planning";

const TASK_STATUS_OPTIONS = [
  { value: "not_started", label: "Não Iniciada" },
  { value: "in_progress", label: "Em Andamento" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluída" },
  { value: "canceled", label: "Cancelada" },
];

const SEVERITY_TONE: Record<string, { bg: string; color: string }> = {
  low: { bg: "var(--bg)", color: "var(--text-muted)" },
  medium: { bg: "var(--blue-soft)", color: "var(--blue)" },
  high: { bg: "var(--amber-soft)", color: "var(--amber)" },
  critical: { bg: "var(--red-soft)", color: "var(--red)" },
};

export default function ProjectDetail() {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [rackPositions, setRackPositions] = useState<RackPosition[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>(
    (location.state as { tab?: DetailTab } | null)?.tab ?? "tasks"
  );
  const [tasksOpen, setTasksOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);

  const [rackFormOpen, setRackFormOpen] = useState(false);
  const [rackBulkOpen, setRackBulkOpen] = useState(false);
  const [editingRack, setEditingRack] = useState<RackPosition | null>(null);

  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskCatalogOpen, setTaskCatalogOpen] = useState(false);
  const [customTasksOpen, setCustomTasksOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [importingTasks, setImportingTasks] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [taskStatusFilter, setTaskStatusFilter] = useState("");
  const [taskSortMode, setTaskSortMode] = useState<"default" | "item" | "status">("default");

  const [workBlocks, setWorkBlocks] = useState<WorkBlock[]>([]);
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [planningSummary, setPlanningSummary] = useState<PlanningSummaryRow[]>([]);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [openBlocks, setOpenBlocks] = useState<Record<number, boolean>>({});
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [itemTypes, setItemTypes] = useState<ProjectItemType[]>([]);
  const [selectedItemTaskIds, setSelectedItemTaskIds] = useState<number[]>([]);
  const [workBlockFormOpen, setWorkBlockFormOpen] = useState(false);
  const [editingWorkBlock, setEditingWorkBlock] = useState<WorkBlock | null>(null);
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ProjectItem | null>(null);
  const [planningTaskFormOpen, setPlanningTaskFormOpen] = useState(false);
  const [newTaskForItem, setNewTaskForItem] = useState<ProjectItem | null>(null);

  const [hours, setHours] = useState<CollaboratorHours[]>([]);
  const [hoursLoading, setHoursLoading] = useState(false);

  const [occurrences, setOccurrences] = useState<ProjectOccurrence[]>([]);
  const [occurrencesLoading, setOccurrencesLoading] = useState(false);
  const [occurrenceFormOpen, setOccurrenceFormOpen] = useState(false);
  const [editingOccurrence, setEditingOccurrence] = useState<ProjectOccurrence | null>(null);

  const [attachments, setAttachments] = useState<ProjectAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentDescription, setAttachmentDescription] = useState("");
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const canAddRack = hasPerm(user, PERMS.addRackPosition);
  const canChangeRack = hasPerm(user, PERMS.changeRackPosition);
  const canDeleteRack = hasPerm(user, PERMS.deleteRackPosition);
  const canAddTask = hasPerm(user, PERMS.addProjectTask);
  const canChangeTask = hasPerm(user, PERMS.changeProjectTask);
  const canDeleteTask = hasPerm(user, PERMS.deleteProjectTask);
  const canAddWorkBlock = hasPerm(user, PERMS.addWorkBlock);
  const canImportScope = hasPerm(user, PERMS.addScopeImport);
  const canAddOccurrence = hasPerm(user, PERMS.addProjectOccurrence);
  const canChangeOccurrence = hasPerm(user, PERMS.changeProjectOccurrence);
  const canDeleteOccurrence = hasPerm(user, PERMS.deleteProjectOccurrence);
  const canAddAttachment = hasPerm(user, PERMS.addProjectAttachment);
  const canDeleteAttachment = hasPerm(user, PERMS.deleteProjectAttachment);

  const mountedRef = useRef(true);

  function reload() {
    if (!projectId) return;
    setLoading(true);
    Promise.all([projectsApi.get(projectId), projectsApi.tasks(projectId)])
      .then(([projectData, taskData]) => {
        if (!mountedRef.current) return;
        setProject(projectData);
        setTasks(taskData);
        if (projectData.has_rack_positions) {
          rackPositionsApi.list(projectId).then((r) => {
            if (mountedRef.current) setRackPositions(r.results);
          });
        } else {
          setRackPositions([]);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }

  function reloadPlanning() {
    if (!projectId) return;
    setPlanningLoading(true);
    Promise.all([projectsApi.workBlocks(projectId), projectsApi.items(projectId), projectsApi.planningSummary(projectId)])
      .then(([blockData, itemData, summaryData]) => {
        if (!mountedRef.current) return;
        setWorkBlocks(blockData);
        setItems(itemData);
        setPlanningSummary(summaryData);
      })
      .finally(() => {
        if (mountedRef.current) setPlanningLoading(false);
      });
  }

  function handleGenerateFromRule(item: ProjectItem) {
    projectItemsApi
      .generateTasks(item.id)
      .then((res) => {
        if (res.created === 0) {
          alert("Nenhuma tarefa nova gerada — ou já existem todas as etapas da regra pra esse item, ou não há regra cadastrada pra essa tecnologia.");
        }
        reload();
        reloadPlanning();
      })
      .catch((err: unknown) => {
        const axiosErr = err as { response?: { data?: { detail?: string } } };
        alert(axiosErr.response?.data?.detail || "Não foi possível gerar as tarefas pela regra.");
      });
  }

  function reloadHours() {
    if (!projectId) return;
    setHoursLoading(true);
    projectsApi
      .hoursByCollaborator(projectId)
      .then((data) => {
        if (mountedRef.current) setHours(data);
      })
      .finally(() => {
        if (mountedRef.current) setHoursLoading(false);
      });
  }

  function reloadOccurrences() {
    if (!projectId) return;
    setOccurrencesLoading(true);
    projectOccurrencesApi
      .list(projectId)
      .then((data) => {
        if (mountedRef.current) setOccurrences(data.results);
      })
      .finally(() => {
        if (mountedRef.current) setOccurrencesLoading(false);
      });
  }

  function reloadAttachments() {
    if (!projectId) return;
    setAttachmentsLoading(true);
    projectAttachmentsApi
      .list(projectId)
      .then((data) => {
        if (mountedRef.current) setAttachments(data.results);
      })
      .finally(() => {
        if (mountedRef.current) setAttachmentsLoading(false);
      });
  }

  useEffect(() => {
    mountedRef.current = true;
    reload();
    registryApi.collaborators.list({ page_size: "500" } as never).then((r) => {
      if (mountedRef.current) setCollaborators(r.results);
    });
    registryApi.activityTypes.list({ page_size: "500", is_active: "true" } as never).then((r) => {
      if (mountedRef.current) setActivityTypes(r.results);
    });
    registryApi.projectItemTypes.list({ page_size: "500", is_active: "true" } as never).then((r) => {
      if (mountedRef.current) setItemTypes(r.results);
    });
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (activeTab === "hours" && hours.length === 0 && !hoursLoading) reloadHours();
    if (activeTab === "occurrences" && occurrences.length === 0 && !occurrencesLoading) reloadOccurrences();
    if (activeTab === "attachments" && attachments.length === 0 && !attachmentsLoading) reloadAttachments();
    if (activeTab === "planning" && workBlocks.length === 0 && !planningLoading) reloadPlanning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, projectId]);

  function closeRackModals() {
    setRackFormOpen(false);
    setRackBulkOpen(false);
    setEditingRack(null);
  }

  function handleRackSaved() {
    closeRackModals();
    reload();
  }

  async function handleDeleteRack(rp: RackPosition) {
    if (!confirm(`Excluir o Rack Position "${rp.position}"?`)) return;
    await rackPositionsApi.remove(rp.id);
    reload();
  }

  function closeTaskModals() {
    setTaskFormOpen(false);
    setTaskCatalogOpen(false);
    setCustomTasksOpen(false);
    setEditingTask(null);
  }

  function handleTaskSaved() {
    closeTaskModals();
    reload();
  }

  async function handleDeleteTask(task: ProjectTask) {
    if (!confirm(`Excluir a tarefa "${task.task_name}" do projeto?`)) return;
    await projectTasksApi.remove(task.id);
    setSelectedTaskIds((prev) => prev.filter((id) => id !== task.id));
    reload();
  }

  function closeWorkBlockModal() {
    setWorkBlockFormOpen(false);
    setEditingWorkBlock(null);
  }

  function handleWorkBlockSaved() {
    closeWorkBlockModal();
    reloadPlanning();
  }

  function closeItemModal() {
    setItemFormOpen(false);
    setEditingItem(null);
  }

  function handleItemSaved() {
    closeItemModal();
    reloadPlanning();
  }

  function closePlanningTaskModal() {
    setPlanningTaskFormOpen(false);
    setNewTaskForItem(null);
  }

  function handlePlanningTaskSaved() {
    closePlanningTaskModal();
    reload();
    reloadPlanning();
  }

  function toggleItemTaskSelection(taskId: number) {
    setSelectedItemTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  }

  function closeOccurrenceModal() {
    setOccurrenceFormOpen(false);
    setEditingOccurrence(null);
  }

  function handleOccurrenceSaved() {
    closeOccurrenceModal();
    reloadOccurrences();
  }

  async function handleDeleteOccurrence(occurrence: ProjectOccurrence) {
    if (!confirm(`Excluir a ocorrência "${occurrence.title}"?`)) return;
    await projectOccurrencesApi.remove(occurrence.id);
    reloadOccurrences();
  }

  async function handleUploadAttachment() {
    if (!attachmentFile || !projectId) return;
    setUploadingAttachment(true);
    try {
      await projectAttachmentsApi.upload(projectId, attachmentFile, attachmentDescription);
      setAttachmentFile(null);
      setAttachmentDescription("");
      const fileInput = document.getElementById("attachment-file-input") as HTMLInputElement | null;
      if (fileInput) fileInput.value = "";
      reloadAttachments();
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleDeleteAttachment(attachment: ProjectAttachment) {
    if (!confirm(`Excluir o anexo "${attachment.file_name}"?`)) return;
    await projectAttachmentsApi.remove(attachment.id);
    reloadAttachments();
  }

  function handleDownloadAttachment(attachment: ProjectAttachment) {
    downloadAuthenticatedFile(projectAttachmentsApi.downloadUrl(attachment.id), attachment.file_name);
  }

  function formatFileSize(bytes: number | null) {
    if (bytes === null) return "—";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function handleImportFromProjectType() {
    if (!project) return;
    setImportingTasks(true);
    try {
      const result = await projectsApi.importTasks(project.id);
      if (result.created) {
        alert(`${result.created} Tarefa(s) do Tipo de Projeto adicionada(s) com sucesso.`);
      } else {
        alert("Nenhuma nova Tarefa foi adicionada. Verifique os vínculos do Tipo de Projeto ou as tarefas já existentes.");
      }
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      alert(axiosErr.response?.data?.detail || "Não foi possível importar as tarefas.");
    } finally {
      setImportingTasks(false);
    }
  }

  function toggleTaskSelection(taskId: number) {
    setSelectedTaskIds((prev) => (prev.includes(taskId) ? prev.filter((id) => id !== taskId) : [...prev, taskId]));
  }

  function toggleSelectAll() {
    setSelectedTaskIds((prev) => (prev.length === filteredTasks.length ? [] : filteredTasks.map((t) => t.id)));
  }

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    return tasks.filter((t) => {
      if (taskStatusFilter && t.status !== taskStatusFilter) return false;
      if (query && !t.task_name.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [tasks, taskSearch, taskStatusFilter]);

  const taskGroups = useMemo(() => {
    if (taskSortMode === "default") return null;
    if (taskSortMode === "status") {
      const order = TASK_STATUS_OPTIONS.map((o) => o.value);
      return order
        .map((status) => ({
          key: status,
          label: TASK_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status,
          tasks: filteredTasks.filter((t) => t.status === status),
        }))
        .filter((group) => group.tasks.length > 0);
    }
    // "item": uma seção por Item do Projeto (project_item), reunindo as
    // tarefas geradas pra ele (ex: várias atividades num mesmo item
    // importado por escopo); tarefas sem item caem num balde único.
    const byItem = new Map<number, ProjectTask[]>();
    const withoutItem: ProjectTask[] = [];
    filteredTasks.forEach((t) => {
      if (t.project_item == null) {
        withoutItem.push(t);
        return;
      }
      const list = byItem.get(t.project_item) ?? [];
      list.push(t);
      byItem.set(t.project_item, list);
    });
    const groups = Array.from(byItem.entries()).map(([itemId, itemTasks]) => {
      const label = itemTasks[0].task_name.includes(" - ")
        ? itemTasks[0].task_name.split(" - ").slice(1).join(" - ")
        : `Item #${itemId}`;
      return { key: `item-${itemId}`, label, tasks: itemTasks };
    });
    groups.sort((a, b) => a.label.localeCompare(b.label));
    if (withoutItem.length > 0) groups.push({ key: "sem-item", label: "Sem Item", tasks: withoutItem });
    return groups;
  }, [filteredTasks, taskSortMode]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;
  if (!project) return <p style={{ color: "var(--text-muted)" }}>Projeto não encontrado.</p>;

  const taskColumnCount = 3 + (canChangeTask || canDeleteTask ? 2 : 0) + (project.has_rack_positions ? 1 : 0);

  function renderTaskRow(task: ProjectTask) {
    return (
      <tr key={task.id}>
        {(canChangeTask || canDeleteTask) && (
          <td>
            <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} />
          </td>
        )}
        <td>{task.task_name}</td>
        {project!.has_rack_positions && <td>{task.rack_position_labels.join(", ") || "—"}</td>}
        <td>
          <StatusBadge status={task.status} label={task.status_display} />
        </td>
        <td>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
        {(canChangeTask || canDeleteTask) && (
          <td>
            <div style={{ display: "flex", gap: 8 }}>
              {canChangeTask && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    setEditingTask(task);
                    setTaskFormOpen(true);
                  }}
                >
                  <Icon name="edit" style={{ fontSize: 14 }} />
                </button>
              )}
              {canDeleteTask && (
                <button className="btn btn-outline btn-sm" onClick={() => handleDeleteTask(task)} style={{ color: "var(--red)" }}>
                  <Icon name="delete" style={{ fontSize: 14 }} />
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
    );
  }

  return (
    <div>
      <Link to="/projetos" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", fontSize: 13, marginBottom: 12 }}>
        <Icon name="arrow_back" style={{ fontSize: 16 }} />
        Voltar para Projetos
      </Link>

      <PageHeader
        eyebrow={project.code}
        title={project.name}
        subtitle={undefined}
        actions={<StatusBadge status={project.status} label={project.status_display} />}
      />

      <div className="card" style={{ padding: "14px 20px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Progresso geral
            </span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {project.progress_percent}% · {project.completed_tasks} / {project.total_tasks} tarefas
            </span>
          </div>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{project.worked_hours}h trabalhadas</span>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: "var(--bg)", overflow: "hidden" }}>
          <div style={{ width: `${project.progress_percent}%`, height: "100%", background: "var(--orange)" }} />
        </div>
      </div>

      <div className="project-overview-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24, alignItems: "start" }}>
        <OverviewPanel icon="description" title="Geral">
          <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <PanelField label="PO" value={project.po || "—"} />
            <PanelField label="Cliente" value={project.client_name || "—"} />
            <PanelField label="Site" value={project.site_name || "—"} />
            <PanelField label="Categoria" value={project.category_name || "Sem categoria"} />
          </div>
        </OverviewPanel>

        <OverviewPanel icon="groups" title="Responsáveis">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <PanelField label="Responsável CSTR" value={project.responsible_cstr_name || "—"} />
            <PanelField label="Responsável Cliente" value={project.responsible_client_name || "—"} />
          </div>
        </OverviewPanel>

        <OverviewPanel icon="calendar_month" title="Cronograma">
          <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <PanelField
              label="Status"
              value={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block" }} />
                  {project.status_display}
                </span>
              }
            />
            <PanelField label="Data Início" value={formatDate(project.actual_start || project.planned_start)} />
            <PanelField label="Prazo Previsto" value={formatDate(project.planned_end)} />
            <PanelField label="Data Término" value={formatDate(project.actual_end)} />
          </div>
        </OverviewPanel>

        <OverviewPanel icon="bar_chart" title="Indicadores">
          <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <PanelField label="Quantidade de Links" value={String(project.link_count)} />
            <PanelField label="Horas Trabalhadas" value={`${project.worked_hours}h`} />
            <PanelField label="Tarefas" value={`${project.completed_tasks} / ${project.total_tasks}`} />
            <PanelField label="Progresso" value={`${project.progress_percent}%`} />
          </div>
        </OverviewPanel>
      </div>

      {project.description && (
        <div className="card" style={{ padding: 0, marginBottom: 24, overflow: "hidden" }}>
          <button
            onClick={() => setDescriptionOpen((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "12px 16px",
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Icon name={descriptionOpen ? "expand_less" : "expand_more"} style={{ fontSize: 18, color: "var(--text-faint)" }} />
            <Icon name="description" style={{ fontSize: 15, color: "var(--orange)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
              Descrição
            </span>
          </button>
          {descriptionOpen && (
            <div style={{ padding: "0 16px 16px", fontSize: 13.5, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {project.description}
            </div>
          )}
        </div>
      )}

      {project.has_rack_positions && (
        <>
          <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Rack Positions</h2>
            <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canAddRack && (
                <>
                  <button className="btn btn-outline btn-sm" onClick={() => setRackBulkOpen(true)}>
                    <Icon name="playlist_add" style={{ fontSize: 15 }} />
                    Importar em massa
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => setRackFormOpen(true)}>
                    <Icon name="add" style={{ fontSize: 15 }} />
                    Adicionar
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rack Position</th>
                    <th>DH</th>
                    <th>Links</th>
                    <th>UTP</th>
                    {(canChangeRack || canDeleteRack) && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {rackPositions.map((rp) => (
                    <tr key={rp.id}>
                      <td>{rp.position}</td>
                      <td>{rp.dh || "—"}</td>
                      <td>{rp.links}</td>
                      <td>{rp.utp}</td>
                      {(canChangeRack || canDeleteRack) && (
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            {canChangeRack && (
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => {
                                  setEditingRack(rp);
                                  setRackFormOpen(true);
                                }}
                              >
                                <Icon name="edit" style={{ fontSize: 14 }} />
                              </button>
                            )}
                            {canDeleteRack && (
                              <button className="btn btn-outline btn-sm" onClick={() => handleDeleteRack(rp)} style={{ color: "var(--red)" }}>
                                <Icon name="delete" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {rackPositions.length === 0 && (
                    <tr>
                      <td colSpan={5}>
                        <div className="table-empty">Nenhuma Rack Position cadastrada ainda.</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab-btn${activeTab === "tasks" ? " active" : ""}`} onClick={() => setActiveTab("tasks")}>
          Tarefas
        </button>
        <button className={`tab-btn${activeTab === "hours" ? " active" : ""}`} onClick={() => setActiveTab("hours")}>
          Horas Trabalhadas
        </button>
        <button className={`tab-btn${activeTab === "occurrences" ? " active" : ""}`} onClick={() => setActiveTab("occurrences")}>
          Ocorrências
        </button>
        <button className={`tab-btn${activeTab === "attachments" ? " active" : ""}`} onClick={() => setActiveTab("attachments")}>
          Anexos
        </button>
        <button className={`tab-btn${activeTab === "planning" ? " active" : ""}`} onClick={() => setActiveTab("planning")}>
          Planejamento
        </button>
      </div>

      {activeTab === "tasks" && (
        <>
          <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <button
              onClick={() => setTasksOpen((v) => !v)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0 }}
            >
              <Icon name={tasksOpen ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
              <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Tarefas</h2>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>
                ({project.completed_tasks} / {project.total_tasks})
              </span>
            </button>
            {canAddTask && (
              <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {project.project_type && (
                  <button className="btn btn-outline btn-sm" onClick={handleImportFromProjectType} disabled={importingTasks}>
                    <Icon name="library_add" style={{ fontSize: 15 }} />
                    {importingTasks ? "Importando..." : "Importar do Tipo de Projeto"}
                  </button>
                )}
                <button className="btn btn-outline btn-sm" onClick={() => setTaskCatalogOpen(true)}>
                  <Icon name="playlist_add" style={{ fontSize: 15 }} />
                  Adicionar do Catálogo
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setCustomTasksOpen(true)}>
                  <Icon name="edit_note" style={{ fontSize: 15 }} />
                  Adicionar Avulsas
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => setTaskFormOpen(true)}>
                  <Icon name="add" style={{ fontSize: 15 }} />
                  Nova Tarefa
                </button>
              </div>
            )}
          </div>

          {tasksOpen && (
            <>
              {selectedTaskIds.length > 0 && (canChangeTask || canDeleteTask) && (
                <TasksBulkUpdatePanel
                  project={project}
                  selectedIds={selectedTaskIds}
                  collaborators={collaborators}
                  rackPositions={rackPositions}
                  onClear={() => setSelectedTaskIds([])}
                  onApplied={() => {
                    setSelectedTaskIds([]);
                    reload();
                  }}
                />
              )}

              <div className="filter-row" style={{ marginBottom: 12 }}>
                <div className="field-group" style={{ flex: 1, minWidth: 220 }}>
                  <span className="field-label">Buscar</span>
                  <div className="search-input-wrap">
                    <Icon name="search" />
                    <input
                      className="input"
                      placeholder="Buscar por nome da tarefa..."
                      value={taskSearch}
                      onChange={(e) => setTaskSearch(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field-group">
                  <span className="field-label">Status</span>
                  <select className="select" value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)}>
                    <option value="">Todos</option>
                    {TASK_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <span className="field-label">Organizar por</span>
                  <select className="select" value={taskSortMode} onChange={(e) => setTaskSortMode(e.target.value as typeof taskSortMode)}>
                    <option value="default">Padrão</option>
                    <option value="item">Agrupar por Item</option>
                    <option value="status">Agrupar por Status</option>
                  </select>
                </div>
              </div>

              <div className="card">
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        {(canChangeTask || canDeleteTask) && (
                          <th style={{ width: 32 }}>
                            <input type="checkbox" checked={filteredTasks.length > 0 && selectedTaskIds.length === filteredTasks.length} onChange={toggleSelectAll} />
                          </th>
                        )}
                        <th>Tarefa</th>
                        {project.has_rack_positions && <th>Rack Position</th>}
                        <th>Status</th>
                        <th>Técnicos</th>
                        {(canChangeTask || canDeleteTask) && <th>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {taskGroups
                        ? taskGroups.map((group) => (
                            <Fragment key={group.key}>
                              <tr>
                                <td colSpan={taskColumnCount} style={{ background: "var(--bg)", fontWeight: 700, fontSize: 12.5 }}>
                                  {group.label} <span style={{ fontWeight: 500, color: "var(--text-faint)" }}>({group.tasks.length})</span>
                                </td>
                              </tr>
                              {group.tasks.map(renderTaskRow)}
                            </Fragment>
                          ))
                        : filteredTasks.map(renderTaskRow)}
                      {filteredTasks.length === 0 && (
                        <tr>
                          <td colSpan={taskColumnCount}>
                            <div className="table-empty">
                              {tasks.length === 0 ? "Nenhuma tarefa cadastrada." : "Nenhuma tarefa encontrada com esse filtro."}
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {activeTab === "hours" && (
        <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>Por Técnico</h2>
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Técnico</th>
                      <th>Horas Trabalhadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hours.map((item) => (
                      <tr key={item.collaborator_id}>
                        <td>{item.collaborator_name}</td>
                        <td>{item.hours}h</td>
                      </tr>
                    ))}
                    {!hoursLoading && hours.length === 0 && (
                      <tr>
                        <td colSpan={2}>
                          <div className="table-empty">Nenhuma hora registrada ainda.</div>
                        </td>
                      </tr>
                    )}
                    {hoursLoading && (
                      <tr>
                        <td colSpan={2}>
                          <div className="table-empty">Carregando...</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>Por Tarefa</h2>
            <div className="card">
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Tarefa</th>
                      <th>Horas Trabalhadas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
                      <tr key={task.id}>
                        <td>{task.task_name}</td>
                        <td>{task.worked_hours}h</td>
                      </tr>
                    ))}
                    {tasks.length === 0 && (
                      <tr>
                        <td colSpan={2}>
                          <div className="table-empty">Nenhuma tarefa cadastrada.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "occurrences" && (
        <>
          <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Ocorrências</h2>
            {canAddOccurrence && (
              <button className="btn btn-primary btn-sm" onClick={() => setOccurrenceFormOpen(true)}>
                <Icon name="add" style={{ fontSize: 15 }} />
                Nova Ocorrência
              </button>
            )}
          </div>

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Título</th>
                    <th>Responsável</th>
                    <th>Criticidade</th>
                    <th>Status</th>
                    <th>Data</th>
                    {(canChangeOccurrence || canDeleteOccurrence) && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {occurrences.map((occurrence) => (
                    <tr key={occurrence.id}>
                      <td>{occurrence.title}</td>
                      <td>{occurrence.responsible_name || "—"}</td>
                      <td>
                        <span className="badge" style={SEVERITY_TONE[occurrence.severity]}>
                          {occurrence.severity_display}
                        </span>
                      </td>
                      <td>
                        <StatusBadge status={occurrence.status} label={occurrence.status_display} />
                      </td>
                      <td>{new Date(occurrence.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                      {(canChangeOccurrence || canDeleteOccurrence) && (
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            {canChangeOccurrence && (
                              <button
                                className="btn btn-outline btn-sm"
                                onClick={() => {
                                  setEditingOccurrence(occurrence);
                                  setOccurrenceFormOpen(true);
                                }}
                              >
                                <Icon name="edit" style={{ fontSize: 14 }} />
                              </button>
                            )}
                            {canDeleteOccurrence && (
                              <button className="btn btn-outline btn-sm" onClick={() => handleDeleteOccurrence(occurrence)} style={{ color: "var(--red)" }}>
                                <Icon name="delete" style={{ fontSize: 14 }} />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                  {!occurrencesLoading && occurrences.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="table-empty">Nenhuma ocorrência registrada.</div>
                      </td>
                    </tr>
                  )}
                  {occurrencesLoading && (
                    <tr>
                      <td colSpan={6}>
                        <div className="table-empty">Carregando...</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "attachments" && (
        <>
          {canAddAttachment && (
            <div className="card" style={{ padding: 16, marginBottom: 16 }}>
              <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 12px" }}>Anexar arquivo</h2>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div className="field-group" style={{ flex: "1 1 220px" }}>
                  <span className="field-label">Arquivo</span>
                  <input
                    id="attachment-file-input"
                    type="file"
                    className="input"
                    onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)}
                  />
                </div>
                <div className="field-group" style={{ flex: "1 1 220px" }}>
                  <span className="field-label">Descrição (opcional)</span>
                  <input
                    type="text"
                    className="input"
                    value={attachmentDescription}
                    onChange={(e) => setAttachmentDescription(e.target.value)}
                    placeholder="Ex: Planta baixa atualizada"
                  />
                </div>
                <button className="btn btn-primary" onClick={handleUploadAttachment} disabled={!attachmentFile || uploadingAttachment}>
                  <Icon name="upload" style={{ fontSize: 16 }} />
                  {uploadingAttachment ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Arquivo</th>
                    <th>Descrição</th>
                    <th>Tamanho</th>
                    <th>Enviado por</th>
                    <th>Data</th>
                    <th>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {attachments.map((attachment) => (
                    <tr key={attachment.id}>
                      <td>{attachment.file_name}</td>
                      <td>{attachment.description || "—"}</td>
                      <td>{formatFileSize(attachment.file_size)}</td>
                      <td>{attachment.uploaded_by_name || "—"}</td>
                      <td>{new Date(attachment.created_at).toLocaleDateString("pt-BR")}</td>
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button className="btn btn-outline btn-sm" onClick={() => handleDownloadAttachment(attachment)}>
                            <Icon name="download" style={{ fontSize: 14 }} />
                          </button>
                          {canDeleteAttachment && (
                            <button className="btn btn-outline btn-sm" onClick={() => handleDeleteAttachment(attachment)} style={{ color: "var(--red)" }}>
                              <Icon name="delete" style={{ fontSize: 14 }} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!attachmentsLoading && attachments.length === 0 && (
                    <tr>
                      <td colSpan={6}>
                        <div className="table-empty">Nenhum arquivo anexado.</div>
                      </td>
                    </tr>
                  )}
                  {attachmentsLoading && (
                    <tr>
                      <td colSpan={6}>
                        <div className="table-empty">Carregando...</div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "planning" && (
        <>
          {planningLoading && workBlocks.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
          ) : (
            <>
              <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Planejado x Executado</h2>
                <div className="section-actions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {canImportScope && (
                    <Link className="btn btn-outline btn-sm" to={`/projetos/${project.id}/importar-escopo`}>
                      <Icon name="auto_awesome" style={{ fontSize: 15 }} />
                      Importar Escopo
                    </Link>
                  )}
                  {canAddWorkBlock && (
                    <button className="btn btn-primary btn-sm" onClick={() => setWorkBlockFormOpen(true)}>
                      <Icon name="add" style={{ fontSize: 15 }} />
                      Novo Bloco
                    </button>
                  )}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Tipo de Atividade</th>
                        <th>Planejado x Executado</th>
                        <th>Tarefas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const byActivity = new Map<number, { name: string; planned: number; completed: number; taskCount: number; completedCount: number }>();
                        for (const row of planningSummary) {
                          if (row.activity_type_id == null) continue;
                          const existing = byActivity.get(row.activity_type_id) ?? {
                            name: row.activity_type_name || "—",
                            planned: 0,
                            completed: 0,
                            taskCount: 0,
                            completedCount: 0,
                          };
                          existing.planned += Number(row.quantity_planned || 0);
                          existing.completed += Number(row.quantity_completed || 0);
                          existing.taskCount += row.task_count;
                          existing.completedCount += row.completed_task_count;
                          byActivity.set(row.activity_type_id, existing);
                        }
                        const rows = [...byActivity.values()];
                        return rows.length > 0 ? (
                          rows.map((row) => (
                            <tr key={row.name}>
                              <td>{row.name}</td>
                              <td>
                                <PlannedVsExecutedBar planned={row.planned} executed={row.completed} />
                              </td>
                              <td>
                                {row.completedCount}/{row.taskCount}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={3}>
                              <div className="table-empty">Nenhuma tarefa com Tipo de Atividade cadastrada ainda.</div>
                            </td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {selectedItemTaskIds.length > 0 && (canChangeTask || canDeleteTask) && (
                <TasksBulkUpdatePanel
                  project={project}
                  selectedIds={selectedItemTaskIds}
                  collaborators={collaborators}
                  rackPositions={rackPositions}
                  workBlocks={workBlocks}
                  activityTypes={activityTypes}
                  onClear={() => setSelectedItemTaskIds([])}
                  onApplied={() => {
                    setSelectedItemTaskIds([]);
                    reload();
                    reloadPlanning();
                  }}
                />
              )}

              {workBlocks.map((block) => {
                const summaryRows = planningSummary.filter((r) => r.work_block_id === block.id);
                const taskCount = summaryRows.reduce((sum, r) => sum + r.task_count, 0);
                const completedTaskCount = summaryRows.reduce((sum, r) => sum + r.completed_task_count, 0);
                return (
                  <PlanningBlockSection
                    key={block.id}
                    block={block}
                    items={items.filter((i) => i.work_block === block.id)}
                    tasks={tasks}
                    open={openBlocks[block.id] ?? false}
                    onToggle={() => setOpenBlocks((prev) => ({ ...prev, [block.id]: !prev[block.id] }))}
                    taskCount={taskCount}
                    completedTaskCount={completedTaskCount}
                    selectedTaskIds={selectedItemTaskIds}
                    onToggleTaskSelection={toggleItemTaskSelection}
                    canChangeTask={canChangeTask}
                    onAddItem={() => {
                      setEditingItem(null);
                      setItemFormOpen(true);
                    }}
                    onAddTask={(item) => {
                      setNewTaskForItem(item);
                      setPlanningTaskFormOpen(true);
                    }}
                    onGenerateFromRule={handleGenerateFromRule}
                  />
                );
              })}

              {items.some((i) => !i.work_block) && (
                <PlanningBlockSection
                  block={null}
                  items={items.filter((i) => !i.work_block)}
                  tasks={tasks}
                  open={openBlocks[0] ?? false}
                  onToggle={() => setOpenBlocks((prev) => ({ ...prev, 0: !prev[0] }))}
                  taskCount={planningSummary.filter((r) => r.work_block_id === null && r.activity_type_id !== null).reduce((s, r) => s + r.task_count, 0)}
                  completedTaskCount={planningSummary
                    .filter((r) => r.work_block_id === null && r.activity_type_id !== null)
                    .reduce((s, r) => s + r.completed_task_count, 0)}
                  selectedTaskIds={selectedItemTaskIds}
                  onToggleTaskSelection={toggleItemTaskSelection}
                  canChangeTask={canChangeTask}
                  onAddItem={() => {
                    setEditingItem(null);
                    setItemFormOpen(true);
                  }}
                  onAddTask={(item) => {
                    setNewTaskForItem(item);
                    setPlanningTaskFormOpen(true);
                  }}
                  onGenerateFromRule={handleGenerateFromRule}
                />
              )}

              {workBlocks.length === 0 && items.length === 0 && (
                <div className="empty-state">Nenhum bloco ou item cadastrado ainda. Crie um Bloco pra começar a organizar o planejamento.</div>
              )}
            </>
          )}
        </>
      )}

      {rackFormOpen && <RackPositionFormModal projectId={project.id} rackPosition={editingRack} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {rackBulkOpen && <RackPositionBulkModal projectId={project.id} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {taskFormOpen && (
        <ProjectTaskFormModal
          project={project}
          projectTask={editingTask}
          existingTasks={tasks}
          rackPositions={rackPositions}
          activityTypes={activityTypes}
          items={items}
          onClose={closeTaskModals}
          onSaved={handleTaskSaved}
        />
      )}
      {planningTaskFormOpen && (
        <ProjectTaskFormModal
          project={project}
          projectTask={null}
          existingTasks={tasks}
          rackPositions={rackPositions}
          activityTypes={activityTypes}
          items={items}
          defaultProjectItemId={newTaskForItem?.id}
          onClose={closePlanningTaskModal}
          onSaved={handlePlanningTaskSaved}
        />
      )}
      {workBlockFormOpen && (
        <WorkBlockFormModal projectId={project.id} workBlock={editingWorkBlock} onClose={closeWorkBlockModal} onSaved={handleWorkBlockSaved} />
      )}
      {itemFormOpen && (
        <ProjectItemFormModal
          projectId={project.id}
          item={editingItem}
          workBlocks={workBlocks}
          itemTypes={itemTypes}
          onClose={closeItemModal}
          onSaved={handleItemSaved}
        />
      )}
      {taskCatalogOpen && (
        <TasksCatalogAddModal project={project} existingTasks={tasks} rackPositions={rackPositions} onClose={closeTaskModals} onSaved={handleTaskSaved} />
      )}
      {customTasksOpen && (
        <BulkNamesModal
          title="Adicionar Tarefas Avulsas"
          helpText="Um nome de tarefa por linha. Essas tarefas não vêm do catálogo — ficam exclusivas deste projeto."
          extraFields={[]}
          extraValues={{}}
          onSave={(names) => projectsApi.createCustomTasks(project.id, names)}
          onClose={closeTaskModals}
          onSaved={handleTaskSaved}
        />
      )}
      {occurrenceFormOpen && (
        <ProjectOccurrenceFormModal
          projectId={project.id}
          occurrence={editingOccurrence}
          collaborators={collaborators}
          onClose={closeOccurrenceModal}
          onSaved={handleOccurrenceSaved}
        />
      )}
    </div>
  );
}

function OverviewPanel({ icon, title, children }: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Icon name={icon} style={{ fontSize: 17, color: "var(--orange)" }} />
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.04em" }}>{title}</span>
      </div>
      {children}
    </div>
  );
}

function PanelField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="info-box-label">{label}</div>
      <div className="info-box-value">{value}</div>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
