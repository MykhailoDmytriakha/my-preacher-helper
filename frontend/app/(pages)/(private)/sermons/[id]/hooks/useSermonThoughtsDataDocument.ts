import { useDataDocument, useDataEngine } from '@/data-engine/react.client';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { addSermonThought, patchSermonThought, deleteSermonThought } from '@/utils/sermonThoughtEdits';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, Thought } from '@/models/models';
import type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';
export type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';

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
  const addThought = (thought: Thought) => commit(current => addSermonThought(current, thought));
  const patchThought = (id: string, patch: ThoughtFieldPatch) => commit(current => patchSermonThought(current, id, patch));
  const deleteThought = (id: string) => commit(current => deleteSermonThought(current, id));
  return { ...document, thoughts: (document.data?.thoughts ?? []) as unknown as Thought[], isReadOnly, addThought, patchThought, deleteThought };
}
