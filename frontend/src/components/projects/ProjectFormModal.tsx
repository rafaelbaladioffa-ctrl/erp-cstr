import { useEffect, useMemo, useState } from "react";
import { projectsApi, registryApi } from "../../api/resources";
import type {
  Category,
  ClientFull,
  ClientResponsibleFull,
  Company,
  Project,
  ProjectType,
  ResponsibleFull,
  SiteFull,
} from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "not_started", label: "Não Iniciado" },
  { value: "in_progress", label: "Ativo" },
  { value: "paused", label: "Pausado" },
  { value: "completed", label: "Concluído" },
  { value: "canceled", label: "Cancelado" },
];

type ApiErrors = Record<string, string[]>;

export default function ProjectFormModal({
  project,
  onClose,
  onSaved,
}: {
  project: Project | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<ClientFull[]>([]);
  const [sites, setSites] = useState<SiteFull[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleFull[]>([]);
  const [clientResponsibles, setClientResponsibles] = useState<ClientResponsibleFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [values, setValues] = useState<FormValues>(
    project
      ? { ...project }
      : {
          company: null, name: "", po: "", link_count: 0, client: null, site: null, category: null,
          project_type: null, responsible_cstr: null, responsible_client: null, status: "planning",
          planned_start: null, planned_end: null, description: "", notes: "", is_active: true,
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Promise.allSettled (em vez de Promise.all): se o usuário não tiver
    // permissão de visualização em um desses models (ex: sem
    // core.view_responsible), só aquele dropdown fica vazio — os demais,
    // para os quais ele tem permissão, continuam carregando normalmente.
    Promise.allSettled([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.categories.list({ page_size: "200" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.responsibles.list({ page_size: "200" } as never),
      registryApi.clientResponsibles.list({ page_size: "500" } as never),
    ])
      .then(([c, cl, s, cat, pt, resp, clResp]) => {
        if (c.status === "fulfilled") setCompanies(c.value.results);
        if (cl.status === "fulfilled") setClients(cl.value.results);
        if (s.status === "fulfilled") setSites(s.value.results);
        if (cat.status === "fulfilled") setCategories(cat.value.results);
        if (pt.status === "fulfilled") setProjectTypes(pt.value.results);
        if (resp.status === "fulfilled") setResponsibles(resp.value.results);
        if (clResp.status === "fulfilled") setClientResponsibles(clResp.value.results);
      })
      .finally(() => setLoadingRefs(false));
  }, []);

  const fields: FieldConfig[] = useMemo(() => {
    const selectedClientId = values.client as number | null;
    return [
      { name: "name", label: "Nome do Projeto", type: "text", required: true, span: 2 },
      { name: "po", label: "PO", type: "text" },
      { name: "link_count", label: "Quantidade de Links", type: "number" },
      { name: "company", label: "Empresa", type: "select", required: true, options: companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name })) },
      { name: "status", label: "Status", type: "select", required: true, options: STATUS_OPTIONS },
      { name: "client", label: "Cliente", type: "select", options: clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name })) },
      { name: "site", label: "Site", type: "select", options: sites.map((s) => ({ value: s.id, label: s.code || s.name })) },
      { name: "project_type", label: "Tipo de Projeto", type: "select", options: projectTypes.map((p) => ({ value: p.id, label: p.name })) },
      { name: "category", label: "Categoria", type: "select", options: categories.map((c) => ({ value: c.id, label: c.name })) },
      { name: "responsible_cstr", label: "Responsável CSTR", type: "select", options: responsibles.map((r) => ({ value: r.id, label: r.name })) },
      {
        name: "responsible_client",
        label: "Responsável Cliente",
        type: "select",
        options: clientResponsibles.filter((r) => !selectedClientId || r.client === selectedClientId).map((r) => ({ value: r.id, label: r.name })),
      },
      { name: "planned_start", label: "Início Previsto", type: "date" },
      { name: "planned_end", label: "Término Previsto", type: "date" },
      { name: "description", label: "Descrição", type: "textarea", span: 2 },
      { name: "notes", label: "Observações", type: "textarea", span: 2 },
      { name: "is_active", label: "Situação", type: "checkbox", placeholder: "Ativo", span: 2 },
    ];
  }, [companies, clients, sites, categories, projectTypes, responsibles, clientResponsibles, values.client]);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (project) {
        await projectsApi.update(project.id, values);
      } else {
        await projectsApi.create(values);
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={project ? `Editar Projeto — ${project.code}` : "Novo Projeto"} onClose={onClose} width={720}>
      {loadingRefs ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          <DynamicForm
            fields={fields}
            values={values}
            errors={errors}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          />
          {errors.non_field_errors && (
            <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 8 }}>
            <button className="btn btn-outline" onClick={onClose}>
              Cancelar
            </button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
