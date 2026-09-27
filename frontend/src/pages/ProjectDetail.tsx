import { useEffect, useMemo, useRef, useState, type ReactNode, useCallback } from "react";
import { Link, useParams } from "react-router-dom";
import { projectAttachmentsApi, projectOccurrencesApi, projectsApi, projectTasksApi, rackPositionsApi, registryApi } from "../api/resources";
import type { CollaboratorFull, CollaboratorHours, Project, ProjectAttachment, ProjectOccurrence, ProjectTask, RackPosition } from "../api/types";
import ProjectFormModal from "../components/projects/ProjectFormModal";
import ProjectOccurrenceFormModal from "../components/projects/ProjectOccurrenceFormModal";
import ProjectTaskFormModal from "../components/projects/ProjectTaskFormModal";
import RackPositionBulkModal from "../components/projects/RackPositionBulkModal";
import RackPositionFormModal from "../components/projects/RackPositionFormModal";
import TasksBulkUpdatePanel from "../components/projects/TasksBulkUpdatePanel";
import TasksCatalogAddModal from "../components/projects/TasksCatalogAddModal";
import BulkNamesModal from "../components/ui/BulkNamesModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { downloadAuthenticatedFile } from "../utils/downloadFile";
import { PERMS, hasPerm } from "../utils/permissions";

type DetailTab = "overview" | "tasks" | "hours" | "occurrences" | "attachments";

