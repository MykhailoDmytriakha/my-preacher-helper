import { chooseOutlineChanges } from '@/utils/outlineChoiceCore';
import { mergeOutlineOrder } from '@/utils/outlineMergeParts';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { normalizeStructureTag } from '@/utils/structureTags';
import { findThoughtSectionInStructure, resolveSectionFromOutline, resolveSectionFromTags, SECTION_ORDER } from '@/utils/thoughtOrdering';

import { equalValues, object } from './fieldValues';

import type { DocumentData, FieldValue, Json } from './types';
import type { OutlinePoint, Sermon, SermonOutline, Thought, ThoughtsBySection } from '@/models/models';
import type { SectionKey } from '@/utils/thoughtOrdering';

type MergeFields = (base: FieldValue, mine: FieldValue, theirs: FieldValue) => { value: FieldValue };
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const rows = (value: Json | undefined): DocumentData[] => Array.isArray(value) ? value.filter(object) : [];
const thoughts = (value: DocumentData) => new Map(rows(value.thoughts).map(thought => [String(thought.id), thought]));
const storedPlacement = (value: DocumentData): DocumentData =>
  object(value.structure) ? value.structure : object(value.thoughtsBySection) ? value.thoughtsBySection : {};
const sequence = (value: DocumentData, section: SectionKey): string[] => {
  const ids = storedPlacement(value)[section];
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
};
const outlineOf = (value: DocumentData): SermonOutline | undefined => value.outline as unknown as SermonOutline | undefined;
const emptyOutline = (): SermonOutline => ({ introduction: [], main: [], conclusion: [] });
const positionKeys = ['outlinePointId', 'subPointId', 'position'] as const;

function sectionOf(value: DocumentData, thought: DocumentData): SectionKey | null {
  return resolveSectionFromOutline(value as unknown as Sermon, thought.outlinePointId as string | null)
    ?? findThoughtSectionInStructure(storedPlacement(value) as unknown as ThoughtsBySection, String(thought.id))
    ?? resolveSectionFromTags(thought.tags as string[]);
}

function placementChanged(base: DocumentData, mine: DocumentData, before: DocumentData | undefined, here: DocumentData): boolean {
  if (!before) return true;
  if (positionKeys.some(key => !equalValues(before[key] ?? null, here[key] ?? null))) return true;
  // Relative list order is merged separately; moving a neighbor does not move this identity.
  return sectionOf(mine, here) !== sectionOf(base, before);
}

/** Legacy section markers travel with a selected placement; custom tags remain ordinary fields. */
function selectPlacementTags(chosen: DocumentData, source: DocumentData): void {
  if (!Array.isArray(chosen.tags) || !Array.isArray(source.tags)) return;
  const structural = (tag: Json) => typeof tag === 'string' && normalizeStructureTag(tag) !== null;
  chosen.tags = [...chosen.tags.filter(tag => !structural(tag)), ...source.tags.filter(structural)];
}

interface ThoughtChoice { value: DocumentData; side: DocumentData; local: boolean }

/** Select only positional intent; independently merged words stay in the existing candidate. */
function thoughtChoices(base: DocumentData, mine: DocumentData, theirs: DocumentData, candidate: DocumentData): ThoughtChoice[] {
  const b = thoughts(base), m = thoughts(mine), t = thoughts(theirs);
  return rows(candidate.thoughts).map(value => {
    const id = String(value.id), here = m.get(id), there = t.get(id);
    const localChange = Boolean(here && placementChanged(base, mine, b.get(id), here));
    const local = Boolean(here && (!there || localChange));
    const source = local ? here : there ?? here;
    const positionChanged = local ? localChange : Boolean(there && placementChanged(base, theirs, b.get(id), there));
    const chosen = { ...value };
    if (source) for (const key of positionKeys) {
      if (Object.prototype.hasOwnProperty.call(source, key)) chosen[key] = source[key];
      else delete chosen[key];
    }
    if (source && positionChanged) selectPlacementTags(chosen, source);
    return { value: chosen, side: local ? mine : theirs, local };
  });
}

