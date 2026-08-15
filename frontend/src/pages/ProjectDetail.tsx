import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { projectsApi } from "../api/resources";
import type { Project, ProjectTask } from "../api/types";

export default function ProjectDetail() {
  const { id } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([projectsApi.get(Number(id)), projectsApi.tasks(Number(id))])
      .then(([projectData, taskData]) => {
        setProject(projectData);
        setTasks(taskData);
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p>Carregando...</p>;
  if (!project) return <p>Projeto não encontrado.</p>;

  return (
    <div>
      <h1 style={{ fontSize: 22, color: "#172033", marginBottom: 4 }}>{project.name}</h1>
      <p style={{ color: "#526174", marginBottom: 20 }}>
        {project.code} · {project.status_display}
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        <Info label="PO" value={project.po || "—"} />
        <Info label="Cliente" value={project.client_name || "—"} />
        <Info label="Site" value={project.site_name || "—"} />
      </div>

      <h2 style={{ fontSize: 16, color: "#172033", marginBottom: 12 }}>Tarefas</h2>
      <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #DDE3EA" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
          <thead>
            <tr style={{ background: "#F7F9FB", textAlign: "left" }}>
              <th style={th}>Tarefa</th>
              <th style={th}>Status</th>
              <th style={th}>Colaboradores</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <tr key={task.id} style={{ borderTop: "1px solid #DDE3EA" }}>
                <td style={td}>{task.task_name}</td>
                <td style={td}>{task.status_display}</td>
                <td style={td}>{task.collaborators.map((c) => c.name).join(", ") || "—"}</td>
              </tr>
            ))}
            {tasks.length === 0 && (
              <tr>
                <td style={td} colSpan={3}>
                  Nenhuma tarefa cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #DDE3EA", borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 11, color: "#526174", fontWeight: 700, marginBottom: 4 }}>{label.toUpperCase()}</div>
      <div style={{ fontSize: 14, color: "#172033" }}>{value}</div>
    </div>
  );
}

const th = { padding: "10px 14px", fontSize: 12, color: "#526174" };
const td = { padding: "10px 14px" };
