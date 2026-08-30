import type { Me } from "../api/types";

export function hasPerm(user: Me | null, permission: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return user.permissions.includes(permission);
}

export function hasAnyPerm(user: Me | null, permissions: string[]): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return permissions.some((p) => user.permissions.includes(p));
}

export interface ModelPerms {
  view: string;
  add: string;
  change: string;
  delete: string;
}

/** Monta os 4 codenames padrão do Django (view/add/change/delete) para um
 * model — espelha exatamente o que o Django cria automaticamente para
 * cada model e o que os Grupos concedem no Admin. */
export function modelPerms(app: string, model: string): ModelPerms {
  return {
    view: `${app}.view_${model}`,
    add: `${app}.add_${model}`,
    change: `${app}.change_${model}`,
    delete: `${app}.delete_${model}`,
  };
}

export const PERMS = {
  viewProject: "projects.view_project",
  addProject: "projects.add_project",
  changeProject: "projects.change_project",
  deleteProject: "projects.delete_project",
  addRackPosition: "projects.add_rackposition",
  changeRackPosition: "projects.change_rackposition",
  deleteRackPosition: "projects.delete_rackposition",
  addProjectTask: "projects.add_projecttask",
  changeProjectTask: "projects.change_projecttask",
  deleteProjectTask: "projects.delete_projecttask",
  viewWorkBlock: "projects.view_workblock",
  addWorkBlock: "projects.add_workblock",
  changeWorkBlock: "projects.change_workblock",
  deleteWorkBlock: "projects.delete_workblock",
  viewProjectItem: "projects.view_projectitem",
  addProjectItem: "projects.add_projectitem",
  changeProjectItem: "projects.change_projectitem",
  deleteProjectItem: "projects.delete_projectitem",
  viewActivityType: "core.view_activitytype",
  viewProjectItemType: "core.view_projectitemtype",
  viewProjectOccurrence: "projects.view_projectoccurrence",
  addProjectOccurrence: "projects.add_projectoccurrence",
  changeProjectOccurrence: "projects.change_projectoccurrence",
  deleteProjectOccurrence: "projects.delete_projectoccurrence",
  viewProjectAttachment: "projects.view_projectattachment",
  addProjectAttachment: "projects.add_projectattachment",
  deleteProjectAttachment: "projects.delete_projectattachment",
  viewDailyUpdate: "updates.view_dailyupdate",
  addDailyUpdate: "updates.add_dailyupdate",
  changeDailyUpdate: "updates.change_dailyupdate",
  viewProjectUpdate: "updates.view_projectdailyupdate",
  addProjectUpdate: "updates.add_projectdailyupdate",
  changeProjectUpdate: "updates.change_projectdailyupdate",
  viewMyTasks: "technical.view_mytask",
  changeMyTasks: "technical.change_mytask",
  viewPresence: "dispatch.view_techniciandailypresence",
  addPresence: "dispatch.add_techniciandailypresence",
  viewOperationsBoard: "projects.view_projecttaskassignment",
  dispatchTask: "projects.change_projecttask",
  viewCompany: "core.view_company",
  viewClient: "core.view_client",
  viewSite: "core.view_site",
  changeSite: "core.change_site",
  viewCategory: "core.view_category",
  viewProjectType: "core.view_projecttype",
  viewJobTitle: "core.view_jobtitle",
  viewCollaborator: "core.view_collaborator",
  viewResponsible: "core.view_responsible",
  viewTask: "core.view_task",
};

export const CADASTROS_PERMS = [
  PERMS.viewCompany,
  PERMS.viewClient,
  PERMS.viewSite,
  PERMS.viewCategory,
  PERMS.viewProjectType,
  PERMS.viewJobTitle,
  PERMS.viewCollaborator,
  PERMS.viewResponsible,
  PERMS.viewTask,
  PERMS.viewActivityType,
  PERMS.viewProjectItemType,
];
