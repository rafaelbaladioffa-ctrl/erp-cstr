import type { Me } from "../api/types";

export function hasPerm(user: Me | null, permission: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return user.permissions.includes(permission);
}

export const PERMS = {
  viewProject: "projects.view_project",
  viewDailyUpdate: "updates.view_dailyupdate",
  addDailyUpdate: "updates.add_dailyupdate",
  changeDailyUpdate: "updates.change_dailyupdate",
  viewProjectUpdate: "updates.view_projectdailyupdate",
  addProjectUpdate: "updates.add_projectdailyupdate",
  changeProjectUpdate: "updates.change_projectdailyupdate",
  viewMyTasks: "technical.view_mytask",
  changeMyTasks: "technical.change_mytask",
};
