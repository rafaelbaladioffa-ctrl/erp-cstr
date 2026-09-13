import { Fragment, useEffect, useState } from "react";
import { planningApi } from "../../api/resources";
import type { SowImport, SowParsedItem } from "../../api/types";
import Icon from "../ui/Icon";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";

/** Planejamento > Importar SOW — primeiro módulo de ingestão inteligente
 * de escopo: SOW/texto/arquivo -> parser determinístico + IA opcional ->
 * normalização contra Master Data -> preview (SowParsedItem) -> revisão
 * humana -> aprovação -> ScopeItem definitivo. NUNCA cria GeneratedTask
 * nem Master Data novo (ver master_data/models.py::SowImport). Fluxo
 * visual simplificado em duas telas (lista de importações / detalhe de
 * uma importação) em vez de 5 telas rígidas — o processamento é síncrono
 * e rápido, então "Processamento" é só um estado de loading dentro da
 * tela de detalhe, não uma tela própria. */

const SOURCE_TYPE_OPTIONS = [
  { value: "TEXT", label: "Texto colado" },
  { value: "PDF", label: "Arquivo PDF" },
  { value: "DOCX", label: "Arquivo DOCX" },
  { value: "IMAGE", label: "Imagem" },
  { value: "OTHER", label: "Outro arquivo" },
];

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  PROCESSING: "Processando",
  READY_FOR_REVIEW: "Pronto para revisão",
  PARTIALLY_REVIEWED: "Parcialmente revisado",
  APPROVED: "Finalizado",
  FAILED: "Falhou",
  CANCELLED: "Cancelado",
};

const REVIEW_STATUS_LABELS: Record<string, string> = {
  PENDING: "Pendente",
  APPROVED: "Aprovado",
  REJECTED: "Rejeitado",
  NEEDS_REVIEW: "Exige revisão",
};

function confidenceColor(band: string | null) {
  if (band === "HIGH") return "var(--green)";
  if (band === "MEDIUM") return "var(--amber)";
  if (band === "LOW") return "var(--red)";
  return "var(--text-muted)";
}

function reviewStatusColor(status: string) {
  if (status === "APPROVED") return "var(--green)";
  if (status === "REJECTED") return "var(--red)";
  if (status === "NEEDS_REVIEW") return "var(--amber)";
  return "var(--text-muted)";
}

interface EditForm {
  suggested_cable_family: number | "";
  suggested_cable_spec: number | "";
  suggested_network: number | "";
  suggested_workstream: number | "";
  suggested_paths: number[];
  quantity: number | "";
  unit: string;
  length_type: string;
  length_m: number | "";
  medium: string;
  preterminated: string; // "" | "true" | "false"
  color: string;
  fiber_count: number | "";
}

function editFormFromItem(item: SowParsedItem): EditForm {
  return {
    suggested_cable_family: item.suggested_cable_family ?? "",
    suggested_cable_spec: item.suggested_cable_spec ?? "",
    suggested_network: item.suggested_network ?? "",
    suggested_workstream: item.suggested_workstream ?? "",
    suggested_paths: item.suggested_paths ?? [],
    quantity: item.quantity ?? "",
    unit: item.unit ?? "",
    length_type: item.length_type ?? "",
    length_m: item.length_m ? Number(item.length_m) : "",
    medium: item.medium ?? "",
    preterminated: item.preterminated === null ? "" : item.preterminated ? "true" : "false",
    color: item.color ?? "",
    fiber_count: item.fiber_count ?? "",
  };
}

