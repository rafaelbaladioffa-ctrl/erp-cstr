import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { projectsApi } from "../api/resources";
import type { Project, ProjectTask, RackPosition } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatusBadge from "../components/ui/StatusBadge";

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [rackPositions, setRackPositions] = useState<RackPosition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([projectsApi.get(Number(id)), projectsApi.tasks(Number(id))])
      .then(([projectData, taskData]) => {
        setProject(projectData);
        setTasks(taskData);
        if (projectData.has_rack_positions) {
          projectsApi.rackPositions(Number(id)).then(setRackPositions);
        } else {
          setRackPositions([]);
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

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
          <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>Rack Positions</h2>
          <div className="card" style={{ marginBottom: 24 }}>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rack Position</th>
                    <th>DH</th>
                    <th>Links</th>
                    <th>UTP</th>
                  </tr>
                </thead>
                <tbody>
                  {rackPositions.map((rp) => (
                    <tr key={rp.id}>
                      <td>{rp.position}</td>
                      <td>{rp.dh || "—"}</td>
                      <td>{rp.links}</td>
                      <td>{rp.utp}</td>
                    </tr>
                  ))}
                  {rackPositions.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <div className="table-empty">
                          Nenhuma Rack Position cadastrada ainda. Cadastre individualmente ou em massa na edição
                          do projeto no Admin.
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

      <h2 style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 12 }}>Tarefas</h2>
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Tarefa</th>
                {project.has_rack_positions && <th>Rack Position</th>}
                <th>Status</th>
                <th>Colaboradores</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td>{task.task_name}</td>
                  {project.has_rack_positions && <td>{task.rack_position_labels.join(", ") || "—"}</td>}
                  <td>
                    <StatusBadge status={task.status} label={task.status_display} />
                  </td>
                  <td>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={project.has_rack_positions ? 4 : 3}>
                    <div className="table-empty">Nenhuma tarefa cadastrada.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
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
