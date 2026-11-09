import { useMemo } from 'react';

import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { useOutlineConflict } from '@/components/plan-editor/useOutlineConflict';
import { useDataDocument, type DocumentUpdateOptions } from '@/data-engine/react.client';
import { isOutlineCollisionError, OutlineCollisionError } from '@/services/sermons.client';
import { changedFields } from '@/utils/changedFields';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { mergeOutline } from '@/utils/mergeOutline';
import { mergeSections } from '@/utils/mergeSections';
import { addSermonThought, deleteSermonThought, patchSermonThought, replaceSermonOutline } from '@/utils/sermonThoughtEdits';
import { applyScopedThoughtPlacement, completeStoredThoughtPlacement } from '@/utils/thoughtOrdering';

import type { StructureWriter } from '@/components/sermon/structureWriter';
import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline, Thought, ThoughtsBySection } from '@/models/models';
import type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';

type SermonDocument = ReturnType<typeof useDataDocument>;
export type ShownThoughtIdentity = Pick<Thought, 'id' | 'date'>;

interface EngineStructureWriter extends StructureWriter {
  setThoughtLocks(thoughts: readonly ShownThoughtIdentity[], isLocked: boolean): Promise<void>;
}

const THOUGHT_FIELDS: (keyof ThoughtFieldPatch)[] = ['text', 'tags', 'date', 'outlinePointId', 'subPointId', 'position', 'isLocked', 'keyFragments'];
const asSermon = (value: DocumentData): Sermon => ({ ...value, thoughts: (value.thoughts ?? []) } as unknown as Sermon);
const asDocument = (sermon: Sermon): DocumentData => deepCleanUndefined(sermon) as unknown as DocumentData;
const unavailable = () => new Error('The sermon is not available for editing');

const applyThoughtUpdate = (current: Sermon, thought: Thought, baseThought: Thought | null): Sermon => {
  const changed = changedFields(baseThought, thought) as Record<string, unknown>;
  const patch = Object.fromEntries(THOUGHT_FIELDS.filter(key => key in changed).map(key => [key, changed[key] ?? null])) as ThoughtFieldPatch;
  return Object.keys(patch).length ? patchSermonThought(current, thought.id, patch) : current;
};

/**
 * Placement may name only thoughts the document still has, each once. The board can hold a
 * thought deleted on another device (its rebuild pauses during a drag or an AI sort review),
 * and the merge keeps ids the screen did not mention; the server's integrity rule refuses a
 * missing or doubled id, and every later edit of the sermon would queue behind that refusal.
 */
export function placeExisting(structure: ThoughtsBySection, thoughts: readonly { id: string }[]): ThoughtsBySection {
  const alive = new Set(thoughts.map(thought => thought.id));
  const seen = new Set<string>();
  const keep = (ids: string[] | undefined) => (ids ?? []).filter(id => alive.has(id) && !seen.has(id) && Boolean(seen.add(id)));
  const placed: ThoughtsBySection = { introduction: keep(structure.introduction), main: keep(structure.main), conclusion: keep(structure.conclusion) };
  if (structure.ambiguous) placed.ambiguous = keep(structure.ambiguous);
  return placed;
}

/**
 * The structure screen's writes on an engine document. Each change is laid over the CURRENT
 * copy with the same merge rule the legacy writer applies on the server (mergeSections,
 * changedFields, mergeOutline) and the editor's own transforms, so a remote edit that landed
 * after this screen opened is kept rather than overwritten by the screen's older picture.
 */
/** One edit of the owner's sermon draft; `apply` sees the current copy and may throw to refuse. */
export function editEngineSermon<T>(document: Pick<SermonDocument, 'update'>, owner: string | null,
  apply: (current: Sermon) => { next: Sermon; result: T }, options?: DocumentUpdateOptions): Promise<T> {
  let result: T | undefined;
  return document.update(current => {
    if (!current || !owner || current.userId !== owner) throw unavailable();
    const outcome = apply(asSermon(current));
    result = outcome.result;
    return asDocument(outcome.next);
  }, options).then(() => result as T);
}

