import { useEffect, useState } from "react";
import { generationRulesApi, registryApi } from "../api/resources";
import type { ActivityType, GenerationRule, GenerationRuleStep } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import { useAuth } from "../context/AuthContext";
import { PERMS, hasPerm } from "../utils/permissions";

type DraftStep = { activity_type: number | null; sequence: number };

export default function GenerationRulesPage() {
  const { user } = useAuth();
  const canChange = hasPerm(user, PERMS.changeGenerationRule);
  const canAdd = hasPerm(user, PERMS.addGenerationRule);
  const canDelete = hasPerm(user, PERMS.deleteGenerationRule);

  const [rules, setRules] = useState<GenerationRule[]>([]);
  const [activityTypes, setActivityTypes] = useState<ActivityType[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<number | null>(null);
  const [draftSteps, setDraftSteps] = useState<Record<number, DraftStep[]>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [newTechnology, setNewTechnology] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  function reload() {
    setLoading(true);
    Promise.all([generationRulesApi.list(), registryApi.activityTypes.list({ page_size: "500", is_active: "true" } as never)])
      .then(([rulesRes, activityRes]) => {
        setRules(rulesRes.results);
        setActivityTypes(activityRes.results);
      })
      .finally(() => setLoading(false));
  }

  useEffect(reload, []);

  function openRule(rule: GenerationRule) {
    if (openId === rule.id) {
      setOpenId(null);
      return;
    }
    setOpenId(rule.id);
    setDraftSteps((prev) => ({
      ...prev,
      [rule.id]: rule.steps.map((s) => ({ activity_type: s.activity_type, sequence: s.sequence })),
    }));
  }

  function updateSteps(ruleId: number, updater: (steps: DraftStep[]) => DraftStep[]) {
    setDraftSteps((prev) => ({ ...prev, [ruleId]: updater(prev[ruleId] || []) }));
  }

  function addStep(ruleId: number) {
    updateSteps(ruleId, (steps) => [...steps, { activity_type: activityTypes[0]?.id ?? null, sequence: steps.length + 1 }]);
  }

  function removeStep(ruleId: number, index: number) {
    updateSteps(ruleId, (steps) => steps.filter((_, i) => i !== index).map((s, i) => ({ ...s, sequence: i + 1 })));
  }

  function moveStep(ruleId: number, index: number, direction: -1 | 1) {
    updateSteps(ruleId, (steps) => {
      const target = index + direction;
      if (target < 0 || target >= steps.length) return steps;
      const next = [...steps];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((s, i) => ({ ...s, sequence: i + 1 }));
    });
  }

  function setStepActivity(ruleId: number, index: number, activityTypeId: number) {
    updateSteps(ruleId, (steps) => steps.map((s, i) => (i === index ? { ...s, activity_type: activityTypeId } : s)));
  }

  async function saveSteps(rule: GenerationRule) {
    const steps = draftSteps[rule.id] || [];
    if (steps.some((s) => !s.activity_type)) {
      alert("Selecione um Tipo de Atividade em todas as etapas antes de salvar.");
      return;
    }
    setSavingId(rule.id);
    try {
      const updated = await generationRulesApi.update(rule.id, { steps: steps as unknown as GenerationRuleStep[] });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
    } catch {
      alert("Não foi possível salvar as etapas.");
    } finally {
      setSavingId(null);
    }
  }

  async function handleCreate() {
    if (!newTechnology.trim()) return;
    setCreating(true);
    try {
      await generationRulesApi.create({ technology: newTechnology.trim(), name: newName.trim(), steps: [] } as unknown as Partial<GenerationRule>);
      setNewTechnology("");
      setNewName("");
      reload();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { technology?: string[] } } };
      alert(axiosErr.response?.data?.technology?.[0] || "Não foi possível criar a regra.");
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(rule: GenerationRule) {
    if (!confirm(`Excluir a regra "${rule.name || rule.technology}"?`)) return;
    await generationRulesApi.remove(rule.id);
    reload();
  }

  async function toggleActive(rule: GenerationRule) {
    const updated = await generationRulesApi.update(rule.id, { is_active: !rule.is_active });
    setRules((prev) => prev.map((r) => (r.id === rule.id ? updated : r)));
  }

  return (
    <div>
      <PageHeader
        eyebrow="Sistema"
        title="Regras de Geração"
        subtitle="Tecnologia → sequência de Tipos de Atividade gerados automaticamente pra um Item"
      />

      {canAdd && (
        <div className="card" style={{ marginBottom: 16, padding: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <span className="field-label">Tecnologia</span>
              <input className="input" value={newTechnology} onChange={(e) => setNewTechnology(e.target.value)} placeholder="Ex: Robust 2F" />
            </div>
            <div className="field-group" style={{ flex: 1, minWidth: 200 }}>
              <span className="field-label">Nome (opcional)</span>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex: Robust 2F padrão" />
            </div>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newTechnology.trim()}>
              <Icon name="add" style={{ fontSize: 15 }} />
              Nova Regra
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : rules.length === 0 ? (
        <div className="empty-state">Nenhuma regra cadastrada ainda.</div>
      ) : (
        rules.map((rule) => {
          const open = openId === rule.id;
          const steps = draftSteps[rule.id] || [];
          return (
            <div key={rule.id} className="ops-tech-card" style={{ marginBottom: 12 }}>
              <button type="button" className="ops-card-head ops-card-head-toggle" onClick={() => openRule(rule)}>
                <div className="ops-card-title">
                  {rule.name || rule.technology}
                  {rule.name && <span style={{ color: "var(--text-faint)", fontWeight: 400 }}> · {rule.technology}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="ops-card-hint">{rule.steps.length} etapa(s){!rule.is_active && " · inativa"}</span>
                  <Icon name={open ? "expand_less" : "expand_more"} style={{ fontSize: 20, color: "var(--text-faint)" }} />
                </div>
              </button>

              {open && (
                <div style={{ padding: "10px 16px 14px" }}>
                  {steps.map((step, index) => (
                    <div key={index} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11.5, color: "var(--text-faint)", width: 20 }}>{index + 1}.</span>
                      <select
                        className="select"
                        style={{ flex: 1 }}
                        value={step.activity_type ?? ""}
                        disabled={!canChange}
                        onChange={(e) => setStepActivity(rule.id, index, Number(e.target.value))}
                      >
                        <option value="">Selecione...</option>
                        {activityTypes.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {canChange && (
                        <>
                          <button className="btn btn-outline btn-sm" onClick={() => moveStep(rule.id, index, -1)} disabled={index === 0} title="Subir">
                            <Icon name="arrow_upward" style={{ fontSize: 13 }} />
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => moveStep(rule.id, index, 1)}
                            disabled={index === steps.length - 1}
                            title="Descer"
                          >
                            <Icon name="arrow_downward" style={{ fontSize: 13 }} />
                          </button>
                          <button className="btn btn-outline btn-sm" onClick={() => removeStep(rule.id, index)} title="Remover">
                            <Icon name="close" style={{ fontSize: 13 }} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  {canChange && (
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 8 }}>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn btn-outline btn-sm" onClick={() => addStep(rule.id)}>
                          <Icon name="add" style={{ fontSize: 13 }} />
                          Atividade
                        </button>
                        <button className="btn btn-outline btn-sm" onClick={() => toggleActive(rule)}>
                          {rule.is_active ? "Desativar" : "Ativar"}
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        {canDelete && (
                          <button className="btn btn-outline btn-sm" onClick={() => handleDelete(rule)} style={{ color: "var(--red)" }}>
                            Excluir Regra
                          </button>
                        )}
                        <button className="btn btn-primary btn-sm" onClick={() => saveSteps(rule)} disabled={savingId === rule.id}>
                          {savingId === rule.id ? "Salvando..." : "Salvar Etapas"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
