import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { masterDataApi, sitesMapApi } from "../../api/resources";
import type { CableAlias, CableSpec } from "../../api/types";
import { useAuth } from "../../context/AuthContext";
import { PERMS, hasPerm } from "../../utils/permissions";
import type { EntityConfig, ReferenceData } from "../../pages/cadastros/registryConfig";
import BulkNamesModal from "../ui/BulkNamesModal";
import CsvImportModal from "../ui/CsvImportModal";
import DynamicForm, { type FormValues } from "../ui/DynamicForm";
import Icon from "../ui/Icon";
import Modal from "../ui/Modal";
import Pagination from "../ui/Pagination";

type ApiErrors = Record<string, string[]>;

/** Painel de CRUD genérico e reutilizável — tabela/busca/paginação/
 * modal de criação-edição/CSV/ativar-inativar — dirigido inteiramente por
 * um `EntityConfig`. Usado tanto por Cadastros Gerais quanto por
 * Cadastros Mestres, para não duplicar essa lógica entre os dois. */
export default function EntityCrudPanel({
  entity,
  refs,
  refsLoaded,
  onBack,
  autoOpenCreateNonce,
}: {
  entity: EntityConfig<any>;
  refs: ReferenceData;
  refsLoaded: boolean;
  onBack?: () => void;
  /** Muda de valor sempre que o catálogo pedir para abrir esta entidade já
   * com o modal de criação aberto ("Novo cadastro" > escolher o tipo). */
  autoOpenCreateNonce?: number;
}) {
  const { user } = useAuth();
  const canAdd = hasPerm(user, entity.perms.add);
  const canChange = hasPerm(user, entity.perms.change);
  const canDelete = hasPerm(user, entity.perms.delete);
  const canChangeSite = hasPerm(user, PERMS.changeSite);
  const statusField = entity.statusField ?? "is_active";
  const showActionsColumn = canChange || (canDelete && !entity.disableHardDelete);

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Só usado pela Família de Cabo: aliases e specs apontando para o
  // registro em edição, mostrados como seções somente-leitura no modal (o
  // equivalente mais próximo de "tela de detalhes" que este painel genérico
  // tem hoje — ver EntityConfig/masterDataConfig para o resto da entidade).
  const [familyAliases, setFamilyAliases] = useState<CableAlias[]>([]);
  const [familyAliasesLoading, setFamilyAliasesLoading] = useState(false);
  const [familySpecs, setFamilySpecs] = useState<CableSpec[]>([]);
  const [familySpecsLoading, setFamilySpecsLoading] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formValues, setFormValues] = useState<FormValues>({});
  const [formErrors, setFormErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [bulkCreateOpen, setBulkCreateOpen] = useState(false);
  const [regeocodingId, setRegeocodingId] = useState<number | null>(null);

  function reload() {
    setLoading(true);
    setLoadError(null);
    entity.api
      // page_size grande (o teto permitido pela API) porque este painel faz
      // busca/filtro/paginação no lado do cliente sobre `rows` — sem isso,
      // uma entidade com mais registros que o page_size padrão da API (25)
      // aparece truncada na primeira página, mesmo a contagem exibida
      // batendo com `rows.length` (nunca com o total real do backend).
      .list({ page_size: "500" })
      .then((data) => setRows(data.results))
      .catch(() => {
        // Nunca deixar a tabela anterior (de outra entidade) visível em
        // caso de falha — isso já causou confusão real: uma falha ao
        // trocar de aba deixava a listagem antiga na tela, parecendo
        // (incorretamente) que a nova entidade estava usando o dataset
        // errado.
        setRows([]);
        setLoadError(`Não foi possível carregar ${entity.label.toLowerCase()}. Tente novamente.`);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
    setSearch("");
    setFilterValues({});
    setPage(1);
    setCsvImportOpen(false);
    setBulkCreateOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity.key]);

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

  async function handleExportCsv() {
    const blob = await entity.api.exportCsv();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${entity.key}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const filtered = useMemo(() => {
    let result = rows;
    for (const filter of entity.filters ?? []) {
      const value = filterValues[filter.key];
      if (value) result = result.filter((row) => String(row[filter.key] ?? "") === value);
    }
    if (search) {
      const lower = search.toLowerCase();
      result = result.filter((row) => JSON.stringify(row).toLowerCase().includes(lower));
    }
    return result;
  }, [rows, search, filterValues, entity.filters]);

  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  function openCreate() {
    if (!canAdd) return;
    setEditingId(null);
    setFormValues(entity.emptyValues);
    setFormErrors({});
    setFamilyAliases([]);
    setFamilySpecs([]);
    setModalOpen(true);
  }

  useEffect(() => {
    if (autoOpenCreateNonce != null) openCreate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenCreateNonce]);

  function openEdit(row: Record<string, unknown>) {
    if (!canChange) return;
    setEditingId(row.id as number);
    setFormValues({ ...row });
    setFormErrors({});
    setModalOpen(true);
    if (entity.key === "cable-families") {
      setFamilyAliasesLoading(true);
      masterDataApi.cableAliases
        .list({ cable_family: String(row.id) })
        .then((data) => setFamilyAliases(data.results))
        .finally(() => setFamilyAliasesLoading(false));
      setFamilySpecsLoading(true);
      masterDataApi.cableSpecs
        .list({ cable_family: String(row.id) })
        .then((data) => setFamilySpecs(data.results))
        .finally(() => setFamilySpecsLoading(false));
    } else {
      setFamilyAliases([]);
      setFamilySpecs([]);
    }
  }

  async function handleSave() {
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
    if (!canDelete) return;
    const label = entity.rowLabel(row as never);
    if (!window.confirm(`Excluir "${label}"? Esta ação não pode ser desfeita.`)) return;
    await entity.api.remove(row.id as number);
    reload();
  }

  async function handleToggleActive(row: Record<string, unknown>) {
    if (!canChange) return;
    const label = entity.rowLabel(row as never);
    const isActive = !!row[statusField];
    const question = isActive
      ? `Inativar "${label}"? O registro deixa de aparecer como ativo, mas continua disponível para consultas históricas.`
      : `Reativar "${label}"?`;
    if (!window.confirm(question)) return;
    await entity.api.update(row.id as number, { [statusField]: !isActive } as never);
    reload();
  }

  const fields = refsLoaded ? entity.fields(refs) : [];

  return (
    <div>
      {onBack && (
        <button
          onClick={onBack}
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
          Voltar
        </button>
      )}

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
          {entity.filters?.map((filter) => (
            <select
              key={filter.key}
              className="select"
              style={{ maxWidth: 220 }}
              value={filterValues[filter.key] ?? ""}
              onChange={(e) => {
                setFilterValues((prev) => ({ ...prev, [filter.key]: e.target.value }));
                setPage(1);
              }}
            >
              <option value="">{filter.label}</option>
              {filter.options(refs, rows).map((opt) => (
                <option key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </option>
              ))}
            </select>
          ))}
        </div>

        {loadError && (
          <p style={{ padding: "0 20px 12px", color: "var(--red)", fontSize: 13.5 }}>{loadError}</p>
        )}

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
                  {showActionsColumn && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => (
                  <tr key={row.id as number}>
                    {entity.columns.map((col) => (
                      <td key={col.key}>
                        {col.render ? col.render(row as never) : String((row[col.key] as string | number) ?? "—") || "—"}
                      </td>
                    ))}
                    <td>
                      <span
                        className="badge"
                        style={{
                          background: row[statusField] ? "var(--green-soft)" : "#eef1f6",
                          color: row[statusField] ? "var(--green)" : "var(--text-muted)",
                        }}
                      >
                        {row[statusField] ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    {showActionsColumn && (
                      <td>
                        <div style={{ display: "flex", gap: 8 }}>
                          {canChange && (
                            <button className="btn btn-outline btn-sm" onClick={() => openEdit(row)}>
                              <Icon name="edit" style={{ fontSize: 14 }} />
                            </button>
                          )}
                          {entity.disableHardDelete
                            ? canChange && (
                                <button
                                  className="btn btn-outline btn-sm"
                                  onClick={() => handleToggleActive(row)}
                                  title={row[statusField] ? "Inativar" : "Reativar"}
                                >
                                  <Icon name={row[statusField] ? "toggle_on" : "toggle_off"} style={{ fontSize: 14 }} />
                                </button>
                              )
                            : canDelete && (
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
          {editingId && entity.key === "cable-families" && (
            <div style={{ marginTop: 8, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Aliases ({familyAliases.length})
              </div>
              {familyAliasesLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando...</p>
              ) : familyAliases.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Nenhum alias cadastrado para esta família ainda.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {familyAliases.map((a) => (
                    <li key={a.id}>
                      {a.alias}
                      {a.alias_type ? ` (${a.alias_type})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {editingId && entity.key === "cable-families" && (
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--text-faint)",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  marginBottom: 8,
                }}
              >
                Especificações ({familySpecs.length})
              </div>
              {familySpecsLoading ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando...</p>
              ) : familySpecs.length === 0 ? (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Nenhuma especificação cadastrada para esta família ainda.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                  {familySpecs.map((s) => (
                    <li key={s.id}>
                      {s.code}
                      {s.part_number ? ` (${s.part_number})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
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

      {csvImportOpen && canAdd && (
        <CsvImportModal
          title={`Importar ${entity.label} via CSV`}
          onClose={() => setCsvImportOpen(false)}
          onImport={entity.api.importCsv}
          onImported={reload}
        />
      )}

      {bulkCreateOpen && canAdd && entity.bulkCreate && refsLoaded && (
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
