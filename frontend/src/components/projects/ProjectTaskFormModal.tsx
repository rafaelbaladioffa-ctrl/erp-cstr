import { useEffect, useMemo, useState } from "react";
import { projectTasksApi, projectsApi, registryApi } from "../../api/resources";
import type { CollaboratorFull, Project, ProjectTask, RackPosition, TaskFull } from "../../api/types";
import DynamicForm, { type FieldConfig, type FormValues } from "../ui/DynamicForm";
import Modal from "../ui/Modal";

type ApiErrors = Record<string, string[]>;

const STATUS_OPTIONS = [
  { value: "not_started", label: "Não Iniciada" },
  { value: "in_progress", label: "Em Andamento" },
  { value: "paused", label: "Pausada" },
  { value: "completed", label: "Concluída" },
  { value: "canceled", label: "Cancelada" },
];

export default function ProjectTaskFormModal({
  project,
  projectTask,
  existingTasks,
  rackPositions,
  onClose,
  onSaved,
}: {
  project: Project;
  projectTask: ProjectTask | null;
  existingTasks: ProjectTask[];
  rackPositions: RackPosition[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalogTasks, setCatalogTasks] = useState<TaskFull[]>([]);
  const [collaborators, setCollaborators] = useState<CollaboratorFull[]>([]);
  const [loadingRefs, setLoadingRefs] = useState(true);

  const [values, setValues] = useState<FormValues>(
    projectTask
      ? {
          ...projectTask,
          collaborator_ids: projectTask.collaborators.map((c) => c.id),
          estimated_hours: projectTask.estimated_hours,
        }
      : {
          task: null,
          status: "not_started",
          planned_start: null,
          planned_end: null,
          estimated_hours: null,
          collaborator_ids: [],
          rack_positions: [],
          notes: "",
        }
  );
  const [errors, setErrors] = useState<ApiErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.allSettled([
      registryApi.tasks.list({ page_size: "500", is_active: "true" } as never),
      registryApi.collaborators.list({ page_size: "500" } as never),
    ])
      .then(([t, c]) => {
        if (t.status === "fulfilled") setCatalogTasks(t.value.results);
        if (c.status === "fulfilled") setCollaborators(c.value.results);
      })
      .finally(() => setLoadingRefs(false));
  }, []);

  const availableCatalogTasks = useMemo(() => {
    const others = existingTasks.filter((t) => t.id !== projectTask?.id);
    if (project.has_rack_positions && rackPositions.length > 0) {
      // Com Rack Position, uma Tarefa do catálogo só fica indisponível
      // quando já cobre todos os Rack Positions do projeto.
      const coveredByTask = new Map<number, Set<number>>();
      others.forEach((t) => {
        const set = coveredByTask.get(t.task) ?? new Set<number>();
        t.rack_positions.forEach((rpId) => set.add(rpId));
        coveredByTask.set(t.task, set);
      });
      return catalogTasks.filter((t) => (coveredByTask.get(t.id)?.size ?? 0) < rackPositions.length);
    }
    const alreadyUsed = new Set(others.map((t) => t.task));
    return catalogTasks.filter((t) => !alreadyUsed.has(t.id));
  }, [catalogTasks, existingTasks, projectTask, project.has_rack_positions, rackPositions]);

  const companyCollaborators = useMemo(
    () => collaborators.filter((c) => !project.company || c.company === project.company),
    [collaborators, project.company]
  );

  const fields: FieldConfig[] = useMemo(() => {
    const base: FieldConfig[] = [
      {
        name: "task",
        label: "Tarefa",
        type: "select",
        required: true,
        span: 2,
        options: availableCatalogTasks.map((t) => ({ value: t.id, label: t.name })),
      },
      { name: "status", label: "Status", type: "select", required: true, options: STATUS_OPTIONS },
      { name: "estimated_hours", label: "Horas Previstas", type: "number" },
      { name: "planned_start", label: "Início Previsto", type: "datetime" },
      { name: "planned_end", label: "Término Previsto", type: "datetime" },
      {
        name: "collaborator_ids",
        label: "Responsáveis",
        type: "multiselect",
        span: 2,
        options: companyCollaborators.map((c) => ({ value: c.id, label: c.name })),
      },
    ];
    if (project.has_rack_positions) {
      base.push({
        name: "rack_positions",
        label: "Rack Positions",
        type: "multiselect",
        span: 2,
        options: rackPositions.map((rp) => ({ value: rp.id, label: rp.position })),
      });
    }
    base.push({ name: "notes", label: "Observações", type: "textarea", span: 2 });
    return base;
  }, [availableCatalogTasks, companyCollaborators, project.has_rack_positions, rackPositions]);

  async function handleSave() {
    setSaving(true);
    setErrors({});
    try {
      if (projectTask) {
        await projectTasksApi.update(projectTask.id, values);
      } else {
        const rackPositionIds = (values.rack_positions as number[] | undefined) ?? [];
        const result = await projectsApi.createTasks(project.id, {
          task: values.task as number,
          rack_position_ids: rackPositionIds,
          status: values.status as string,
          planned_start: values.planned_start as string | null,
          planned_end: values.planned_end as string | null,
          estimated_hours: values.estimated_hours as number | null,
          collaborator_ids: (values.collaborator_ids as number[] | undefined) ?? [],
          notes: values.notes as string,
        });
        if (rackPositionIds.length > 1) {
          let message = `${result.created} tarefa(s) criada(s) (uma por Rack Position selecionado).`;
          if (result.skipped) message += ` ${result.skipped} já existia(m) para o(s) Rack Position(s) selecionado(s) e foi(ram) ignorada(s).`;
          alert(message);
        }
      }
      onSaved();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: ApiErrors } };
      if (axiosErr.response?.data) setErrors(axiosErr.response.data);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={projectTask ? `Editar Tarefa — ${projectTask.task_name}` : "Nova Tarefa"} onClose={onClose} width={640}>
      {loadingRefs ? (
        <p style={{ color: "var(--text-muted)" }}>Carregando...</p>
      ) : (
        <>
          {projectTask ? (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginBottom: 10 }}>
              Tarefa: <strong>{projectTask.task_name}</strong> (não é possível trocar a tarefa após criada)
            </p>
          ) : null}
          <DynamicForm
            fields={projectTask ? fields.filter((f) => f.name !== "task") : fields}
            values={values}
            errors={errors}
            onChange={(name, value) => setValues((prev) => ({ ...prev, [name]: value }))}
          />
          {!projectTask && project.has_rack_positions && (
            <p style={{ color: "var(--text-muted)", fontSize: 12.5, marginTop: -6, marginBottom: 12 }}>
              Selecionar vários Rack Positions cria uma tarefa separada para cada um (não uma tarefa só cobrindo todos).
            </p>
          )}
          {errors.non_field_errors && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{errors.non_field_errors.join(" ")}</p>}
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
