import { useMemo, useRef } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { changedFields } from '@/utils/changedFields';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { mergeOutline } from '@/utils/mergeOutline';
import { mergeSections } from '@/utils/mergeSections';
import { addSermonThought, deleteSermonThought, patchSermonThought, replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import type { StructureWriter } from './structureWriter';
import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline } from '@/models/models';
import type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';

type SermonDocument = ReturnType<typeof useDataDocument>;

const THOUGHT_FIELDS: (keyof ThoughtFieldPatch)[] = ['text', 'tags', 'date', 'outlinePointId', 'subPointId', 'position', 'isLocked', 'keyFragments'];
const asSermon = (value: DocumentData): Sermon => ({ ...value, thoughts: (value.thoughts ?? []) } as unknown as Sermon);
const asDocument = (sermon: Sermon): DocumentData => deepCleanUndefined(sermon) as unknown as DocumentData;
const unavailable = () => new Error('The sermon is not available for editing');

/**
 * The structure screen's writes on an engine document. Each change is laid over the CURRENT
 * copy with the same merge rule the legacy writer applies on the server (mergeSections,
 * changedFields, mergeOutline) and the editor's own transforms, so a remote edit that landed
 * after this screen opened is kept rather than overwritten by the screen's older picture.
 */
/** One edit of the owner's sermon draft; `apply` sees the current copy and may throw to refuse. */
export function editEngineSermon<T>(document: Pick<SermonDocument, 'update'>, owner: string | null,
  apply: (current: Sermon) => { next: Sermon; result: T }): Promise<T> {
  let result: T | undefined;
  return document.update(current => {
    if (!current || !owner || current.userId !== owner) throw unavailable();
    const outcome = apply(asSermon(current));
    result = outcome.result;
    return asDocument(outcome.next);
  }).then(() => result as T);
}

export function createEngineStructureWriter(document: Pick<SermonDocument, 'update'>, owner: string | null): StructureWriter {
  const edit = <T,>(apply: (current: Sermon) => { next: Sermon; result: T }) => editEngineSermon(document, owner, apply);
  return {
    immediate: true,
    updateStructure: (_sermonId, structure, baseStructure) => edit(current => {
      const merged = mergeSections(structure, current.structure ?? current.thoughtsBySection, baseStructure ?? null);
      return { next: { ...current, structure: merged, thoughtsBySection: merged }, result: merged };
    }),
    updateThought: (_sermonId, thought, baseThought) => edit(current => {
      const changed = changedFields(baseThought, thought) as Record<string, unknown>;
      const patch = Object.fromEntries(THOUGHT_FIELDS.filter(key => key in changed).map(key => [key, changed[key] ?? null])) as ThoughtFieldPatch;
      const next = Object.keys(patch).length ? patchSermonThought(current, thought.id, patch) : current;
      return { next, result: next.thoughts.find(item => item.id === thought.id) ?? thought };
    }),
    deleteThought: (_sermonId, thought) => edit(current => ({ next: deleteSermonThought(current, thought.id), result: undefined })),
    createManualThought: (_sermonId, thought) => edit(current => ({ next: addSermonThought(current, thought), result: thought })),
    updateSermonOutline: (_sermonId, outline, baseOutline, onCollision) => edit(current => {
      const merged = mergeOutline(baseOutline ?? null, outline, current.outline ?? null, onCollision === 'preferMine');
      if (merged.collisions.length && onCollision !== 'preferMine') throw new Error('The same plan point was changed elsewhere');
      const next = replaceSermonOutline(current, merged.outline as SermonOutline);
      return { next, result: next.outline ?? null };
    }),
  };
}

/** The engine writer for one open sermon; must render inside that sermon's DataDocumentProvider. */
export function useEngineStructureWriter(sermonId: string, owner: string | null): { writer: StructureWriter; document: SermonDocument } {
  const document = useDataDocument({ collection: 'sermons', id: sermonId });
  // The update function changes identity with the editor; the writer reads the latest one.
  const latest = useRef(document);
  latest.current = document;
  const writer = useMemo(() => createEngineStructureWriter({ update: fn => latest.current.update(fn) }, owner), [owner]);
  return { writer, document };
}

