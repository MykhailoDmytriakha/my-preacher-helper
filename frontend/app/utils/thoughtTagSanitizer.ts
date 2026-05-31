import { normalizeStructureTag } from '@/utils/structureTags';

function normalizeTagKey(tag: string): string {
  return tag.trim().replace(/\s+/g, ' ').toLowerCase();
}

function dedupePreservingOrder(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  tags.forEach((tag) => {
    const normalized = tag.trim();
    if (!normalized) return;

    const key = normalizeTagKey(normalized);
    if (seen.has(key)) return;

    seen.add(key);
    result.push(normalized);
  });

  return result;
}

export function stripStructureTags(tags: string[] | null | undefined): string[] {
  if (!Array.isArray(tags)) return [];
  return dedupePreservingOrder(tags.filter((tag) => normalizeStructureTag(tag) === null));
}

export function sanitizeAvailableThoughtTags(availableTags: string[] | null | undefined): string[] {
  return stripStructureTags(availableTags);
}

export function sanitizeThoughtTags(
  tags: string[] | null | undefined,
  availableTags: string[] | null | undefined
): string[] {
  const allowedTags = sanitizeAvailableThoughtTags(availableTags);
  if (allowedTags.length === 0 || !Array.isArray(tags)) return [];

  const allowedByKey = new Map(allowedTags.map((tag) => [normalizeTagKey(tag), tag]));
  const result: string[] = [];
  const seen = new Set<string>();

  tags.forEach((tag) => {
    if (normalizeStructureTag(tag) !== null) return;

    const allowedTag = allowedByKey.get(normalizeTagKey(tag));
    if (!allowedTag) return;

    const key = normalizeTagKey(allowedTag);
    if (seen.has(key)) return;

    seen.add(key);
    result.push(allowedTag);
  });

  return result;
}
