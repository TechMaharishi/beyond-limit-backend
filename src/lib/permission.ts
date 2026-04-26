import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/admin/access";

// Define custom RBAC statements
const statement = {
  ...defaultStatements,
  assignCourse: ["create", "view", "delete"],
  assignShorts: ["create", "view", "delete"],
  trainee: ["view", "update"],
  shortVideo: ["create", "view"],
  shortVideoStatus: ["create", "view"],
  course: ["create", "update", "delete", "view"],
  courseVideoStatus: ["create", "view"],
  tag: ["create", "view", "update", "delete"],
  ticket: ["create", "resolve", "view"],
  user: ["ban", "create", "list", "delete", "reset-password", "update"],
  profile: ["create", "view", "update", "delete", "manage"],
} as const;

export const ac = createAccessControl(statement);

// Roles
export const user = ac.newRole({
  assignCourse: ["view"],
  trainee: ["view"],
  shortVideo: ["view"],
  course: ["view"],
  tag: ["view"],
  user: ["list"],
  ticket: ["create", "view"],
  profile: ["create", "view", "update", "delete"],
});

export const trainee = ac.newRole({
  assignCourse: ["create", "view", "delete"],
  assignShorts: ["create", "view", "delete"],
  trainee: ["view"],
  shortVideo: ["create", "view"],
  shortVideoStatus: ["view"],
  course: ["view"],
  tag: ["view"],
  user: ["list"],
  ticket: ["create", "view"],
  profile: ["view"],
});

export const trainer = ac.newRole({
  assignCourse: ["create", "view", "delete"],
  assignShorts: ["create", "view", "delete"],
  trainee: ["view", "update"],
  shortVideo: ["view", "create"],
  shortVideoStatus: ["view"],
  courseVideoStatus: ["create", "view"],
  course: ["create", "update", "delete", "view"],
  tag: ["create", "view", "update", "delete"],
  user: ["list", "ban"],
  ticket: ["create", "view"],
  profile: ["view"],
});

export const admin = ac.newRole({
  assignCourse: ["create", "view", "delete"],
  assignShorts: ["create", "view", "delete"],
  trainee: ["view", "update"],
  shortVideo: ["create", "view"],
  shortVideoStatus: ["create", "view"],
  course: ["create", "update", "delete", "view"],
  courseVideoStatus: ["create", "view"],
  tag: ["create", "view", "update", "delete"],
  ticket: ["resolve", "view"],
  user: ["ban", "create", "list", "delete", "reset-password", "update"],
  profile: ["create", "view", "update", "delete", "manage"],
});