const TASK_STATUS_OPTIONS = [
  { value: "not_started", label: "Não Iniciada" },
  { value: "in_progress", label: "Em Andamento" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluída" },
  { value: "canceled", label: "Cancelada" },
];

type TaskSortColumn = "task_name" | "status" | "technicians";

const SEVERITY_TONE: Record<string, { bg: string; color: string }> = {
  low: { bg: "var(--bg)", color: "var(--text-muted)" },
  medium: { bg: "var(--blue-soft)", color: "var(--blue)" },
  high: { bg: "var(--amber-soft)", color: "var(--amber)" },
  critical: { bg: "var(--red-soft)", color: "var(--red)" },
};

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [rackPositions, setRackPositions] = useState<RackPosition[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DetailTab>("overview");
  const [tasksOpen, setTasksOpen] = useState(true);
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
  const [taskSortColumn, setTaskSortColumn] = useState<TaskSortColumn | null>(null);
  const [taskSortDirection, setTaskSortDirection] = useState<"asc" | "desc">("asc");

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

  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [projectMenuOpen]);

  const handleCloseProject = useCallback(async () => {
    if (!project) return;
    if (!confirm(`Encerrar o projeto "${project.name}"? Esta ação marcará o projeto como encerrado.`)) return;
    setProjectMenuOpen(false);
    await projectsApi.update(project.id, { status: "closed" } as never);
    reload();
  }, [project]);

  const canAddRack = hasPerm(user, PERMS.addRackPosition);
  const canChangeRack = hasPerm(user, PERMS.changeRackPosition);
  const canDeleteRack = hasPerm(user, PERMS.deleteRackPosition);
  const canAddTask = hasPerm(user, PERMS.addProjectTask);
  const canChangeTask = hasPerm(user, PERMS.changeProjectTask);
  const canDeleteTask = hasPerm(user, PERMS.deleteProjectTask);
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
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);


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

  function toggleTaskSort(column: TaskSortColumn) {
    if (taskSortColumn === column) {
      setTaskSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setTaskSortColumn(column);
      setTaskSortDirection("asc");
    }
  }

  const filteredTasks = useMemo(() => {
    const query = taskSearch.trim().toLowerCase();
    let result = tasks.filter((t) => {
      if (taskStatusFilter && t.status !== taskStatusFilter) return false;
      if (query && !t.task_name.toLowerCase().includes(query)) return false;
      return true;
    });
    if (taskSortColumn) {
      const dir = taskSortDirection === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => {
        let cmp = 0;
        if (taskSortColumn === "task_name") cmp = a.task_name.localeCompare(b.task_name);
        else if (taskSortColumn === "status") cmp = a.status_display.localeCompare(b.status_display);
        else if (taskSortColumn === "technicians") {
          const nameA = a.collaborators[0]?.name || "";
          const nameB = b.collaborators[0]?.name || "";
          cmp = nameA.localeCompare(nameB);
        }
        return cmp * dir;
      });
    }
    return result;
  }, [tasks, taskSearch, taskStatusFilter, taskSortColumn, taskSortDirection]);

  function sortIndicator(column: TaskSortColumn) {
    if (taskSortColumn !== column) return null;
    return <Icon name={taskSortDirection === "asc" ? "arrow_upward" : "arrow_downward"} style={{ fontSize: 14, verticalAlign: "middle", marginLeft: 4 }} />;
  }

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;
  if (!project) return <p style={{ color: "var(--text-muted)" }}>Projeto não encontrado.</p>;

  const pendingTasks = tasks.filter((t) => t.status !== "completed" && t.status !== "canceled");

  function handleNavClick(tab: DetailTab) {
    setActiveTab(tab);
    if (tab === "hours" && hours.length === 0 && !hoursLoading) reloadHours();
    if (tab === "occurrences" && occurrences.length === 0 && !occurrencesLoading) reloadOccurrences();
    if (tab === "attachments" && attachments.length === 0 && !attachmentsLoading) reloadAttachments();
  }

  return (
    <div>
      {/* ── cabeçalho do projeto — estilo D ── */}
      <div className="card" style={{ padding: 0, marginBottom: 16, overflow: "visible" }}>
        {/* faixa laranja no topo */}
        <div style={{ height: 3, background: "var(--orange)", borderRadius: "8px 8px 0 0" }} />

        <div style={{ padding: "14px 20px" }}>
          <Link
            to="/projetos"
            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", fontSize: 12, marginBottom: 10 }}
          >
            <Icon name="arrow_back" style={{ fontSize: 15 }} />
            Voltar para Projetos
          </Link>

          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20 }}>
            {/* lado esquerdo: código + título + grid de campos */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--orange)", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 3 }}>
                {project.code}
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 800, color: "var(--text)", margin: "0 0 12px", lineHeight: 1.2 }}>{project.name}</h1>

              {/* grid de metadados */}
              <div style={{ display: "flex", gap: 0, flexWrap: "wrap" }}>
                {project.po && (
                  <div style={{ paddingRight: 16, borderRight: "1px solid var(--border)", marginRight: 16 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>PO</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.po}</div>
                  </div>
                )}
                {project.client_name && (
                  <div style={{ paddingRight: 16, borderRight: "1px solid var(--border)", marginRight: 16 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>Cliente</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.client_name}</div>
                  </div>
                )}
                {project.site_name && (
                  <div style={{ paddingRight: 16, borderRight: project.category_name ? "1px solid var(--border)" : "none", marginRight: project.category_name ? 16 : 0 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>Site</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.site_name}</div>
                  </div>
                )}
                {project.category_name && (
                  <div>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-faint)", marginBottom: 1 }}>Categoria</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{project.category_name}</div>
                  </div>
                )}
              </div>
            </div>

            {/* lado direito: status + progresso + menu */}
            <div style={{ textAlign: "right", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
              <StatusBadge status={project.status} label={project.status_display} />
              <div>
                <div style={{ fontSize: 26, fontWeight: 800, color: "var(--orange)", lineHeight: 1 }}>{project.progress_percent}%</div>
                <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{project.completed_tasks} de {project.total_tasks} tarefas</div>
              </div>
              {/* dropdown de opções do projeto */}
              <div ref={projectMenuRef} style={{ position: "relative" }}>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => setProjectMenuOpen((v) => !v)}
                >
                  <Icon name="settings" style={{ fontSize: 15 }} />
                  Opções do Projeto
                  <Icon name={projectMenuOpen ? "expand_less" : "expand_more"} style={{ fontSize: 15 }} />
                </button>
                {projectMenuOpen && (
                  <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 100,
                    background: "var(--white)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 4px 16px rgba(0,0,0,.15)",
                    minWidth: 180, overflow: "hidden",
                  }}>
                    <button
                      onClick={() => { setEditingProject(true); setProjectMenuOpen(false); }}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--text)", textAlign: "left" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      <Icon name="edit" style={{ fontSize: 15, color: "var(--text-muted)" }} />
                      Editar Projeto
                    </button>
                    <div style={{ height: 1, background: "var(--border)" }} />
                    <button
                      onClick={handleCloseProject}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 13, color: "var(--danger)", textAlign: "left" }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-2)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
                    >
                      <Icon name="do_not_disturb_on" style={{ fontSize: 15, color: "var(--danger)" }} />
                      Encerrar Projeto
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── layout principal: conteúdo + sidebar de navegação ── */}
      <div className="project-detail-layout" style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>

        {/* área de conteúdo */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* ── VISÃO GERAL ── */}
          {activeTab === "overview" && (
            <OverviewSection
              project={project}
              tasks={tasks}
              pendingTasks={pendingTasks}
              occurrencesCount={occurrences.length}
              descriptionOpen={descriptionOpen}
              setDescriptionOpen={setDescriptionOpen}
              onGoToTasks={() => handleNavClick("tasks")}
            />
          )}

          {/* ── TAREFAS ── */}
          {activeTab === "tasks" && (
            <>
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
                  <div className="card" style={{ marginBottom: 20 }}>
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
                                      <button className="btn btn-outline btn-sm" onClick={() => { setEditingRack(rp); setRackFormOpen(true); }}>
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
                            <tr><td colSpan={5}><div className="table-empty">Nenhuma Rack Position cadastrada ainda.</div></td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              <div className="section-header-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>
                  Tarefas <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-muted)" }}>({project.completed_tasks} / {project.total_tasks})</span>
                </h2>
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

              {selectedTaskIds.length > 0 && (canChangeTask || canDeleteTask) && (
                <TasksBulkUpdatePanel
                  project={project}
                  selectedIds={selectedTaskIds}
                  collaborators={collaborators}
                  rackPositions={rackPositions}
                  onClear={() => setSelectedTaskIds([])}
                  onApplied={() => { setSelectedTaskIds([]); reload(); }}
                />
              )}

              <div className="filter-row" style={{ marginBottom: 12 }}>
                <div className="field-group" style={{ width: 220 }}>
                  <span className="field-label">Buscar</span>
                  <div className="search-input-wrap">
                    <Icon name="search" />
                    <input className="input" placeholder="Buscar por nome da tarefa..." value={taskSearch} onChange={(e) => setTaskSearch(e.target.value)} />
                  </div>
                </div>
                <div className="field-group">
                  <span className="field-label">Status</span>
                  <select className="select" value={taskStatusFilter} onChange={(e) => setTaskStatusFilter(e.target.value)}>
                    <option value="">Todos</option>
                    {TASK_STATUS_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
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
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("task_name")}>
                          Tarefa{sortIndicator("task_name")}
                        </th>
                        <th>Path</th>
                        <th>Qtd.</th>
                        {project.has_rack_positions && <th>Rack Position</th>}
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("status")}>
                          Status{sortIndicator("status")}
                        </th>
                        <th style={{ cursor: "pointer", userSelect: "none" }} onClick={() => toggleTaskSort("technicians")}>
                          Técnicos{sortIndicator("technicians")}
                        </th>
                        {(canChangeTask || canDeleteTask) && <th>Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTasks.map((task) => (
                        <tr key={task.id}>
                          {(canChangeTask || canDeleteTask) && (
                            <td>
                              <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} />
                            </td>
                          )}
                          <td title={task.scope_item_code ? `Item de Escopo: ${task.scope_item_code}` : undefined}>{task.task_name}</td>
                          <td>{task.path_code || "—"}</td>
                          <td>{task.quantity_planned ? `${task.quantity_planned} ${task.unit}`.trim() : "—"}</td>
                          {project.has_rack_positions && <td>{task.rack_position_labels.join(", ") || "—"}</td>}
                          <td><StatusBadge status={task.status} label={task.status_display} /></td>
                          <td>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                          {(canChangeTask || canDeleteTask) && (
                            <td>
                              <div style={{ display: "flex", gap: 8 }}>
                                {canChangeTask && (
                                  <button className="btn btn-outline btn-sm" onClick={() => { setEditingTask(task); setTaskFormOpen(true); }}>
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
                      ))}
                      {filteredTasks.length === 0 && (
                        <tr>
                          <td colSpan={project.has_rack_positions ? 8 : 7}>
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

          {/* ── HORAS ── */}
          {activeTab === "hours" && (
            <div className="panel-field-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 10px" }}>Por Técnico</h2>
                <div className="card">
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>Técnico</th><th>Horas Trabalhadas</th></tr></thead>
                      <tbody>
                        {hours.map((item) => (
                          <tr key={item.collaborator_id}>
                            <td>{item.collaborator_name}</td>
                            <td>{item.hours}h</td>
                          </tr>
                        ))}
                        {!hoursLoading && hours.length === 0 && (
                          <tr><td colSpan={2}><div className="table-empty">Nenhuma hora registrada ainda.</div></td></tr>
                        )}
                        {hoursLoading && (
                          <tr><td colSpan={2}><div className="table-empty">Carregando...</div></td></tr>
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
                      <thead><tr><th>Tarefa</th><th>Horas Trabalhadas</th></tr></thead>
                      <tbody>
                        {tasks.map((task) => (
                          <tr key={task.id}>
                            <td>{task.task_name}</td>
                            <td>{task.worked_hours}h</td>
                          </tr>
                        ))}
                        {tasks.length === 0 && (
                          <tr><td colSpan={2}><div className="table-empty">Nenhuma tarefa cadastrada.</div></td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── OCORRÊNCIAS ── */}
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
                            <span className="badge" style={SEVERITY_TONE[occurrence.severity]}>{occurrence.severity_display}</span>
                          </td>
                          <td><StatusBadge status={occurrence.status} label={occurrence.status_display} /></td>
                          <td>{new Date(occurrence.occurred_at + "T00:00:00").toLocaleDateString("pt-BR")}</td>
                          {(canChangeOccurrence || canDeleteOccurrence) && (
                            <td>
                              <div style={{ display: "flex", gap: 8 }}>
                                {canChangeOccurrence && (
                                  <button className="btn btn-outline btn-sm" onClick={() => { setEditingOccurrence(occurrence); setOccurrenceFormOpen(true); }}>
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
                        <tr><td colSpan={6}><div className="table-empty">Nenhuma ocorrência registrada.</div></td></tr>
                      )}
                      {occurrencesLoading && (
                        <tr><td colSpan={6}><div className="table-empty">Carregando...</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* ── ANEXOS ── */}
          {activeTab === "attachments" && (
            <>
              {canAddAttachment && (
                <div className="card" style={{ padding: 16, marginBottom: 16 }}>
                  <h2 style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", margin: "0 0 12px" }}>Anexar arquivo</h2>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
                    <div className="field-group" style={{ flex: "1 1 220px" }}>
                      <span className="field-label">Arquivo</span>
                      <input id="attachment-file-input" type="file" className="input" onChange={(e) => setAttachmentFile(e.target.files?.[0] ?? null)} />
                    </div>
                    <div className="field-group" style={{ flex: "1 1 220px" }}>
                      <span className="field-label">Descrição (opcional)</span>
                      <input type="text" className="input" value={attachmentDescription} onChange={(e) => setAttachmentDescription(e.target.value)} placeholder="Ex: Planta baixa atualizada" />
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
                        <tr><td colSpan={6}><div className="table-empty">Nenhum arquivo anexado.</div></td></tr>
                      )}
                      {attachmentsLoading && (
                        <tr><td colSpan={6}><div className="table-empty">Carregando...</div></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── sidebar de navegação ── */}
        <div className="project-detail-sidebar" style={{ width: 260, flexShrink: 0 }}>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)" }}>
              Seções
            </div>

            {(["overview", "tasks", "hours", "occurrences", "attachments"] as DetailTab[]).map((tab) => {
              const labels: Record<DetailTab, string> = {
                overview: "Visão geral",
                tasks: "Tarefas",
                hours: "Horas trabalhadas",
                occurrences: "Ocorrências",
                attachments: "Anexos",
              };
              const icons: Record<DetailTab, string> = {
                overview: "dashboard",
                tasks: "checklist",
                hours: "schedule",
                occurrences: "warning",
                attachments: "attach_file",
              };
              const badges: Record<DetailTab, string | null> = {
                overview: null,
                tasks: pendingTasks.length > 0 ? `${pendingTasks.length} pendente${pendingTasks.length > 1 ? "s" : ""}` : `${project.completed_tasks}/${project.total_tasks}`,
                hours: `${project.worked_hours}h`,
                occurrences: occurrences.length > 0 ? String(occurrences.length) : null,
                attachments: attachments.length > 0 ? String(attachments.length) : null,
              };
              const badgeWarn = tab === "tasks" && pendingTasks.length > 0;
              const isActive = activeTab === tab;

              return (
                <button
                  key={tab}
                  onClick={() => handleNavClick(tab)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "10px 14px",
                    background: isActive ? "var(--primary-soft, rgba(230,90,0,0.08))" : "none",
                    borderLeft: isActive ? "3px solid var(--orange)" : "3px solid transparent",
                    borderTop: "none",
                    borderRight: "none",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <Icon name={icons[tab]} style={{ fontSize: 15, color: isActive ? "var(--orange)" : "var(--text-faint)" }} />
                    <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 400, color: isActive ? "var(--orange)" : "var(--text)" }}>
                      {labels[tab]}
                    </span>
                  </span>
                  {badges[tab] && (
                    <span
                      className="badge"
                      style={{
                        fontSize: 10,
                        padding: "1px 6px",
                        background: badgeWarn ? "var(--warning-soft, #fef3cd)" : "var(--surface-2)",
                        color: badgeWarn ? "var(--warning)" : "var(--text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {badges[tab]}
                    </span>
                  )}
                </button>
              );
            })}

            {/* bloco de metadados no sidebar */}
            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Responsáveis
              </div>
              <SidebarField label="CSTR" value={project.responsible_cstr_name || "—"} />
              <SidebarField label="Cliente" value={project.responsible_client_name || "—"} />
            </div>

            <div style={{ padding: "12px 14px", borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 10, fontWeight: 800, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Cronograma
              </div>
              <SidebarField label="Início" value={formatDate(project.actual_start || project.planned_start)} />
              <SidebarField
                label="Prazo"
                value={formatDate(project.planned_end)}
                warn={!!project.planned_end && !project.actual_end}
              />
              {project.actual_end && <SidebarField label="Término" value={formatDate(project.actual_end)} />}
            </div>
          </div>
        </div>
      </div>

      {/* ── modais ── */}
      {editingProject && (
        <ProjectFormModal
          project={project}
          onClose={() => setEditingProject(false)}
          onSaved={() => { setEditingProject(false); reload(); }}
        />
      )}
      {rackFormOpen && <RackPositionFormModal projectId={project.id} rackPosition={editingRack} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {rackBulkOpen && <RackPositionBulkModal projectId={project.id} onClose={closeRackModals} onSaved={handleRackSaved} />}
      {taskFormOpen && (
        <ProjectTaskFormModal
          project={project}
          projectTask={editingTask}
          existingTasks={tasks}
          rackPositions={rackPositions}
          onClose={closeTaskModals}
          onSaved={handleTaskSaved}
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

// ── helpers de agrupamento de tarefas por prefixo ──
function groupTasksByPrefix(tasks: ProjectTask[]) {
  const groups: Record<string, { total: number; completed: number }> = {};
  for (const t of tasks) {
    const prefix = t.task_name.split(" ").slice(0, 2).join(" ");
    if (!groups[prefix]) groups[prefix] = { total: 0, completed: 0 };
    groups[prefix].total++;
    if (t.status === "completed") groups[prefix].completed++;
  }
  return Object.entries(groups)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);
}

function OverviewSection({
  project, tasks, pendingTasks, occurrencesCount,
  descriptionOpen, setDescriptionOpen, onGoToTasks,
}: {
  project: Project;
  tasks: ProjectTask[];
  pendingTasks: ProjectTask[];
  occurrencesCount: number;
  descriptionOpen: boolean;
  setDescriptionOpen: (v: boolean) => void;
  onGoToTasks: () => void;
}) {
  // timeline
  const startStr = project.actual_start || project.planned_start;
  const endStr = project.planned_end;
  const tlPct = (() => {
    if (!startStr || !endStr) return 0;
    const start = new Date(startStr + "T00:00:00").getTime();
    const end = new Date(endStr + "T00:00:00").getTime();
    const now = Date.now();
    if (end <= start) return 0;
    return Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100)));
  })();
  const daysLeft = (() => {
    if (!endStr) return null;
    const diff = new Date(endStr + "T00:00:00").getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();
  const daysTotal = (() => {
    if (!startStr || !endStr) return null;
    const diff = new Date(endStr + "T00:00:00").getTime() - new Date(startStr + "T00:00:00").getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();

  // contagem por status
  const statusCounts = {
    completed: tasks.filter((t) => t.status === "completed").length,
    in_progress: tasks.filter((t) => t.status === "in_progress").length,
    not_started: tasks.filter((t) => t.status === "not_started" || t.status === "paused").length,
    canceled: tasks.filter((t) => t.status === "canceled").length,
  };
  const donutTotal = tasks.length || 1;
  const donutR = 28;
  const donutC = 2 * Math.PI * donutR;
  const completedArc = (statusCounts.completed / donutTotal) * donutC;
  const inProgressArc = (statusCounts.in_progress / donutTotal) * donutC;
  const notStartedArc = ((statusCounts.not_started + statusCounts.canceled) / donutTotal) * donutC;
  const completedOffset = 0;
  const inProgressOffset = completedArc;
  const notStartedOffset = completedArc + inProgressArc;

  const groups = groupTasksByPrefix(tasks);

  const highlightPending = pendingTasks.slice(0, 4);

  return (
    <>
      {/* KPIs */}
      <div className="project-stats-4col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: "var(--orange)" }}>{project.progress_percent}%</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Progresso geral</div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1, color: pendingTasks.length > 0 ? "var(--warning)" : "var(--success)" }}>
            {pendingTasks.length}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
            {pendingTasks.length === 1 ? "Tarefa pendente" : "Tarefas pendentes"}
          </div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{project.worked_hours}h</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Horas trabalhadas</div>
        </div>
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, lineHeight: 1 }}>{occurrencesCount}</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Ocorrências</div>
        </div>
      </div>

      {/* linha 1: timeline + donut */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* timeline */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            Linha do tempo
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)", marginBottom: 22 }}>
            <span>Início: {formatDate(startStr)}</span>
            <span>Prazo: {formatDate(endStr)}</span>
          </div>
          <div style={{ position: "relative", height: 10, background: "var(--surface-2)", borderRadius: 5, border: "0.5px solid var(--border)" }}>
            <div style={{ height: "100%", borderRadius: 5, background: "var(--orange)", width: `${tlPct}%` }} />
            {tlPct > 0 && tlPct < 100 && (
              <div style={{ position: "absolute", top: -8, left: `${tlPct}%`, width: 2, height: 26, background: "var(--orange)", borderRadius: 1 }}>
                <span style={{ position: "absolute", bottom: "100%", left: 5, fontSize: 10, color: "var(--orange)", fontWeight: 700, whiteSpace: "nowrap", marginBottom: 2 }}>
                  Hoje
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontSize: 12, color: "var(--text-muted)" }}>
            {daysTotal != null && <span>Duração: <strong style={{ color: "var(--text)" }}>{daysTotal} dias</strong></span>}
            {daysLeft != null && (
              <span style={{ color: daysLeft < 0 ? "var(--danger)" : daysLeft <= 3 ? "var(--warning)" : "var(--text-muted)" }}>
                {daysLeft < 0 ? `${Math.abs(daysLeft)} dias em atraso` : daysLeft === 0 ? "Prazo hoje" : `${daysLeft} dias restantes`}
              </span>
            )}
          </div>
        </div>

        {/* donut */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            Distribuição de status
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ position: "relative", width: 90, height: 90, flexShrink: 0 }}>
              <svg width="90" height="90" viewBox="0 0 90 90" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="var(--border)" strokeWidth="13" />
                {statusCounts.completed > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#3B6D11" strokeWidth="13"
                    strokeDasharray={`${completedArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - completedArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-completedOffset * ((donutR + 6) / donutR)} />
                )}
                {statusCounts.in_progress > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#185FA5" strokeWidth="13"
                    strokeDasharray={`${inProgressArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - inProgressArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-inProgressOffset * ((donutR + 6) / donutR)} />
                )}
                {(statusCounts.not_started + statusCounts.canceled) > 0 && (
                  <circle cx="45" cy="45" r={donutR + 6} fill="none" stroke="#FAEEDA" strokeWidth="13"
                    strokeDasharray={`${notStartedArc * ((donutR + 6) / donutR)} ${donutC * ((donutR + 6) / donutR) - notStartedArc * ((donutR + 6) / donutR)}`}
                    strokeDashoffset={-notStartedOffset * ((donutR + 6) / donutR)} />
                )}
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "var(--orange)", lineHeight: 1 }}>
                {project.progress_percent}%
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 400, marginTop: 2 }}>concl.</span>
              </div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { color: "#3B6D11", label: "Concluída", count: statusCounts.completed },
                { color: "#185FA5", label: "Em andamento", count: statusCounts.in_progress },
                { color: "#BA7517", label: "Não iniciada", count: statusCounts.not_started },
                { color: "#A32D2D", label: "Cancelada", count: statusCounts.canceled },
              ].map(({ color, label, count }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, fontSize: 13 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
                    <span style={{ color: "var(--text)" }}>{label}</span>
                  </span>
                  <span style={{ fontWeight: 700, color }}>{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>

      {/* linha 2: progresso por tipo + pendências */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
        {/* progresso por tipo */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            Progresso por tipo de atividade
          </div>
          {groups.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Nenhuma tarefa cadastrada.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
              {groups.map(([prefix, { total, completed }]) => {
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
                return (
                  <div key={prefix} style={{ display: "grid", gridTemplateColumns: "140px 1fr 40px", alignItems: "center", gap: 10 }}>
                    <span style={{ fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={prefix}>
                      {prefix}
                    </span>
                    <div style={{ height: 7, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden", border: "0.5px solid var(--border)" }}>
                      <div style={{ height: "100%", borderRadius: 4, background: pct === 100 ? "var(--success)" : pct > 0 ? "var(--warning)" : "var(--orange)", width: `${pct}%` }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right", color: pct === 100 ? "var(--success)" : "var(--text-muted)" }}>
                      {pct}%
                    </span>
                  </div>
                );
              })}
              {groups.length === 6 && (
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>* exibindo top 6 grupos</div>
              )}
            </div>
          )}
        </div>

        {/* pendências em destaque */}
        <div className="card" style={{ padding: "18px 20px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--text-muted)", marginBottom: 16 }}>
            Pendências em destaque
          </div>
          {highlightPending.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--success)" }}>Todas as tarefas concluídas!</div>
          ) : (
            <>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {highlightPending.map((task) => (
                  <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "0.5px solid var(--border)" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--warning)", flexShrink: 0, display: "inline-block" }} />
                    <span style={{ flex: 1, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{task.task_name}</span>
                    <StatusBadge status={task.status} label={task.status_display} />
                  </div>
                ))}
              </div>
              {pendingTasks.length > 4 && (
                <div style={{ marginTop: 10, fontSize: 12, textAlign: "right" }}>
                  <span style={{ color: "var(--text-muted)" }}>+ {pendingTasks.length - 4} pendentes · </span>
                  <button
                    onClick={onGoToTasks}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--orange)", fontWeight: 700, fontSize: 12, padding: 0 }}
                  >
                    ver todas as tarefas →
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* descrição colapsável */}
      {project.description && (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <button
            onClick={() => setDescriptionOpen(!descriptionOpen)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
          >
            <Icon name={descriptionOpen ? "expand_less" : "expand_more"} style={{ fontSize: 18, color: "var(--text-faint)" }} />
            <Icon name="description" style={{ fontSize: 15, color: "var(--orange)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Descrição</span>
          </button>
          {descriptionOpen && (
            <div style={{ padding: "0 16px 16px", fontSize: 13.5, color: "var(--text)", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
              {project.description}
            </div>
          )}
        </div>
      )}
    </>
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

function SidebarField({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginBottom: 1 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: warn ? "var(--warning)" : "var(--text)" }}>{value}</div>
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}
