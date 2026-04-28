/**
 * Escapes special regex characters so user-supplied strings are treated as literals.
 * Use this before passing any user input into a MongoDB $regex query.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Normalizes a tag string to a URL-friendly slug. */
export function normalizeTag(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, "-");
}
