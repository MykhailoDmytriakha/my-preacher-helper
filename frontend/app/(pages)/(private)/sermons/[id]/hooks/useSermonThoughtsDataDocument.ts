import { useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { contentFingerprint } from '@/utils/contentFingerprint';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { findThoughtSectionInStructure, insertThoughtIdInStructure, removeThoughtIdFromStructure, resolveSectionForNewThought } from '@/utils/thoughtOrdering';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, Thought } from '@/models/models';

export type ThoughtFieldPatch = Partial<Omit<Thought, 'id'>>;
const fields = new Set(['text', 'tags', 'date', 'outlinePointId', 'subPointId', 'position', 'isLocked', 'keyFragments']);
const unavailable = () => new Error('The sermon is not available for editing');
const json = (sermon: Sermon): DocumentData => deepCleanUndefined(sermon) as unknown as DocumentData;

/** A thought and its placement are one document edit, never two best-effort writes. */
export function useSermonThoughtsDataDocument(sermonId: string | null) {
  const document = useDataDocument(sermonId ? { collection: 'sermons', id: sermonId } : null, { slot: 'thoughts' });
  const { owner } = useDataEngine();
  const isReadOnly = !owner || !document.data || document.data.userId !== owner
    || Boolean(document.confirmed?.metadata?.deleted || (document.remote && document.remote.value === null));
  const commit = async (mutate: (current: Sermon) => Sermon): Promise<{ delivery: 'queued' }> => {
    if (isReadOnly) throw unavailable();
    await document.commit(current => {
      if (!current || current.userId !== owner) throw unavailable();
      return json(mutate(current as unknown as Sermon));
    });
    return { delivery: 'queued' };
  };
  const withPlacement = (current: Sermon, thought: Thought, thoughts: Thought[]): Sermon => {
    const section = resolveSectionForNewThought({ sermon: current, outlinePointId: thought.outlinePointId, tags: thought.tags });
    const structure = insertThoughtIdInStructure({
      structure: current.structure ?? current.thoughtsBySection, section, thoughtId: thought.id,
      outlinePointId: thought.outlinePointId, thoughts, thoughtsById: new Map(thoughts.map(item => [item.id, item])), outline: current.outline,
    });
    return { ...current, thoughts, structure, thoughtsBySection: structure };
  };
  const addThought = (thought: Thought) => commit(current => {
    const existing = current.thoughts.find(item => item.id === thought.id);
    if (existing) {
      if (contentFingerprint(existing) !== contentFingerprint(thought)) throw new Error('A different thought already uses this ID');
      return current;
    }
    return withPlacement(current, thought, [thought, ...current.thoughts]);
  });
  const patchThought = (id: string, patch: ThoughtFieldPatch) => commit(current => {
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
  });
  const deleteThought = (id: string) => commit(current => {
    const thoughts = current.thoughts.filter(item => item.id !== id);
    const structure = removeThoughtIdFromStructure(current.structure ?? current.thoughtsBySection, id);
    return { ...current, thoughts, structure, thoughtsBySection: structure };
  });
  return { ...document, thoughts: (document.data?.thoughts ?? []) as unknown as Thought[], isReadOnly, addThought, patchThought, deleteThought };
}
