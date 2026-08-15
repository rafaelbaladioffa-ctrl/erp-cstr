import type { ReactElement } from "react";
import { useAuth } from "../context/AuthContext";
import { hasPerm } from "../utils/permissions";

export default function RequirePermission({
  permission,
  children,
}: {
  permission: string;
  children: ReactElement;
}) {
  const { user } = useAuth();
  if (!hasPerm(user, permission)) {
    return <p style={{ padding: 32, color: "#526174" }}>Você não tem permissão para acessar esta área.</p>;
  }
  return children;
}
