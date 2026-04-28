/**
 * Returns true if `role` matches any of the given role names.
 * Handles both string and array role values (Better Auth can return either).
 */
export function isRoleIn(role: unknown, ...roles: string[]): boolean {
  const set = new Set(roles);
  if (Array.isArray(role)) return role.some((r) => set.has(String(r)));
  return set.has(String(role));
}
