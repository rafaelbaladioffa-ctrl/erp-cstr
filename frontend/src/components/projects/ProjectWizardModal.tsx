import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { projectsApi, registryApi } from "../../api/resources";
import type { Category, ClientFull, Company, Project, ProjectType, ResponsibleFull, SiteFull } from "../../api/types";
import Icon from "../ui/Icon";
import Modal from "../ui/Modal";

// ---------------------------------------------------------------------------
// Barra de progresso
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, label: "Identificação" },
  { n: 2, label: "Classificação" },
  { n: 3, label: "Planejamento" },
];

function StepBar({ current }: { current: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", marginBottom: 24, gap: 0 }}>
      {STEPS.map((s, i) => (
        <Fragment key={s.n}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
            <div
              style={{
                width: 32, height: 32, borderRadius: "50%", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700,
                background: s.n < current ? "var(--green)" : s.n === current ? "var(--orange)" : "var(--surface-2, #eee)",
                color: s.n <= current ? "#fff" : "var(--text-faint)",
                transition: "background 0.2s",
              }}
            >
              {s.n < current ? <Icon name="check" style={{ fontSize: 16 }} /> : s.n}
            </div>
            <div
              style={{
                fontSize: 11, marginTop: 4, textAlign: "center", whiteSpace: "nowrap",
                color: s.n === current ? "var(--orange)" : s.n < current ? "var(--green)" : "var(--text-faint)",
                fontWeight: s.n === current ? 700 : 400,
              }}
            >
              {s.label}
            </div>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex: 2, height: 2, marginBottom: 18, background: s.n < current ? "var(--green)" : "var(--border, #ddd)", transition: "background 0.2s" }} />
          )}
        </Fragment>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tipos internos
// ---------------------------------------------------------------------------

type FormValues = {
  name: string;
  po: string;
  company: number | "";
  client: number | "";
  site: number | "";
  project_type: number | "";
  category: number | "";
  status: string;
  has_rack_positions: boolean;
  link_count: number | "";
  responsible_cstr: number | "";
  responsible_client: number | "";
  planned_start: string;
  planned_end: string;
  description: string;
  notes: string;
};

const INITIAL: FormValues = {
  name: "", po: "", company: "", client: "", site: "",
  project_type: "", category: "", status: "planning",
  has_rack_positions: false, link_count: "",
  responsible_cstr: "", responsible_client: "",
  planned_start: "", planned_end: "", description: "", notes: "",
};

const STATUS_OPTIONS = [
  { value: "planning", label: "Planejamento" },
  { value: "not_started", label: "Não Iniciado" },
  { value: "in_progress", label: "Ativo" },
  { value: "paused", label: "Pausado" },
];

type ApiErrors = Record<string, string[]>;

// ---------------------------------------------------------------------------
// Componentes de campo reutilizáveis
// ---------------------------------------------------------------------------

function Field({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) {
  return (
    <div className="field-group">
      <span className="field-label">{label}{required && <span style={{ color: "var(--red)", marginLeft: 2 }}>*</span>}</span>
      {children}
      {error && <span style={{ color: "var(--red)", fontSize: 12 }}>{error}</span>}
    </div>
  );
}

function SelectField({ label, required, error, value, onChange, options, placeholder = "— selecione —" }: {
  label: string; required?: boolean; error?: string;
  value: number | ""; onChange: (v: number | "") => void;
  options: { value: number; label: string }[]; placeholder?: string;
}) {
  return (
    <Field label={label} required={required} error={error}>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : "")}>
        <option value="">{placeholder}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </Field>
  );
}

// ---------------------------------------------------------------------------
// Wizard principal
// ---------------------------------------------------------------------------

