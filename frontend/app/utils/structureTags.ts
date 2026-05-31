/**
 * Pure structural-tag utilities shared by server and client code.
 *
 * Structural tags are legacy section markers. Sermon placement now belongs to
 * outlinePointId/subPointId and structure metadata, not to thought.tags.
 */
export type CanonicalStructureId = 'intro' | 'main' | 'conclusion';

export type StructureSectionId = 'introduction' | 'main' | 'conclusion';

export const SECTION_TO_CANONICAL: Record<StructureSectionId, CanonicalStructureId> = {
  introduction: 'intro',
  main: 'main',
  conclusion: 'conclusion',
};

export const CANONICAL_TO_SECTION: Record<CanonicalStructureId, StructureSectionId> = {
  intro: 'introduction',
  main: 'main',
  conclusion: 'conclusion',
};

const STRUCTURE_ALIAS_TO_CANONICAL: Record<string, CanonicalStructureId> = {
  introduction: 'intro',
  intro: 'intro',
  'main part': 'main',
  mainpart: 'main',
  main: 'main',
  conclusion: 'conclusion',

  'вступление': 'intro',
  'основная часть': 'main',
  'заключение': 'conclusion',

  'вступ': 'intro',
  'основна частина': 'main',
  'висновок': 'conclusion',
};

export function normalizeStructureTag(tag: string | undefined | null): CanonicalStructureId | null {
  if (!tag) return null;
  const key = String(tag).trim().replace(/\s+/g, ' ').toLowerCase();
  return STRUCTURE_ALIAS_TO_CANONICAL[key] ?? null;
}

export function getCanonicalTagForSection(sectionId: StructureSectionId): CanonicalStructureId {
  return SECTION_TO_CANONICAL[sectionId];
}

export const CANONICAL_TO_TRANSLATION_KEY: Record<CanonicalStructureId, string> = {
  intro: 'tags.introduction',
  main: 'tags.mainPart',
  conclusion: 'tags.conclusion',
};

export function getTranslationKeyForTag(tag: string): string | null {
  const canonical = normalizeStructureTag(tag);
  if (canonical) return CANONICAL_TO_TRANSLATION_KEY[canonical];
  return null;
}

export const isStructureTag = (tag: string): boolean => normalizeStructureTag(tag) !== null;
