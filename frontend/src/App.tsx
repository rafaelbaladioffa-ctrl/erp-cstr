import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import ProtectedRoute from "./components/ProtectedRoute";
import RequirePermission from "./components/RequirePermission";
import { AuthProvider, useAuth } from "./context/AuthContext";
import DailyUpdates from "./pages/DailyUpdates";
import Login from "./pages/Login";
import MyTasks from "./pages/MyTasks";
import ProjectDetail from "./pages/ProjectDetail";
import ProjectsList from "./pages/ProjectsList";
import ProjectUpdates from "./pages/ProjectUpdates";
import { PERMS, hasPerm } from "./utils/permissions";

function HomeRedirect() {
  const { user } = useAuth();
  if (hasPerm(user, PERMS.viewProject)) return <Navigate to="/projetos" replace />;
  if (hasPerm(user, PERMS.viewDailyUpdate)) return <Navigate to="/atualizacoes-diarias" replace />;
  if (hasPerm(user, PERMS.viewProjectUpdate)) return <Navigate to="/atualizacoes-projeto" replace />;
  if (hasPerm(user, PERMS.viewMyTasks)) return <Navigate to="/minhas-tarefas" replace />;
  return <p style={{ padding: 32, color: "#526174" }}>Seu usuário não tem acesso a nenhum módulo.</p>;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<HomeRedirect />} />
          <Route
            path="/projetos"
            element={
              <RequirePermission permission={PERMS.viewProject}>
                <ProjectsList />
              </RequirePermission>
            }
          />
          <Route
            path="/projetos/:id"
            element={
              <RequirePermission permission={PERMS.viewProject}>
                <ProjectDetail />
              </RequirePermission>
            }
          />
          <Route
            path="/atualizacoes-diarias"
            element={
              <RequirePermission permission={PERMS.viewDailyUpdate}>
                <DailyUpdates />
              </RequirePermission>
            }
          />
          <Route
            path="/atualizacoes-projeto"
            element={
              <RequirePermission permission={PERMS.viewProjectUpdate}>
                <ProjectUpdates />
              </RequirePermission>
            }
          />
          <Route
            path="/minhas-tarefas"
            element={
              <RequirePermission permission={PERMS.viewMyTasks}>
                <MyTasks />
              </RequirePermission>
            }
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