export default function ProjectWizardModal({ onClose, onSaved }: { onClose: () => void; onSaved: (project: Project) => void }) {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [values, setValues] = useState<FormValues>(INITIAL);
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);
  const [savedProject, setSavedProject] = useState<Project | null>(null);

  // Referências
  const [companies, setCompanies] = useState<Company[]>([]);
  const [clients, setClients] = useState<ClientFull[]>([]);
  const [sites, setSites] = useState<SiteFull[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [projectTypes, setProjectTypes] = useState<ProjectType[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleFull[]>([]);
  const [clientResponsibles, setClientResponsibles] = useState<ResponsibleFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      registryApi.companies.list({ page_size: "200" } as never),
      registryApi.clients.list({ page_size: "500" } as never),
      registryApi.sites.list({ page_size: "500" } as never),
      registryApi.categories.list({ page_size: "200" } as never),
      registryApi.projectTypes.list({ page_size: "200" } as never),
      registryApi.responsibles.list({ page_size: "200", kind: "cstr" } as never),
      registryApi.responsibles.list({ page_size: "500", kind: "client" } as never),
    ]).then(([c, cl, s, cat, pt, resp, clResp]) => {
      if (c.status === "fulfilled") setCompanies(c.value.results);
      if (cl.status === "fulfilled") setClients(cl.value.results);
      if (s.status === "fulfilled") setSites(s.value.results);
      if (cat.status === "fulfilled") setCategories(cat.value.results);
      if (pt.status === "fulfilled") setProjectTypes(pt.value.results);
      if (resp.status === "fulfilled") setResponsibles(resp.value.results);
      if (clResp.status === "fulfilled") setClientResponsibles(clResp.value.results);
    }).finally(() => setLoadingRefs(false));
  }, []);

  function set<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((prev) => {
      const next = { ...prev, [key]: value };
      if (key === "client") {
        const newClientId = value as number | "";
        const currentSite = sites.find((s) => s.id === prev.site);
        if (currentSite && currentSite.client !== newClientId) next.site = "";
        const currentResp = clientResponsibles.find((r) => r.id === prev.responsible_client);
        if (currentResp && currentResp.client !== newClientId) next.responsible_client = "";
      }
      return next;
    });
  }

  const filteredSites = useMemo(
    () => sites.filter((s) => !values.client || s.client === values.client),
    [sites, values.client]
  );

  const filteredClientResp = useMemo(
    () => clientResponsibles.filter((r) => !values.client || r.client === values.client),
    [clientResponsibles, values.client]
  );

  // Validação por passo
  function validateStep1() {
    const e: ApiErrors = {};
    if (!values.name.trim()) e.name = ["Nome é obrigatório."];
    if (!values.company) e.company = ["Empresa é obrigatória."];
    return e;
  }

  function goNext() {
    if (step === 1) {
      const e = validateStep1();
      if (Object.keys(e).length) { setErrors(e); return; }
    }
    setErrors({});
    setStep((s) => s + 1);
  }

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      const payload = {
        ...values,
        company: values.company || null,
        client: values.client || null,
        site: values.site || null,
        project_type: values.project_type || null,
        category: values.category || null,
        responsible_cstr: values.responsible_cstr || null,
        responsible_client: values.responsible_client || null,
        link_count: values.link_count === "" ? 0 : values.link_count,
        planned_start: values.planned_start || null,
        planned_end: values.planned_end || null,
      };
      const created = await projectsApi.create(payload as never) as Project;
      setSavedProject(created);
      onSaved(created);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) {
        setErrors(axiosErr.response.data);
      }
    } finally {
      setSaving(false);
    }
  }

  const errFirst = (field: string) => errors[field]?.[0];

  // ---------------------------------------------------------------------------
  // Tela de sucesso
  // ---------------------------------------------------------------------------

  if (savedProject) {
    return (
      <Modal title="Projeto criado!" onClose={onClose} width={560}>
        <div style={{ textAlign: "center", padding: "8px 0 24px" }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>🎉</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>{savedProject.code}</div>
          <div style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 28 }}>{savedProject.name}</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}>
            <button
              className="btn btn-outline"
              onClick={() => navigate(`/projetos/${savedProject.id}`)}
            >
              <Icon name="open_in_new" style={{ fontSize: 16, marginRight: 6 }} />
              Ir para o projeto
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                onClose();
                navigate(`/cadastros-mestres?focusEntity=sow-wizard`);
              }}
            >
              <Icon name="upload_file" style={{ fontSize: 16, marginRight: 6 }} />
              Importar SOW
            </button>
          </div>
          <button className="btn btn-outline" style={{ marginTop: 10 }} onClick={onClose}>
            Fechar
          </button>
        </div>
      </Modal>
    );
  }

  // ---------------------------------------------------------------------------
  // Wizard
  // ---------------------------------------------------------------------------

  return (
    <Modal title="Novo Projeto" onClose={onClose} width={680}>
      <StepBar current={step} />

      {loadingRefs && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Carregando...</p>}

      {!loadingRefs && (
        <>
          {/* ================================================================
              PASSO 1 — IDENTIFICAÇÃO
          ================================================================ */}
          {step === 1 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                Preencha as informações essenciais para identificar o projeto.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Nome do Projeto" required error={errFirst("name")}>
                    <input className="input" value={values.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex: GRU65 — Fase 2 — Cabeamento Óptico" />
                  </Field>
                </div>
                <Field label="PO" error={errFirst("po")}>
                  <input className="input" value={values.po} onChange={(e) => set("po", e.target.value)} placeholder="Número da PO" />
                </Field>
                <SelectField label="Empresa" required error={errFirst("company")}
                  value={values.company}
                  onChange={(v) => set("company", v)}
                  options={companies.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                />
                <SelectField label="Cliente" error={errFirst("client")}
                  value={values.client}
                  onChange={(v) => set("client", v)}
                  options={clients.map((c) => ({ value: c.id, label: c.trade_name || c.legal_name }))}
                />
                <SelectField label="Site" error={errFirst("site")}
                  value={values.site}
                  onChange={(v) => set("site", v)}
                  options={filteredSites.map((s) => ({ value: s.id, label: s.code || s.name }))}
                />
              </div>
            </div>
          )}

          {/* ================================================================
              PASSO 2 — CLASSIFICAÇÃO
          ================================================================ */}
          {step === 2 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                Classifique o projeto para facilitar filtros e relatórios.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <SelectField label="Tipo de Projeto" error={errFirst("project_type")}
                  value={values.project_type}
                  onChange={(v) => set("project_type", v)}
                  options={projectTypes.map((p) => ({ value: p.id, label: p.name }))}
                />
                <SelectField label="Categoria" error={errFirst("category")}
                  value={values.category}
                  onChange={(v) => set("category", v)}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Field label="Status inicial" error={errFirst("status")}>
                  <select className="select" value={values.status} onChange={(e) => set("status", e.target.value)}>
                    {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </Field>
                <Field label="Quantidade de Links" error={errFirst("link_count")}>
                  <input className="input" type="number" min={0} value={values.link_count} onChange={(e) => set("link_count", e.target.value ? Number(e.target.value) : "")} />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={values.has_rack_positions} onChange={(e) => set("has_rack_positions", e.target.checked)} />
                    <div>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Ativar Rack Position</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Habilita controle de DH, Links e UTP por posição de rack.</div>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              PASSO 3 — PLANEJAMENTO
          ================================================================ */}
          {step === 3 && (
            <div>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
                Defina responsáveis, cronograma e observações. Todos os campos são opcionais — você pode preencher depois.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
                <SelectField label="Responsável CSTR" error={errFirst("responsible_cstr")}
                  value={values.responsible_cstr}
                  onChange={(v) => set("responsible_cstr", v)}
                  options={responsibles.map((r) => ({ value: r.id, label: r.name }))}
                />
                <SelectField label="Responsável Cliente" error={errFirst("responsible_client")}
                  value={values.responsible_client}
                  onChange={(v) => set("responsible_client", v)}
                  options={filteredClientResp.map((r) => ({ value: r.id, label: r.name }))}
                />
                <Field label="Início Previsto" error={errFirst("planned_start")}>
                  <input className="input" type="date" value={values.planned_start} onChange={(e) => set("planned_start", e.target.value)} />
                </Field>
                <Field label="Término Previsto" error={errFirst("planned_end")}>
                  <input className="input" type="date" value={values.planned_end} onChange={(e) => set("planned_end", e.target.value)} />
                </Field>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Descrição" error={errFirst("description")}>
                    <textarea className="input" rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
                  </Field>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <Field label="Observações" error={errFirst("notes")}>
                    <textarea className="input" rows={2} value={values.notes} onChange={(e) => set("notes", e.target.value)} />
                  </Field>
                </div>
              </div>
              {errors.non_field_errors && (
                <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>
              )}
            </div>
          )}

          {/* ================================================================
              BARRA DE AÇÃO
          ================================================================ */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            {step > 1 ? (
              <button className="btn btn-outline btn-sm" onClick={() => { setErrors({}); setStep((s) => s - 1); }}>
                <Icon name="arrow_back" style={{ fontSize: 15, marginRight: 6 }} />Voltar
              </button>
            ) : (
              <button className="btn btn-outline btn-sm" onClick={onClose}>Cancelar</button>
            )}
            {step < 3 ? (
              <button className="btn btn-primary btn-sm" onClick={goNext}>
                Continuar <Icon name="arrow_forward" style={{ fontSize: 15, marginLeft: 6 }} />
              </button>
            ) : (
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? "Criando..." : <><Icon name="check" style={{ fontSize: 15, marginRight: 6 }} />Criar Projeto</>}
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
