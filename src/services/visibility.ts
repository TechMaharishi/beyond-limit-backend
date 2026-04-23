export type UserRoleInput = string | string[] | null | undefined;
export type VideoVisibility = "clinicians" | "users" | "all" | null | undefined;

const CLINICIAN_ROLES = new Set(["admin", "trainer", "trainee"]);

const isAdmin = (role: UserRoleInput): boolean => {
  if (role == null) return false;
  if (Array.isArray(role)) return role.some((r) => String(r).toLowerCase() === "admin");
  return String(role).toLowerCase() === "admin";
};

const isClinician = (role: UserRoleInput): boolean => {
  if (role == null) return false;
  if (Array.isArray(role)) return role.some((r) => CLINICIAN_ROLES.has(String(r).toLowerCase()));
  return CLINICIAN_ROLES.has(String(role).toLowerCase());
};

const normalizeVisibility = (v: VideoVisibility): "clinicians" | "users" | "all" => {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "clinicians" || s === "users" || s === "all" ? (s as any) : "all";
};

export const canViewVideo = (role: UserRoleInput, visibility: VideoVisibility): boolean => {
  const vis = normalizeVisibility(visibility);
  if (isAdmin(role)) return true;
  if (vis === "all") return true;
  const clinician = isClinician(role);
  if (vis === "clinicians") return clinician;
  if (vis === "users") return !clinician;
  return true;
};

export const allowedVisibilitiesForRole = (role: UserRoleInput): ("clinicians" | "users" | "all")[] => {
  if (isAdmin(role)) return ["clinicians", "users", "all"];
  const clinician = isClinician(role);
  return clinician ? ["clinicians", "all"] : ["users", "all"];
};

export const buildVisibilityFilterForRole = (role: UserRoleInput) => {
  const allowed = allowedVisibilitiesForRole(role);
  return { visibility: { $in: allowed } } as any;
};