export function createEngineStructureWriter(document: Pick<SermonDocument, 'update'>, owner: string | null,
  onOutlineConflict?: (outline: SermonOutline, base: SermonOutline | null, stored: SermonOutline | null) => void): EngineStructureWriter {
  const edit = <T,>(apply: (current: Sermon) => { next: Sermon; result: T }) => editEngineSermon(document, owner, apply);
  return {
    updateStructure: (_sermonId, structure, baseStructure, options) => edit(current => {
      const edited = (options?.thoughtUpdates ?? []).reduce((next, update) => applyThoughtUpdate(next, update.thought, update.baseThought), current);
      // Fill legacy omissions while preserving every existing unselected placement.
      const stored = options?.thoughtIds ? completeStoredThoughtPlacement(edited) : edited.structure ?? edited.thoughtsBySection;
      const intended = options?.thoughtIds
        ? applyScopedThoughtPlacement(stored, structure, options.thoughtIds)
        : mergeSections(structure, stored, baseStructure ?? null);
      const merged = placeExisting(intended, edited.thoughts);
      return { next: { ...edited, structure: merged, thoughtsBySection: merged }, result: merged };
    }),
    updateThought: (_sermonId, thought, baseThought) => edit(current => {
      const next = applyThoughtUpdate(current, thought, baseThought);
      return { next, result: next.thoughts.find(item => item.id === thought.id) ?? thought };
    }),
    setThoughtLocks: (shown, isLocked) => {
      const selected = new Map(shown.map(thought => [thought.id, thought.date]));
      return editEngineSermon(document, owner, current => {
        const matching = current.thoughts.filter(thought => selected.has(thought.id) && selected.get(thought.id) === thought.date);
        if (matching.length !== selected.size) throw unavailable();
        const ids = new Set(matching.map(thought => thought.id));
        const thoughts = current.thoughts.map(thought => ids.has(thought.id) && Boolean(thought.isLocked) !== isLocked
          ? { ...thought, isLocked } : thought);
        return { next: { ...current, thoughts }, result: undefined };
      }, { action: { kind: 'thought-lock', rowIds: [...selected.keys()] } });
    },
    deleteThought: (_sermonId, thought) => edit(current => ({ next: deleteSermonThought(current, thought.id), result: undefined })),
    createManualThought: (_sermonId, thought, section) => edit(current => ({ next: addSermonThought(current, thought, section), result: thought })),
    updateSermonOutline: async (_sermonId, outline, baseOutline, onCollision, inputSequence) => {
      try {
        return await editEngineSermon(document, owner, current => {
          const apply = (base: SermonOutline | null) => {
            const merged = mergeOutline(base, outline, current.outline ?? null, onCollision === 'preferMine');
            if (merged.collisions.length) throw new OutlineCollisionError(merged.collisions, current.outline ?? null, 0, { outline: base });
            const next = replaceSermonOutline(current, merged.outline as SermonOutline);
            return { next, result: next.outline ?? null };
          };
          return inputSequence ? inputSequence.apply(baseOutline ?? null, outline, apply) : apply(baseOutline ?? null);
        }, { handlesRefusal: isOutlineCollisionError });
      } catch (error) {
        // Modal editors already own their durable comparison. Older automatic callers used
        // preferMine to suppress it; retain every refused input before their UI callbacks settle.
        if (onCollision === 'preferMine' && isOutlineCollisionError(error)) {
          onOutlineConflict?.(outline, error.baseline ? error.baseline.outline : baseOutline ?? null, error.serverOutline);
        }
        throw error;
      }
    },
  };
}

/** The engine writer for one open sermon; must render inside that sermon's DataDocumentProvider. */
export function useEngineStructureWriter(sermonId: string, owner: string | null) {
  const document = useDataDocument({ collection: 'sermons', id: sermonId });
  const recovery = useOutlineConflict(owner ?? '', sermonId);
  usePublishShellTitle('sermons', sermonId, document.data);
  // Follow the latest document state only within this opening. On recovery, the old
  // target keeps its old facade, which rejects writes after that opening has retired.
  const opening = useMemo(() => ({
    owner, sermonId, identity: document.recoveryIdentity, document: null as SermonDocument | null,
  }), [owner, sermonId, document.recoveryIdentity]);
  opening.document = document;
  const writeTarget = useMemo<Pick<SermonDocument, 'update'>>(() => ({
    update: (fn, options) => opening.document!.update(fn, options),
  }), [opening]);
  const writer = useMemo(() => createEngineStructureWriter(writeTarget, owner, recovery.retain),
    [writeTarget, owner, recovery.retain]);
  return { writer, document, recovery, writeTarget };
}