function chooseSermonOutline(base: DocumentData, mine: DocumentData, theirs: DocumentData,
  choices: ThoughtChoice[], merge: MergeFields): SermonOutline | undefined {
  const local = outlineOf(mine), remote = outlineOf(theirs);
  if (!local) return equalValues(base.outline, mine.outline) ? remote : undefined;
  const requiredIds = choices.filter(choice => choice.local).flatMap(choice =>
    [choice.value.outlinePointId, choice.value.subPointId].filter((id): id is string => typeof id === 'string' && id.length > 0));
  const present = new Set(Object.values(remote ?? emptyOutline()).flatMap((points: OutlinePoint[]) =>
    points.flatMap(point => [point.id, ...(point.subPoints ?? []).map(sub => sub.id)])));
  if (equalValues(base.outline, mine.outline) && requiredIds.every(id => present.has(id))) return remote;
  return chooseOutlineChanges(outlineOf(base), local, remote, merge, { requiredIds, retainLocalPaths: true });
}

/** The canonical outline transform follows promotions, reparenting and section changes. */
function placeThought(choice: ThoughtChoice, outline: SermonOutline | undefined): { value: DocumentData; section: SectionKey | null } {
  const source: Sermon = { ...choice.side, thoughts: [choice.value as unknown as Thought] } as unknown as Sermon;
  const repaired = replaceSermonOutline(source, outline ?? emptyOutline()).thoughts[0];
  const target = { ...choice.side, outline: outline as unknown as Json, thoughts: [repaired as unknown as Json] };
  return { value: repaired as unknown as DocumentData, section: sectionOf(target, repaired as unknown as DocumentData) };
}

function placeThoughts(base: DocumentData, mine: DocumentData, theirs: DocumentData,
  candidate: DocumentData, choices: ThoughtChoice[], outline: SermonOutline | undefined): void {
  const chosen = choices.map(choice => placeThought(choice, outline));
  candidate.thoughts = chosen.map(choice => choice.value);
  const placement: DocumentData = {};
  for (const section of SECTION_ORDER) {
    const wanted = new Set(chosen.filter(choice => choice.section === section).map(choice => String(choice.value.id)));
    const ordered = mergeOutlineOrder(sequence(base, section), sequence(mine, section), sequence(theirs, section), wanted);
    const ids = [...ordered, ...[...wanted].filter(id => !ordered.includes(id))];
    if (ids.length || [base, mine, theirs].some(value => Object.prototype.hasOwnProperty.call(storedPlacement(value), section))) placement[section] = ids;
  }
  // Older sermons may store only one alias. Do not create an unrelated missing field.
  for (const field of ['structure', 'thoughtsBySection']) {
    if (Object.prototype.hasOwnProperty.call(candidate, field)) candidate[field] = { ...(object(candidate[field]) ? candidate[field] : {}), ...copy(placement) };
  }
}

/** Explicit choice only: the unchanged server merge and integrity checks still own every retry. */
export function chooseLocalPlacement(collection: string, base: DocumentData | null, mine: DocumentData | null,
  theirs: DocumentData | null, merged: DocumentData | null, merge: MergeFields): DocumentData | null {
  if (!base || !mine || !theirs || !merged) return merged;
  if (collection === 'planTemplates' && object(mine.structure)) {
    return { ...merged, structure: chooseOutlineChanges(base.structure as unknown as SermonOutline,
      mine.structure as unknown as SermonOutline, theirs.structure as unknown as SermonOutline, merge,
      { retainLocalPaths: true }) as unknown as Json };
  }
  if (collection !== 'sermons' || !Array.isArray(mine.thoughts)) return merged;
  const candidate = copy(merged), choices = thoughtChoices(base, mine, theirs, candidate);
  const outline = chooseSermonOutline(base, mine, theirs, choices, merge);
  if (outline) candidate.outline = outline as unknown as Json;
  placeThoughts(base, mine, theirs, candidate, choices, outline);
  return candidate;
}
