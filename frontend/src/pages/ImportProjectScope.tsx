import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { projectsApi, scopeImportsApi } from "../api/resources";
import type { Project, ScopeImport, ScopeImportPayload } from "../api/types";
import ScopeImportReviewTree, { scopeImportPayloadIsValid } from "../components/scope-import/ScopeImportReviewTree";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";

type Step = "input" | "review" | "done";
type ApiErr = { response?: { data?: { detail?: string } } };

function errorMessage(err: unknown, fallback: string) {
  const detail = (err as ApiErr).response?.data?.detail;
  return detail || fallback;
}

export default function ImportProjectScope() {
  const { id } = useParams();
  const projectId = id ? Number(id) : null;
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const [step, setStep] = useState<Step>("input");
  const [rawText, setRawText] = useState("");
  const [scopeImport, setScopeImport] = useState<ScopeImport | null>(null);
  const [payload, setPayload] = useState<ScopeImportPayload | null>(null);
  const [interpreting, setInterpreting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ work_blocks: number; items: number; tasks: number } | null>(null);

  useEffect(() => {
    if (!projectId) return;
    projectsApi.get(projectId).then(setProject);
  }, [projectId]);

  function applyInterpretationResult(updated: ScopeImport) {
    setScopeImport(updated);
    if (updated.status === "ready") {
      setPayload(updated.ai_raw_response);
      setStep("review");
    } else {
      setError(updated.error_message || "Não foi possível interpretar o escopo.");
    }
  }

  function handleInterpret() {
    if (!projectId || !rawText.trim()) return;
    setInterpreting(true);
    setError("");
    scopeImportsApi
      .create(projectId, rawText)
      .then(applyInterpretationResult)
      .catch((err) => setError(errorMessage(err, "Falha ao interpretar o escopo.")))
      .finally(() => setInterpreting(false));
  }

  function handleRetry() {
    if (!scopeImport) return;
    setInterpreting(true);
    setError("");
    scopeImportsApi
      .retry(scopeImport.id)
      .then(applyInterpretationResult)
      .catch((err) => setError(errorMessage(err, "Falha ao interpretar o escopo.")))
      .finally(() => setInterpreting(false));
  }

  function handleConfirm() {
    if (!scopeImport || !payload) return;
    setConfirming(true);
    setError("");
    scopeImportsApi
      .confirm(scopeImport.id, payload)
      .then((res) => {
        setResult(res.counts);
        setStep("done");
      })
      .catch((err) => setError(errorMessage(err, "Falha ao confirmar a importação.")))
      .finally(() => setConfirming(false));
  }

  function handleDiscard() {
    if (!scopeImport || !projectId) return;
    scopeImportsApi.discard(scopeImport.id).finally(() => {
      navigate(`/projetos/${projectId}`, { state: { tab: "planning" } });
    });
  }

  if (!project) {
    return <p style={{ padding: 32, color: "var(--text-muted)" }}>Carregando...</p>;
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1000 }}>
      <PageHeader
        eyebrow="Planejamento"
        title="Importar Escopo"
        subtitle={`${project.code ? `${project.code} — ` : ""}${project.name}`}
        actions={
          <Link className="btn btn-outline btn-sm" to={`/projetos/${project.id}`} state={{ tab: "planning" }}>
            Voltar ao Projeto
          </Link>
        }
      />

      {step === "input" && (
        <div className="card">
          <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
            Cole abaixo o escopo do projeto (planilha colada, lista, e-mail do cliente, ou qualquer descrição em texto
            livre). Uma IA vai propor uma estrutura de Blocos, Itens e Tarefas — nada é gravado agora, você revisa e edita
            tudo na próxima tela antes de confirmar.
          </p>
          <textarea
            className="input"
            style={{ height: 260, fontFamily: "inherit", width: "100%" }}
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Ex: UMN - lançar e certificar 3 cabos Robust 2F de 20m entre rack A e B..."
          />
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 14 }}>
            {scopeImport?.status === "failed" && (
              <button className="btn btn-outline" onClick={handleRetry} disabled={interpreting}>
                {interpreting ? "Tentando novamente..." : "Tentar novamente"}
              </button>
            )}
            <button className="btn btn-primary" onClick={handleInterpret} disabled={interpreting || !rawText.trim()}>
              <Icon name="auto_awesome" style={{ fontSize: 15 }} />
              {interpreting ? "Interpretando com IA... (pode levar até 30s)" : "Interpretar com IA"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && payload && (
        <>
          <ScopeImportReviewTree payload={payload} onChange={setPayload} />
          {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 10 }}>{error}</p>}
          {!scopeImportPayloadIsValid(payload) && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: 10 }}>
              Resolva os campos destacados em vermelho (Tipo de Item / Tipo de Atividade) antes de confirmar.
            </p>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 16 }}>
            <button className="btn btn-outline" onClick={handleDiscard}>
              Descartar
            </button>
            <button className="btn btn-primary" onClick={handleConfirm} disabled={confirming || !scopeImportPayloadIsValid(payload)}>
              {confirming ? "Gerando..." : "Gerar Plano de Execução"}
            </button>
          </div>
        </>
      )}

      {step === "done" && result && (
        <div className="card" style={{ maxWidth: 560, textAlign: "center", padding: 32, margin: "0 auto" }}>
          <Icon name="check_circle" style={{ fontSize: 40, color: "var(--green)" }} />
          <h3 style={{ margin: "12px 0 6px" }}>Plano de execução gerado</h3>
          <p style={{ color: "var(--text-muted)", fontSize: 13.5 }}>
            {result.work_blocks} bloco(s), {result.items} item(ns) e {result.tasks} tarefa(s) criados.
          </p>
          <Link className="btn btn-primary" style={{ marginTop: 16, display: "inline-flex" }} to={`/projetos/${project.id}`} state={{ tab: "planning" }}>
            Ver Planejamento
          </Link>
        </div>
      )}
    </div>
  );
}
