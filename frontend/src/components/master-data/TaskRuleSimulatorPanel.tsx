import { useState } from "react";
import { taskRuleSimulatorApi } from "../../api/resources";
import type {
  TaskTemplateRuleMatch,
  TaskTemplateRuleSimulateRequest,
  TaskTemplateRuleSimulateResult,
} from "../../api/types";
import type { ReferenceData } from "../../pages/cadastros/registryConfig";

/** Sugestões (não é ENUM/choices — o campo medium da regra é texto livre)
 * — mesmas usadas no formulário de Regras de Templates. */
const MEDIUM_SUGGESTIONS = ["FIBER", "COPPER", "MIXED"];

/** Cadastros Mestres > Operação > Simulador de Regras — testa
 * manualmente o motor de match (características de escopo →
 * TaskTemplateRule → TaskTemplate → Etapas) via
 * POST /master-data/task-template-rules/simulate/. NÃO cria nem altera
 * nenhum registro (projeto, item de escopo, tarefa) — é só um
 * simulador/validador do motor de regras para auditoria/depuração. */
export default function TaskRuleSimulatorPanel({ refs }: { refs: ReferenceData }) {
  const [cableFamily, setCableFamily] = useState<number | "">("");
  const [cableSpec, setCableSpec] = useState<number | "">("");
  const [network, setNetwork] = useState<number | "">("");
  const [workstream, setWorkstream] = useState<number | "">("");
  const [medium, setMedium] = useState("");
  const [preterminated, setPreterminated] = useState<"" | "true" | "false">("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TaskTemplateRuleSimulateResult | null>(null);

  const hasAnyCriterion =
    cableFamily !== "" || cableSpec !== "" || network !== "" || workstream !== "" || Boolean(medium) || preterminated !== "";

  function handleClear() {
    setCableFamily("");
    setCableSpec("");
    setNetwork("");
    setWorkstream("");
    setMedium("");
    setPreterminated("");
    setResult(null);
    setError(null);
  }

  async function handleSimulate() {
    setError(null);
    if (!hasAnyCriterion) {
      setError("Informe ao menos um critério para simular.");
      setResult(null);
      return;
    }
    setLoading(true);
    const payload: TaskTemplateRuleSimulateRequest = {
      cable_family: cableFamily === "" ? null : cableFamily,
      cable_spec: cableSpec === "" ? null : cableSpec,
      network: network === "" ? null : network,
      workstream: workstream === "" ? null : workstream,
      medium,
      preterminated: preterminated === "" ? null : preterminated === "true",
    };
    try {
      const data = await taskRuleSimulatorApi.simulate(payload);
      setResult(data);
    } catch (err: unknown) {
      const axiosErr = err as {
        response?: { data?: { detail?: string; non_field_errors?: string[] } };
      };
      const detail =
        axiosErr.response?.data?.detail ||
        axiosErr.response?.data?.non_field_errors?.join(" ") ||
        "Não foi possível simular. Tente novamente.";
      setError(detail);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="card">
        <div className="toolbar">
          <div>
            <div className="toolbar-title">Simulador de Regras</div>
            <div className="toolbar-subtitle">
              Testa o motor de regras (Família de Cabo / Especificação / Rede / Workstream / Meio / Pré-terminado →
              Regra de Template → Template → Etapas) sem criar nada — nenhum projeto, item de escopo ou tarefa é
              alterado.
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginTop: 16 }}>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Cable Family</span>
            <select
              className="select"
              value={cableFamily}
              onChange={(e) => setCableFamily(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Não considerar</option>
              {refs.cableFamilies.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Cable Spec</span>
            <select
              className="select"
              value={cableSpec}
              onChange={(e) => setCableSpec(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Não considerar</option>
              {refs.cableSpecs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.part_number || s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Network</span>
            <select
              className="select"
              value={network}
              onChange={(e) => setNetwork(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Não considerar</option>
              {refs.networks.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.code} — {n.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Workstream</span>
            <select
              className="select"
              value={workstream}
              onChange={(e) => setWorkstream(e.target.value ? Number(e.target.value) : "")}
            >
              <option value="">Não considerar</option>
              {refs.workstreams.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Medium</span>
            <select className="select" value={medium} onChange={(e) => setMedium(e.target.value)}>
              <option value="">Não considerar</option>
              {MEDIUM_SUGGESTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group" style={{ marginBottom: 14 }}>
            <span className="field-label">Preterminated</span>
            <select
              className="select"
              value={preterminated}
              onChange={(e) => setPreterminated(e.target.value as "" | "true" | "false")}
            >
              <option value="">Não considerar</option>
              <option value="true">Sim</option>
              <option value="false">Não</option>
            </select>
          </div>
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-outline" onClick={handleClear}>
            Limpar
          </button>
          <button className="btn btn-primary" onClick={handleSimulate} disabled={loading}>
            {loading ? "Simulando..." : "Simular"}
          </button>
        </div>
      </div>

      {result && <SimulationResult result={result} />}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
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
      {children}
    </div>
  );
}

function MatchChecksTable({ checks }: { checks: TaskTemplateRuleMatch["checks"] }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Critério</th>
            <th>Resultado</th>
            <th>Detalhe</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.criterion}>
              <td>{c.criterion}</td>
              <td
                style={{
                  fontWeight: 700,
                  color: c.result === "MATCH" ? "var(--green)" : c.result === "MISMATCH" ? "var(--red)" : "var(--text-muted)",
                }}
              >
                {c.result}
              </td>
              <td>{c.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimulationResult({ result }: { result: TaskTemplateRuleSimulateResult }) {
  const secondaryMatches = result.matches.slice(1);
  const derivedEntries = Object.entries(result.derived_fields);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      {!result.selected_rule || !result.selected_template ? (
        <div className="empty-state">Nenhuma regra compatível encontrada.</div>
      ) : (
        <>
          {derivedEntries.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <SectionLabel>Campos Derivados</SectionLabel>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: "var(--text)" }}>
                {derivedEntries.map(([field, info]) => (
                  <li key={field}>
                    {field} = {info.value} (derivado de {info.source})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              {result.warnings.map((w, i) => (
                <p key={i} style={{ color: "var(--amber)", fontSize: 13, margin: "0 0 4px" }}>
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
            <div>
              <SectionLabel>Regra Selecionada</SectionLabel>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Código</td>
                      <td>{result.selected_rule.code}</td>
                    </tr>
                    <tr>
                      <td>Nome</td>
                      <td>{result.selected_rule.name}</td>
                    </tr>
                    <tr>
                      <td>Prioridade</td>
                      <td>{result.selected_rule.priority}</td>
                    </tr>
                    <tr>
                      <td>Especificidade</td>
                      <td>{result.selected_rule.specificity_score}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <SectionLabel>Template Selecionado</SectionLabel>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    <tr>
                      <td>Código</td>
                      <td>{result.selected_template.code}</td>
                    </tr>
                    <tr>
                      <td>Nome</td>
                      <td>{result.selected_template.name}</td>
                    </tr>
                    <tr>
                      <td>Categoria</td>
                      <td>{result.selected_template.category}</td>
                    </tr>
                    <tr>
                      <td>Meio</td>
                      <td>{result.selected_template.medium || "—"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <SectionLabel>Etapas que Seriam Geradas ({result.steps.length})</SectionLabel>
          <div className="table-wrap" style={{ marginBottom: 20 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Ordem</th>
                  <th>Activity Code</th>
                  <th>Atividade</th>
                  <th>Nome Efetivo</th>
                  <th>Obrigatória</th>
                  <th>Repetível</th>
                  <th>Origem da Quantidade</th>
                  <th>Unidade</th>
                </tr>
              </thead>
              <tbody>
                {result.steps.map((s) => (
                  <tr key={s.step_order}>
                    <td>{s.step_order}</td>
                    <td>{s.activity_code}</td>
                    <td>{s.activity_name}</td>
                    <td>{s.effective_name}</td>
                    <td>{s.required ? "Sim" : "Não"}</td>
                    <td>{s.repeatable ? "Sim" : "Não"}</td>
                    <td>{s.quantity_source || "—"}</td>
                    <td>{s.unit_override || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginBottom: secondaryMatches.length > 0 ? 20 : 0 }}>
            <SectionLabel>Explicação do Match — {result.selected_rule.code}</SectionLabel>
            <MatchChecksTable checks={result.matches[0].checks} />
          </div>

          {secondaryMatches.length > 0 && (
            <div>
              <SectionLabel>Matches Secundários ({secondaryMatches.length})</SectionLabel>
              <p style={{ fontSize: 12, color: "var(--text-faint)", marginTop: -4, marginBottom: 10 }}>
                Outras regras ativas também compatíveis com os critérios informados, em ordem de classificação —
                útil para auditoria.
              </p>
              {secondaryMatches.map((m) => (
                <div key={m.rule.code} style={{ marginBottom: 16 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                    {m.rule.code} — {m.rule.name} (prioridade {m.rule.priority}, especificidade{" "}
                    {m.rule.specificity_score}) → {m.rule.task_template_code}
                  </p>
                  <MatchChecksTable checks={m.checks} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
