import { contentFingerprint } from '@/utils/contentFingerprint';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { getCanonicalTagForSection, normalizeStructureTag } from '@/utils/structureTags';
import { findThoughtSectionInStructure, insertThoughtIdInStructure, removeThoughtIdFromStructure, resolveSectionForNewThought } from '@/utils/thoughtOrdering';

import type { Sermon, SermonOutline, Thought } from '@/models/models';

export type ThoughtFieldPatch = Partial<Omit<Thought, 'id'>>;
const fields = new Set(['text', 'tags', 'date', 'outlinePointId', 'subPointId', 'position', 'isLocked', 'keyFragments']);

/** Pure domain transforms; persistence, ancestors and conflict resolution belong to DataEngine. */
const withPlacement = (current: Sermon, thought: Thought, thoughts: Thought[]): Sermon => {
  const section = resolveSectionForNewThought({ sermon: current, outlinePointId: thought.outlinePointId, tags: thought.tags });
  const structure = insertThoughtIdInStructure({
    structure: current.structure ?? current.thoughtsBySection, section, thoughtId: thought.id,
    outlinePointId: thought.outlinePointId, thoughts, thoughtsById: new Map(thoughts.map(item => [item.id, item])), outline: current.outline,
  });
  return { ...current, thoughts, structure, thoughtsBySection: structure };
};
export const addSermonThought = (current: Sermon, thought: Thought): Sermon => {
  const existing = current.thoughts.find(item => item.id === thought.id);
  if (existing) {
    if (contentFingerprint(existing) !== contentFingerprint(thought)) throw new Error('A different thought already uses this ID');
    return current;
  }
  return withPlacement(current, thought, [thought, ...current.thoughts]);
};
export const patchSermonThought = (current: Sermon, id: string, patch: ThoughtFieldPatch): Sermon => {
  if (Object.keys(patch).some(key => !fields.has(key))) throw new Error('Unsupported thought field');
  const existing = current.thoughts.find(item => item.id === id);
  if (!existing) throw new Error('The thought was deleted');
  const next: Thought = deepCleanUndefined({ ...existing, ...patch });
  if (Object.prototype.hasOwnProperty.call(patch, 'outlinePointId') && (patch.outlinePointId ?? null) !== (existing.outlinePointId ?? null)
    && !Object.prototype.hasOwnProperty.call(patch, 'subPointId')) next.subPointId = null;
  const thoughts = current.thoughts.map(item => item.id === id ? next : item);
  const previousSection = findThoughtSectionInStructure(current.structure ?? current.thoughtsBySection, id);
  const nextSection = resolveSectionForNewThought({ sermon: current, outlinePointId: next.outlinePointId, tags: next.tags });
  return previousSection !== nextSection || (existing.outlinePointId ?? null) !== (next.outlinePointId ?? null)
    ? withPlacement(current, next, thoughts) : { ...current, thoughts };
};
export const deleteSermonThought = (current: Sermon, id: string): Sermon => {
  const thoughts = current.thoughts.filter(item => item.id !== id);
  const structure = removeThoughtIdFromStructure(current.structure ?? current.thoughtsBySection, id);
  return { ...current, thoughts, structure, thoughtsBySection: structure };
};

const outlineEntries = (outline?: SermonOutline) => (['introduction', 'main', 'conclusion'] as const)
  .flatMap(section => (outline?.[section] ?? []).map(point => ({ point, section })));

/** Replace an outline and repair only the assignments affected by this explicit outline edit. */
export function replaceSermonOutline(current: Sermon, outline: SermonOutline): Sermon {
  const before = outlineEntries(current.outline), after = outlineEntries(outline);
  let next: Sermon = { ...current, outline };
  for (const thought of current.thoughts ?? []) {
    const previous = before.find(entry => entry.point.id === thought.outlinePointId);
    if (!previous) continue;
    const patch = outlineThoughtPatch(thought, previous, after);
    if (Object.keys(patch).length) next = patchSermonThought(next, thought.id, patch);
  }
  return next;
}

function outlineThoughtPatch(thought: Thought, previous: ReturnType<typeof outlineEntries>[number], after: ReturnType<typeof outlineEntries>): ThoughtFieldPatch {
  const hadSub = Boolean(thought.subPointId && previous.point.subPoints?.some(sub => sub.id === thought.subPointId));
  const movedSub = hadSub ? after.find(entry => entry.point.subPoints?.some(sub => sub.id === thought.subPointId)) : undefined;
  const promotedSub = hadSub ? after.find(entry => entry.point.id === thought.subPointId) : undefined;
  const nestedPoint = after.find(entry => entry.point.subPoints?.some(sub => sub.id === thought.outlinePointId));
  const target = movedSub ?? promotedSub ?? nestedPoint ?? after.find(entry => entry.point.id === thought.outlinePointId);
  const patch: ThoughtFieldPatch = {};
  if (!target) { patch.outlinePointId = null; patch.subPointId = null; }
  else {
    if (target.point.id !== thought.outlinePointId) { patch.outlinePointId = target.point.id; patch.subPointId = thought.subPointId ?? null; }
    if (promotedSub) patch.subPointId = null;
    else if (nestedPoint && !movedSub) patch.subPointId = thought.outlinePointId;
    else if (hadSub && !movedSub) patch.subPointId = null;
    if (target.section !== previous.section) patch.tags = [
      ...thought.tags.filter(tag => !normalizeStructureTag(tag)), getCanonicalTagForSection(target.section),
    ];
  }
  return patch;
}
