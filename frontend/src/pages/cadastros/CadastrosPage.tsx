import { useEffect, useMemo, useState } from "react";
import { registryApi } from "../../api/resources";
import DynamicForm, { type FormValues } from "../../components/ui/DynamicForm";
import Icon from "../../components/ui/Icon";
import Modal from "../../components/ui/Modal";
import PageHeader from "../../components/ui/PageHeader";
import Pagination from "../../components/ui/Pagination";
import { ENTITIES, type ReferenceData } from "./registryConfig";

type ApiErrors = Record<string, string[]>;

export default function CadastrosPage() {
  const [activeKey, setActiveKey] = useState(ENTITIES[0].key);
  const [refs, setRefs] = useState<ReferenceData>({
    companies: [], jobTitles: [], sites: [], clients: [], projectTypes: [], collaborators: [],
  });
  const [refsLoaded, setRefsLoaded] = useState(false);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  const entity = useMemo(() => ENTITIES.find((e) => e.key === activeKey)!, [activeKey]);

  useEffect(() => {
    Promise.all([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.jobTitles.list({ page_size: "200" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.collaborators.list({ page_size: "500" } as never),
    ])
      .then(([companies, jobTitles, sites, clients, projectTypes, collaborators]) => {
        setRefs({
          companies: companies.results,
          jobTitles: jobTitles.results,
          sites: sites.results,
          clients: clients.results,
          projectTypes: projectTypes.results,
          collaborators: collaborators.results,
        });
      })
      .finally(() => setRefsLoaded(true));
  }, []);

  function reload() {
    setLoading(true);
    entity.api
      .list()
      .then((data) => setRows(data.results))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    setSearch("");
    setPage(1);
  }, [activeKey]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const lower = search.toLowerCase();
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(lower));
  }, [rows, search]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    setEditingId(null);
    setFormValues(entity.emptyValues);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(row: Record<string, unknown>) {
    setEditingId(row.id as number);
    setFormValues({ ...row });
    setFormErrors({});
    setModalOpen(true);
  }

  async function handleSave() {
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
    const label = entity.rowLabel(row as never);
    if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
    await entity.api.remove(row.id as number);
    reload();
  }

  const fields = refsLoaded ? entity.fields(refs) : [];

  return (
    <div>
      <PageHeader
        eyebrow="Base de Dados"
        title="Cadastros Gerais"
        subtitle="Gerencie empresas, clientes, sites, colaboradores e demais cadastros do sistema."
      />

      <div className="tabs" style={{ flexWrap: "wrap", rowGap: 4 }}>
        {ENTITIES.map((e) => (
          <button
            key={e.key}
            className={`tab-btn${activeKey === e.key ? " active" : ""}`}
            onClick={() => setActiveKey(e.key)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <Icon name={e.icon} style={{ fontSize: 16 }} />
            {e.label}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">{entity.label}</div>
            <div className="toolbar-subtitle">{filtered.length} registro(s) encontrado(s)</div>
          </div>
          <button className="btn btn-primary" onClick={openCreate}>
            <Icon name="add" style={{ fontSize: 18 }} />
            {entity.createLabel}
          </button>
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
                  <th>Ações</th>
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
                    <td>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>
                          <Icon name="edit" style={{ fontSize: 14 }} />
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => handleDelete(row)} style={{ color: "var(--red)" }}>
                          <Icon name="delete" style={{ fontSize: 14 }} />
                        </button>
                      </div>
                    </td>
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

        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={() => {}} />
      </div>

      {modalOpen && (
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
    </div>
  );
}