export default function SowImportPanel({ refs }: { refs: ReferenceData }) {
  const [mode, setMode] = useState<"list" | "new" | "detail">("list");
  const [imports, setImports] = useState<SowImport[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("TEXT");
  const [sourceText, setSourceText] = useState("");
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [activeImport, setActiveImport] = useState<SowImport | null>(null);
  const [items, setItems] = useState<SowParsedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());

  function loadImports() {
    setLoadingList(true);
    planningApi.sowImports
      .list({ page_size: "50" } as never)
      .then((r) => setImports(r.results))
      .finally(() => setLoadingList(false));
  }

  useEffect(() => {
    loadImports();
  }, []);

  function resetNewForm() {
    setTitle("");
    setSourceType("TEXT");
    setSourceText("");
    setSourceFile(null);
    setCreateError(null);
  }

  function openNew() {
    resetNewForm();
    setMode("new");
  }

  async function openDetail(imp: SowImport) {
    setActiveImport(imp);
    setMode("detail");
    setSelectedIds(new Set());
    setEditingId(null);
    setActionError(null);
    await loadItems(imp.id);
  }

  async function loadItems(importId: number) {
    setLoadingItems(true);
    try {
      const data = await planningApi.sowImports.items(importId);
      setItems(data);
    } finally {
      setLoadingItems(false);
    }
  }

  async function refreshActiveImport(importId: number) {
    const updated = await planningApi.sowImports.get(importId);
    setActiveImport(updated);
    setImports((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    return updated;
  }

  async function handleCreateAndProcess() {
    setCreateError(null);
    if (!sourceFile && !sourceText.trim()) {
      setCreateError("Cole o texto do SOW ou envie um arquivo.");
      return;
    }
    setCreating(true);
    try {
      const created = sourceFile
        ? await planningApi.sowImports.createWithFile({
            title,
            source_type: sourceType,
            source_text: sourceText,
            source_file: sourceFile,
          })
        : await planningApi.sowImports.create({ title, source_type: sourceType, source_text: sourceText } as never);

      if (created.status === "FAILED") {
        setImports((prev) => [created, ...prev]);
        await openDetail(created);
        return;
      }

      const processed = await planningApi.sowImports.process(created.id);
      setImports((prev) => [processed, ...prev]);
      await openDetail(processed);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string; source_text?: string[] } } };
      setCreateError(
        axiosErr.response?.data?.detail || axiosErr.response?.data?.source_text?.[0] || "Não foi possível processar o SOW."
      );
    } finally {
      setCreating(false);
    }
  }

  async function handleReprocessImport() {
    if (!activeImport) return;
    setActionError(null);
    try {
      const updated = await planningApi.sowImports.reprocess(activeImport.id);
      setActiveImport(updated);
      await loadItems(updated.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || "Não foi possível reprocessar.");
    }
  }

  function withBusy<T>(id: number, fn: () => Promise<T>) {
    setBusyIds((prev) => new Set(prev).add(id));
    return fn().finally(() => {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  async function handleApprove(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.approve(item.id));
      if (activeImport) {
        await refreshActiveImport(activeImport.id);
        await loadItems(activeImport.id);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || "Não foi possível aprovar este item.");
    }
  }

  async function handleReject(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reject(item.id));
      if (activeImport) {
        await refreshActiveImport(activeImport.id);
        await loadItems(activeImport.id);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || "Não foi possível rejeitar este item.");
    }
  }

  async function handleReprocessItem(item: SowParsedItem) {
    setActionError(null);
    try {
      await withBusy(item.id, () => planningApi.sowParsedItems.reprocess(item.id));
      if (activeImport) await loadItems(activeImport.id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || "Não foi possível reprocessar este item.");
    }
  }

  async function handleApproveSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    const result = await planningApi.sowImports.approveSelected(activeImport.id, Array.from(selectedIds));
    setActiveImport(result.sow_import);
    setImports((prev) => prev.map((i) => (i.id === result.sow_import.id ? result.sow_import : i)));
    if (result.errors.length > 0) {
      setActionError(`${result.errors.length} item(ns) não puderam ser aprovados: ${result.errors.map((e) => e.detail).join(" ")}`);
    }
    setSelectedIds(new Set());
    await loadItems(activeImport.id);
  }

  async function handleRejectSelected() {
    if (!activeImport || selectedIds.size === 0) return;
    setActionError(null);
    const result = await planningApi.sowImports.rejectSelected(activeImport.id, Array.from(selectedIds));
    setActiveImport(result.sow_import);
    setImports((prev) => prev.map((i) => (i.id === result.sow_import.id ? result.sow_import : i)));
    setSelectedIds(new Set());
    await loadItems(activeImport.id);
  }

  async function handleFinalize() {
    if (!activeImport) return;
    setActionError(null);
    try {
      const updated = await planningApi.sowImports.finalize(activeImport.id);
      setActiveImport(updated);
      setImports((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setActionError(axiosErr.response?.data?.detail || "Ainda há itens pendentes de revisão.");
    }
  }

  function startEdit(item: SowParsedItem) {
    setEditingId(item.id);
    setEditForm(editFormFromItem(item));
  }

  async function saveEdit(item: SowParsedItem) {
    if (!editForm) return;
    const payload = {
      suggested_cable_family: editForm.suggested_cable_family || null,
      suggested_cable_spec: editForm.suggested_cable_spec || null,
      suggested_network: editForm.suggested_network || null,
      suggested_workstream: editForm.suggested_workstream || null,
      suggested_paths: editForm.suggested_paths,
      quantity: editForm.quantity === "" ? null : editForm.quantity,
      unit: editForm.unit,
      length_type: editForm.length_type,
      length_m: editForm.length_m === "" ? null : editForm.length_m,
      medium: editForm.medium,
      preterminated: editForm.preterminated === "" ? null : editForm.preterminated === "true",
      color: editForm.color,
      fiber_count: editForm.fiber_count === "" ? null : editForm.fiber_count,
    };
    await planningApi.sowParsedItems.update(item.id, payload as never);
    setEditingId(null);
    setEditForm(null);
    if (activeImport) await loadItems(activeImport.id);
  }

  function toggleSelected(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const pendingCount = items.filter((i) => i.active && (i.review_status === "PENDING" || i.review_status === "NEEDS_REVIEW")).length;

  if (mode === "list") {
    return (
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">Importar SOW</div>
            <div className="toolbar-subtitle">
              Cole o texto de um escopo (ou envie um arquivo) e deixe o parser determinístico + IA propor Itens de
              Escopo — sempre como preview revisável, nunca gravado sem sua aprovação explícita.
            </div>
          </div>
          <button className="btn btn-primary" onClick={openNew}>
            <Icon name="add" style={{ fontSize: 16 }} /> Nova Importação
          </button>
        </div>

        {loadingList && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando…</p>}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Título</th>
                <th>Status</th>
                <th>Detectados</th>
                <th>Aprovados</th>
                <th>Rejeitados</th>
                <th>Warnings</th>
                <th>Data</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((imp) => (
                <tr key={imp.id} style={{ cursor: "pointer" }} onClick={() => openDetail(imp)}>
                  <td>{imp.code}</td>
                  <td>{imp.title || "—"}</td>
                  <td>{STATUS_LABELS[imp.status] || imp.status}</td>
                  <td>{imp.total_items_detected}</td>
                  <td>{imp.total_items_approved}</td>
                  <td>{imp.total_items_rejected}</td>
                  <td>{imp.total_warnings}</td>
                  <td>{new Date(imp.created_at).toLocaleString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {imports.length === 0 && !loadingList && <div className="table-empty">Nenhuma importação ainda.</div>}
        </div>
      </div>
    );
  }

  if (mode === "new") {
    return (
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">Nova Importação de SOW</div>
            <div className="toolbar-subtitle">Etapa 1 — Origem: cole o texto ou envie um arquivo.</div>
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => setMode("list")}>
            Voltar
          </button>
        </div>

        {createError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{createError}</p>}

        <div className="field-group" style={{ marginBottom: 14 }}>
          <span className="field-label">Título</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Opcional" />
        </div>

        <div className="field-group" style={{ marginBottom: 14 }}>
          <span className="field-label">Tipo de origem</span>
          <select className="select" value={sourceType} onChange={(e) => setSourceType(e.target.value)}>
            {SOURCE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group" style={{ marginBottom: 14 }}>
          <span className="field-label">Texto do SOW</span>
          <textarea
            className="input"
            rows={10}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder={"Uma linha por item, ex:\n2x 72F OS2 Yellow MPO/MPO, MPO-B, 0072X6P64 with 50m\n4x 2F robust fibers up to 60m\n10x CAT6 UTP up to 60m"}
          />
        </div>

        <div className="field-group" style={{ marginBottom: 14 }}>
          <span className="field-label">Ou envie um arquivo</span>
          <input type="file" onChange={(e) => setSourceFile(e.target.files?.[0] || null)} />
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Nesta versão a extração automática de texto só é garantida para arquivos de texto simples — PDF/DOCX/
            imagem são preservados para auditoria, mas podem exigir colar o texto manualmente.
          </p>
        </div>

        <button className="btn btn-primary" onClick={handleCreateAndProcess} disabled={creating}>
          {creating ? "Processando…" : "Processar SOW"}
        </button>
      </div>
    );
  }

  if (!activeImport) return null;

  return (
    <div className="card">
      <div className="toolbar">
        <div>
          <div className="toolbar-title">
            {activeImport.code} {activeImport.title ? `— ${activeImport.title}` : ""}
          </div>
          <div className="toolbar-subtitle">
            Status: {STATUS_LABELS[activeImport.status] || activeImport.status} · Detectados:{" "}
            {activeImport.total_items_detected} · Aprovados: {activeImport.total_items_approved} · Rejeitados:{" "}
            {activeImport.total_items_rejected} · Warnings: {activeImport.total_warnings}
            {activeImport.ai_provider && <> · IA: {activeImport.ai_provider} ({activeImport.ai_model})</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-outline btn-sm" onClick={() => setMode("list")}>
            Voltar
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleReprocessImport}>
            Reprocessar SOW
          </button>
        </div>
      </div>

      {activeImport.status === "FAILED" && (
        <p style={{ color: "var(--red)", fontSize: 13 }}>⚠ Falha no processamento: {activeImport.error_message}</p>
      )}
      {actionError && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{actionError}</p>}

      {loadingItems && <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Carregando itens…</p>}

      {!loadingItems && items.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button className="btn btn-outline btn-sm" onClick={handleApproveSelected} disabled={selectedIds.size === 0}>
              Aprovar selecionados ({selectedIds.size})
            </button>
            <button className="btn btn-outline btn-sm" onClick={handleRejectSelected} disabled={selectedIds.size === 0}>
              Rejeitar selecionados ({selectedIds.size})
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleFinalize} disabled={pendingCount > 0}>
              Finalizar Importação
            </button>
            {pendingCount > 0 && (
              <span style={{ fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                {pendingCount} item(ns) ainda pendente(s) de revisão
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th></th>
                  <th>Seq.</th>
                  <th>Texto Original</th>
                  <th>Família</th>
                  <th>Spec</th>
                  <th>Rede</th>
                  <th>Workstream</th>
                  <th>Paths</th>
                  <th>Qtd</th>
                  <th>Metragem</th>
                  <th>Meio</th>
                  <th>Confiança</th>
                  <th>Warnings</th>
                  <th>Revisão</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <Fragment key={item.id}>
                    <tr>
                      <td>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.id)}
                          disabled={item.review_status !== "PENDING" && item.review_status !== "NEEDS_REVIEW"}
                          onChange={() => toggleSelected(item.id)}
                        />
                      </td>
                      <td>{item.sequence}</td>
                      <td style={{ maxWidth: 260 }}>{item.raw_text}</td>
                      <td>{item.suggested_cable_family_code || "—"}</td>
                      <td>{item.suggested_cable_spec_code || "—"}</td>
                      <td>{item.suggested_network_code || "—"}</td>
                      <td>{item.suggested_workstream_code || "—"}</td>
                      <td>{item.suggested_path_codes.join(", ") || "—"}</td>
                      <td>{item.quantity ?? "—"}</td>
                      <td>
                        {item.length_m ? `${item.length_m}m` : "—"} {item.length_type && `(${item.length_type})`}
                      </td>
                      <td>{item.medium || "—"}</td>
                      <td style={{ color: confidenceColor(item.confidence_band) }}>
                        {item.confidence_score ?? "—"}
                      </td>
                      <td>
                        {item.warnings.map((w, i) => (
                          <div key={i} style={{ color: w.critical ? "var(--red)" : "var(--amber)", fontSize: 11 }}>
                            ⚠ {w.message}
                          </div>
                        ))}
                      </td>
                      <td style={{ color: reviewStatusColor(item.review_status) }}>
                        {REVIEW_STATUS_LABELS[item.review_status] || item.review_status}
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={busyIds.has(item.id) || item.review_status === "APPROVED"}
                            onClick={() => handleApprove(item)}
                          >
                            Aprovar
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={busyIds.has(item.id) || item.review_status === "APPROVED"}
                            onClick={() => handleReject(item)}
                          >
                            Rejeitar
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={busyIds.has(item.id) || item.review_status === "APPROVED"}
                            onClick={() => (editingId === item.id ? setEditingId(null) : startEdit(item))}
                          >
                            Editar
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            disabled={busyIds.has(item.id) || item.review_status === "APPROVED"}
                            onClick={() => handleReprocessItem(item)}
                          >
                            Reprocessar
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingId === item.id && editForm && (
                      <tr>
                        <td colSpan={15}>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "repeat(4, 1fr)",
                              gap: 10,
                              padding: 12,
                              background: "var(--surface-2, #f7f7f8)",
                              borderRadius: 8,
                            }}
                          >
                            <div className="field-group">
                              <span className="field-label">Família</span>
                              <select
                                className="select"
                                value={editForm.suggested_cable_family}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, suggested_cable_family: e.target.value ? Number(e.target.value) : "" })
                                }
                              >
                                <option value="">—</option>
                                {refs.cableFamilies.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.code} — {f.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Spec</span>
                              <select
                                className="select"
                                value={editForm.suggested_cable_spec}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, suggested_cable_spec: e.target.value ? Number(e.target.value) : "" })
                                }
                              >
                                <option value="">—</option>
                                {refs.cableSpecs.map((s) => (
                                  <option key={s.id} value={s.id}>
                                    {s.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Rede</span>
                              <select
                                className="select"
                                value={editForm.suggested_network}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, suggested_network: e.target.value ? Number(e.target.value) : "" })
                                }
                              >
                                <option value="">—</option>
                                {refs.networks.map((n) => (
                                  <option key={n.id} value={n.id}>
                                    {n.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Workstream</span>
                              <select
                                className="select"
                                value={editForm.suggested_workstream}
                                onChange={(e) =>
                                  setEditForm({ ...editForm, suggested_workstream: e.target.value ? Number(e.target.value) : "" })
                                }
                              >
                                <option value="">—</option>
                                {refs.workstreams.map((w) => (
                                  <option key={w.id} value={w.id}>
                                    {w.code}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group" style={{ gridColumn: "span 2" }}>
                              <span className="field-label">Paths</span>
                              <select
                                className="select"
                                multiple
                                value={editForm.suggested_paths.map(String)}
                                onChange={(e) =>
                                  setEditForm({
                                    ...editForm,
                                    suggested_paths: Array.from(e.target.selectedOptions).map((o) => Number(o.value)),
                                  })
                                }
                              >
                                {refs.paths.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.code} — {p.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Quantidade</span>
                              <input
                                className="input"
                                type="number"
                                value={editForm.quantity}
                                onChange={(e) => setEditForm({ ...editForm, quantity: e.target.value ? Number(e.target.value) : "" })}
                              />
                            </div>
                            <div className="field-group">
                              <span className="field-label">Unidade</span>
                              <input
                                className="input"
                                value={editForm.unit}
                                onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                              />
                            </div>
                            <div className="field-group">
                              <span className="field-label">Tipo de Metragem</span>
                              <select
                                className="select"
                                value={editForm.length_type}
                                onChange={(e) => setEditForm({ ...editForm, length_type: e.target.value })}
                              >
                                <option value="">—</option>
                                <option value="EXACT">EXACT</option>
                                <option value="MAXIMUM">MAXIMUM</option>
                                <option value="MINIMUM">MINIMUM</option>
                                <option value="RANGE">RANGE</option>
                                <option value="UNKNOWN">UNKNOWN</option>
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Metragem (m)</span>
                              <input
                                className="input"
                                type="number"
                                value={editForm.length_m}
                                onChange={(e) => setEditForm({ ...editForm, length_m: e.target.value ? Number(e.target.value) : "" })}
                              />
                            </div>
                            <div className="field-group">
                              <span className="field-label">Meio</span>
                              <select
                                className="select"
                                value={editForm.medium}
                                onChange={(e) => setEditForm({ ...editForm, medium: e.target.value })}
                              >
                                <option value="">—</option>
                                <option value="FIBER">FIBER</option>
                                <option value="COPPER">COPPER</option>
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Pré-terminado</span>
                              <select
                                className="select"
                                value={editForm.preterminated}
                                onChange={(e) => setEditForm({ ...editForm, preterminated: e.target.value })}
                              >
                                <option value="">Não informado</option>
                                <option value="true">Sim</option>
                                <option value="false">Não</option>
                              </select>
                            </div>
                            <div className="field-group">
                              <span className="field-label">Cor</span>
                              <input
                                className="input"
                                value={editForm.color}
                                onChange={(e) => setEditForm({ ...editForm, color: e.target.value })}
                              />
                            </div>
                            <div className="field-group">
                              <span className="field-label">Nº de Fibras</span>
                              <input
                                className="input"
                                type="number"
                                value={editForm.fiber_count}
                                onChange={(e) => setEditForm({ ...editForm, fiber_count: e.target.value ? Number(e.target.value) : "" })}
                              />
                            </div>
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                              <button className="btn btn-primary btn-sm" onClick={() => saveEdit(item)}>
                                Salvar
                              </button>
                              <button className="btn btn-outline btn-sm" onClick={() => setEditingId(null)}>
                                Cancelar
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
