import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { projectsApi } from "../api/resources";
import type { Project } from "../api/types";

export default function ProjectsList() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (search) params.search = search;
    projectsApi
      .list(params)
      .then((data) => setProjects(data.results))
      .finally(() => setLoading(false));
  }, [search]);

  return (
    <div>
      <h1 style={{ fontSize: 22, color: "#172033", marginBottom: 16 }}>Projetos</h1>
      <input
        placeholder="Buscar por nome..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          padding: "10px 12px",
          borderRadius: 8,
          border: "1px solid #DDE3EA",
          width: 320,
          marginBottom: 16,
          fontSize: 14,
        }}
      />
      {loading ? (
        <p>Carregando...</p>
      ) : (
        <div style={{ background: "#fff", borderRadius: 12, overflow: "hidden", border: "1px solid #DDE3EA" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ background: "#F7F9FB", textAlign: "left" }}>
                <th style={th}>Código</th>
                <th style={th}>Nome</th>
                <th style={th}>Cliente</th>
                <th style={th}>Site</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id} style={{ borderTop: "1px solid #DDE3EA" }}>
                  <td style={td}>{project.code}</td>
                  <td style={td}>
                    <Link to={`/projetos/${project.id}`} style={{ color: "#F16023", fontWeight: 600 }}>
                      {project.name}
                    </Link>
                  </td>
                  <td style={td}>{project.client_name || "—"}</td>
                  <td style={td}>{project.site_name || "—"}</td>
                  <td style={td}>{project.status_display}</td>
                </tr>
              ))}
              {projects.length === 0 && (
                <tr>
                  <td style={td} colSpan={5}>
                    Nenhum projeto encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const th = { padding: "10px 14px", fontSize: 12, color: "#526174" };
const td = { padding: "10px 14px" };
