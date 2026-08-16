import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectsApi, projectTasksApi, rackPositionsApi, registryApi } from "../api/resources";
import type { CollaboratorFull, Project, ProjectTask, RackPosition } from "../api/types";
import ProjectTaskFormModal from "../components/projects/ProjectTaskFormModal";
import RackPositionBulkModal from "../components/projects/RackPositionBulkModal";
import RackPositionFormModal from "../components/projects/RackPositionFormModal";
import TasksBulkUpdatePanel from "../components/projects/TasksBulkUpdatePanel";
import TasksCatalogAddModal from "../components/projects/TasksCatalogAddModal";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

export default function ProjectDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const projectId = Number(id);

  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [rackPositions, setRackPositions] = useState<RackPosition[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loading, setLoading] = useState(true);

  const [rackFormOpen, setRackFormOpen] = useState(false);
  const [rackBulkOpen, setRackBulkOpen] = useState(false);
  const [editingRack, setEditingRack] = useState<RackPosition | null>(null);

  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [taskCatalogOpen, setTaskCatalogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<ProjectTask | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [importingTasks, setImportingTasks] = useState(false);

  const canAddRack = hasPerm(user, PERMS.addRackPosition);
  const canChangeRack = hasPerm(user, PERMS.changeRackPosition);
  const canDeleteRack = hasPerm(user, PERMS.deleteRackPosition);
  const canAddTask = hasPerm(user, PERMS.addProjectTask);
  const canChangeTask = hasPerm(user, PERMS.changeProjectTask);
  const canDeleteTask = hasPerm(user, PERMS.deleteProjectTask);

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
    setSelectedTaskIds((prev) => (prev.length === tasks.length ? [] : tasks.map((t) => t.id)));
  }

  if (loading) return <p style={{ color: "var(--text-muted)" }}>Carregando...</p>;
  if (!project) return <p style={{ color: "var(--text-muted)" }}>Projeto não encontrado.</p>;

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
        <Info label="PO" value={project.po || "—"} />
        <Info label="Cliente" value={project.client_name || "—"} />
        <Info label="Site" value={project.site_name || "—"} />
        <Info label="Quantidade de Links" value={String(project.link_count)} />
        <Info label="Categoria" value={project.category_name || "Sem categoria"} />
        <Info label="Prazo previsto" value={project.planned_end ? new Date(project.planned_end + "T00:00:00").toLocaleDateString("pt-BR") : "—"} />
        <Info label="Tarefas" value={`${project.completed_tasks} / ${project.total_tasks}`} />
        <Info label="Progresso" value={`${project.progress_percent}%`} />
      </div>

      {project.has_rack_positions && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Rack Positions</h2>
            <div style={{ display: "flex", gap: 8 }}>
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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", margin: 0 }}>Tarefas</h2>
        {canAddTask && (
          <div style={{ display: "flex", gap: 8 }}>
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
          onApplied={() => {
            setSelectedTaskIds([]);
            reload();
          }}
        />
      )}

      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {(canChangeTask || canDeleteTask) && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={tasks.length > 0 && selectedTaskIds.length === tasks.length} onChange={toggleSelectAll} />
                  </th>
                )}
                <th>Tarefa</th>
                {project.has_rack_positions && <th>Rack Position</th>}
                <th>Status</th>
                <th>Colaboradores</th>
                {(canChangeTask || canDeleteTask) && <th>Ações</th>}
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  {(canChangeTask || canDeleteTask) && (
                    <td>
                      <input type="checkbox" checked={selectedTaskIds.includes(task.id)} onChange={() => toggleTaskSelection(task.id)} />
                    </td>
                  )}
                  <td>{task.task_name}</td>
                  {project.has_rack_positions && <td>{task.rack_position_labels.join(", ") || "—"}</td>}
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
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={project.has_rack_positions ? 6 : 5}>
                    <div className="table-empty">Nenhuma tarefa cadastrada.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

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
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-box">
      <div className="info-box-label">{label}</div>
      <div className="info-box-value">{value}</div>
    </div>
  );
}
