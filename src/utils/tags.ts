import { Tag } from "@/models/tags";
import { normalizeTag } from "@/utils/string";

/**
 * Resolves raw tag input (string or array) to active slug strings.
 * Returns only slugs that exist and are active in the Tag collection.
 */
export async function resolveTagSlugs(input: string[] | string): Promise<string[]> {
  const raw = typeof input === "string"
    ? input.split(",").map((t) => t.trim()).filter(Boolean)
    : input;
  const normalized = Array.from(new Set(raw.map(normalizeTag)));
  const existing = await Tag.find({ slug: { $in: normalized }, active: true }).select("slug").lean();
  return existing.map((c: any) => c.slug);
}
