import { useMemo, useState } from "react";
import EntityCrudPanel from "../../components/cadastros/EntityCrudPanel";
import Icon from "../../components/ui/Icon";
import PageHeader from "../../components/ui/PageHeader";
import { useAuth } from "../../context/AuthContext";
import { hasPerm } from "../../utils/permissions";
import type { ReferenceData } from "../cadastros/registryConfig";
import { MASTER_DATA_CATEGORIES } from "./masterDataConfig";

const EMPTY_REFS: ReferenceData = {
  companies: [],
  jobTitles: [],
  sites: [],
  clients: [],
  projectTypes: [],
  collaborators: [],
};

export default function MasterDataPage() {
  const { user } = useAuth();

  const categories = useMemo(
    () =>
      MASTER_DATA_CATEGORIES.map((cat) => ({
        ...cat,
        entities: cat.entities.filter((e) => hasPerm(user, e.perms.view)),
      })),
    [user]
  );

  const firstEntityKey = categories.find((c) => c.entities.length > 0)?.entities[0]?.key ?? null;
  const [activeKey, setActiveKey] = useState<string | null>(firstEntityKey);

  const activeEntity = useMemo(() => {
    for (const cat of categories) {
      const found = cat.entities.find((e) => e.key === activeKey);
      if (found) return found;
    }
    return null;
  }, [categories, activeKey]);

  const hasAnyEntity = categories.some((c) => c.entities.length > 0);

  return (
    <div>
      <PageHeader
        eyebrow="Sistema"
        title="Cadastros Mestres"
        subtitle="Base padronizada de dados técnicos e operacionais — fundação para escopos, tarefas e automações futuras."
      />

      {!hasAnyEntity && (
        <div className="empty-state">
          Seu usuário não tem permissão de visualização em nenhum Cadastro Mestre. Peça a um administrador para
          conceder acesso no grupo de permissões.
        </div>
      )}

      {hasAnyEntity && (
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
          <div className="card" style={{ width: 220, flexShrink: 0, padding: 8 }}>
            {categories.map((cat) => (
              <div key={cat.key} style={{ marginBottom: 6 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 10px 4px",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--text-faint)",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  <Icon name={cat.icon} style={{ fontSize: 14 }} />
                  {cat.label}
                </div>
                {cat.entities.length === 0 && (
                  <div style={{ padding: "2px 10px 6px", fontSize: 12, color: "var(--text-faint)" }}>Em breve</div>
                )}
                {cat.entities.map((entity) => (
                  <button
                    key={entity.key}
                    onClick={() => setActiveKey(entity.key)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      width: "100%",
                      padding: "8px 10px",
                      border: 0,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 13.5,
                      fontWeight: activeKey === entity.key ? 700 : 500,
                      color: activeKey === entity.key ? "var(--orange)" : "var(--text)",
                      background: activeKey === entity.key ? "var(--orange-soft)" : "transparent",
                      textAlign: "left",
                    }}
                  >
                    <Icon name={entity.icon} style={{ fontSize: 16 }} />
                    {entity.label}
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            {activeEntity ? (
              <EntityCrudPanel entity={activeEntity} refs={EMPTY_REFS} refsLoaded={true} />
            ) : (
              <div className="empty-state">Selecione um cadastro na lista ao lado.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
