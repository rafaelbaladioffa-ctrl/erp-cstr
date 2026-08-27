import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { registryApi, sitesMapApi } from "../../api/resources";
import BulkNamesModal from "../../components/ui/BulkNamesModal";
import CsvImportModal from "../../components/ui/CsvImportModal";
import DynamicForm, { type FormValues } from "../../components/ui/DynamicForm";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import Pagination from "../../components/ui/Pagination";
import { useAuth } from "../../context/AuthContext";
import { PERMS, hasPerm } from "../../utils/permissions";
import CatalogGrid, { type RecentRecord } from "./CatalogGrid";
import { ENTITIES, type ReferenceData } from "./registryConfig";

type ApiErrors = Record<string, string[]>;

export default function CadastrosPage() {
  const { user } = useAuth();
  const visibleEntities = useMemo(() => ENTITIES.filter((e) => hasPerm(user, e.perms.view)), [user]);

  const [view, setView] = useState<"catalog" | "entity">("catalog");
  const [activeKey, setActiveKey] = useState(visibleEntities[0]?.key ?? "");
  const [refs, setRefs] = useState<ReferenceData>({
    companies: [], jobTitles: [], sites: [], clients: [], projectTypes: [], collaborators: [],
  });
  const [refsLoaded, setRefsLoaded] = useState(false);

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const [recentLoading, setRecentLoading] = useState(true);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [regeocodingId, setRegeocodingId] = useState<number | null>(null);
  const canChangeSite = hasPerm(user, PERMS.changeSite);

  async function handleRegeocode(siteId: number) {
    setRegeocodingId(siteId);
    try {
      await sitesMapApi.regeocode(siteId);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      alert(axiosErr.response?.data?.detail || "Não foi possível regeocodificar este site.");
    } finally {
      setRegeocodingId(null);
    }
  }

  const entity = useMemo(
    () => visibleEntities.find((e) => e.key === activeKey) ?? visibleEntities[0],
    [activeKey, visibleEntities]
  );

  const canAdd = entity ? hasPerm(user, entity.perms.add) : false;
  const canChange = entity ? hasPerm(user, entity.perms.change) : false;
  const canDelete = entity ? hasPerm(user, entity.perms.delete) : false;

  useEffect(() => {
    // Promise.allSettled: falta de permissão de visualização em um desses
    // models (ex: sem core.view_collaborator) não deve impedir os campos
    // de outras abas para as quais o usuário tem permissão de carregar.
    Promise.allSettled([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.jobTitles.list({ page_size: "200" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.collaborators.list({ page_size: "500" } as never),
    ])
      .then(([companies, jobTitles, sites, clients, projectTypes, collaborators]) => {
        setRefs({
          companies: companies.status === "fulfilled" ? companies.value.results : [],
          jobTitles: jobTitles.status === "fulfilled" ? jobTitles.value.results : [],
          sites: sites.status === "fulfilled" ? sites.value.results : [],
          clients: clients.status === "fulfilled" ? clients.value.results : [],
          projectTypes: projectTypes.status === "fulfilled" ? projectTypes.value.results : [],
          collaborators: collaborators.status === "fulfilled" ? collaborators.value.results : [],
        });
      })
      .finally(() => setRefsLoaded(true));
  }, []);

  useEffect(() => {
    // Catálogo: contagem por entidade + registros recentes (mais atualizados
    // primeiro, entre todas as entidades visíveis).
    let cancelled = false;
    setRecentLoading(true);
    Promise.allSettled(
      visibleEntities.map((e) => e.api.list({ page_size: "5", ordering: "-updated_at" } as never))
    ).then((results) => {
      if (cancelled) return;
      const nextCounts: Record<string, number | null> = {};
      const merged: RecentRecord[] = [];
      results.forEach((result, index) => {
        const e = visibleEntities[index];
        if (result.status !== "fulfilled") {
          nextCounts[e.key] = null;
          return;
        }
        nextCounts[e.key] = result.value.count;
        result.value.results.forEach((row) => {
          const r = row as Record<string, unknown>;
          merged.push({
            entityKey: e.key,
            entityLabel: e.label,
            icon: e.icon,
            name: e.rowLabel(r as never),
            code: (r.code as string) || "",
            isActive: r.is_active !== false,
            updatedAt: (r.updated_at as string) || null,
          });
        });
      });
      merged.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
      setCounts(nextCounts);
      setRecentRecords(merged.slice(0, 8));
      setRecentLoading(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function reload() {
    if (!entity) return;
    setLoading(true);
    entity.api
      .list()
      .then((data) => setRows(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (view !== "entity") return;
    reload();
    setSearch("");
    setPage(1);
    setCsvImportOpen(false);
    setBulkCreateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity?.key, view]);

  function openCatalog() {
    setView("catalog");
  }

  function openEntity(key: string) {
    setActiveKey(key);
    setView("entity");
  }

  function quickCreate(key: string) {
    const target = visibleEntities.find((e) => e.key === key);
    if (!target || !hasPerm(user, target.perms.add)) return;
    setActiveKey(key);
    setView("entity");
    setEditingId(null);
    setFormValues(target.emptyValues);
    setFormErrors({});
    setModalOpen(true);
  }

  async function handleExportCsv() {
    if (!entity) return;
    const blob = await entity.api.exportCsv();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${entity.key}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    if (!search) return rows;
    const lower = search.toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(lower));
  }, [rows, search]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    if (!entity || !canAdd) return;
    setEditingId(null);
    setFormValues(entity.emptyValues);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(row: Record<string, unknown>) {
    if (!entity || !canChange) return;
    setEditingId(row.id as number);
    setFormValues({ ...row });
    setFormErrors({});
    setModalOpen(true);
  }

  async function handleSave() {
    if (!entity) return;
    if (editingId && !canChange) return;
    if (!editingId && !canAdd) return;
    setSaving(true);
    setFormErrors({});
    try {
      if (editingId) {
        await entity.api.update(editingId, formValues);
      } else {
        await entity.api.create(formValues);
      }
      setModalOpen(false);
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setFormErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(row: Record<string, unknown>) {
    if (!entity || !canDelete) return;
    const label = entity.rowLabel(row as never);
    if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
    await entity.api.remove(row.id as number);
    reload();
  }

  const fields = refsLoaded && entity ? entity.fields(refs) : [];

  if (!entity) {
    return (
      <div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "var(--text)", marginBottom: 16 }}>Cadastros Gerais</div>
        <div className="empty-state">
          Seu usuário não tem permissão de visualização em nenhum cadastro. Peça a um administrador para
          conceder acesso no grupo de permissões.
        </div>
      </div>
    );
  }

  if (view === "catalog") {
    return (
      <CatalogGrid
        entities={visibleEntities}
        counts={counts}
        recentRecords={recentLoading ? [] : recentRecords}
        onSelect={openEntity}
        onQuickCreate={quickCreate}
      />
    );
  }

  return (
    <div>
      <button
        onClick={openCatalog}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: "var(--text-muted)",
          background: "none",
          border: 0,
          cursor: "pointer",
          fontSize: 13,
          marginBottom: 12,
          padding: 0,
        }}
      >
        <Icon name="arrow_back" style={{ fontSize: 16 }} />
        Voltar ao catálogo
      </button>

      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{entity.label}</div>
            <div className="toolbar-subtitle">{filtered.length} registro(s) encontrado(s)</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {entity.key === "sites" && (
              <Link to="/sites/mapa" className="btn btn-outline">
                <Icon name="map" style={{ fontSize: 16 }} />
                Ver Mapa
              </Link>
            )}
            <button className="btn btn-outline" onClick={handleExportCsv}>
              <Icon name="download" style={{ fontSize: 16 }} />
              Exportar CSV
            </button>
            {canAdd && (
              <button className="btn btn-outline" onClick={() => setCsvImportOpen(true)}>
                <Icon name="upload" style={{ fontSize: 16 }} />
                Importar CSV
              </button>
            )}
            {canAdd && entity.bulkCreate && (
              <button className="btn btn-outline" onClick={() => setBulkCreateOpen(true)}>
                <Icon name="playlist_add" style={{ fontSize: 16 }} />
                {entity.bulkCreate.label}
              </button>
            )}
            {canAdd && (
              <button className="btn btn-primary" onClick={openCreate}>
                <Icon name="add" style={{ fontSize: 18 }} />
                {entity.createLabel}
              </button>
            )}
          </div>
        </div>

        <div className="filter-row">
          <div className="search-input-wrap" style={{ flex: 1 }}>
            <Icon name="search" />
            <input
              className="input"
              placeholder={`Buscar em ${entity.label.toLowerCase()}...`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>

        {loading ? (
          <p style={{ padding: 20, color: "var(--text-muted)" }}>Carregando...</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {entity.columns.map((col) => (
                    <th key={col.key}>{col.label}</th>
                  ))}
                  <th>Situação</th>
                  {(canChange || canDelete) && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id as number}>
                    {entity.columns.map((col) => (
                      <td key={col.key}>{String((row[col.key] as string | number) ?? "—") || "—"}</td>
                    ))}
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: row.is_active ? "var(--green-soft)" : "#eef1f6",
                          color: row.is_active ? "var(--green)" : "var(--text-muted)",
                        }}
                      >
                        {row.is_active ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    {(canChange || canDelete) && (
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          {canChange && (
                            <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>
                              <Icon name="edit" style={{ fontSize: 14 }} />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleDelete(row)}
                              style={{ color: "var(--red)" }}
                            >
                              <Icon name="delete" style={{ fontSize: 14 }} />
                            </button>
                          )}
                          {entity.key === "sites" && canChangeSite && !row.manual_coordinates && (
                            <button
                              className="btn btn-outline btn-sm"
                              onClick={() => handleRegeocode(row.id as number)}
                              disabled={regeocodingId === row.id}
                              title="Regeocodificar"
                            >
                              <Icon name="my_location" style={{ fontSize: 14 }} />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr>
                    <td colSpan={entity.columns.length + 2}>
                      <div className="table-empty">Nenhum registro encontrado.</div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      </div>

      {modalOpen && (editingId ? canChange : canAdd) && (
        <Modal
          title={editingId ? `Editar ${entity.singular}` : entity.createLabel}
          onClose={() => setModalOpen(false)}
          width={620}
        >
          <DynamicForm
            fields={fields}
            values={formValues}
            errors={formErrors}
            onChange={(name, value) => setFormValues((prev) => ({ ...prev, [name]: value }))}
          />
          {formErrors.non_field_errors && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{formErrors.non_field_errors.join(" ")}</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </Modal>
      )}

      {csvImportOpen && entity && canAdd && (
        <CsvImportModal
          title={`Importar ${entity.label} via CSV`}
          onClose={() => setCsvImportOpen(false)}
          onImport={entity.api.importCsv}
          onImported={reload}
        />
      )}

      {bulkCreateOpen && entity && canAdd && entity.bulkCreate && refsLoaded && (
        <BulkNamesModal
          title={`${entity.bulkCreate.label} — ${entity.label}`}
          helpText={entity.bulkCreate.helpText}
          extraFields={entity.bulkCreate.extraFields(refs)}
          extraValues={entity.bulkCreate.extraValues(refs)}
          onSave={entity.bulkCreate.api}
          onClose={() => setBulkCreateOpen(false)}
          onSaved={() => {
            setBulkCreateOpen(false);
            reload();
          }}
        />
      )}
    </div>
  );
}
