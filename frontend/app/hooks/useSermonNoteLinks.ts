'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { isOfflineQueuedError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERMON_CORE_AGGREGATE } from '@/services/sermons.client';
import { sermonListKey, studyNoteListKey } from '@/utils/queryKeys';
import { serverCopyIsNewer, type VersionedCopy } from '@/utils/readFreshness';
import { getSermons, updateSermon } from '@services/sermon.service';
import { getStudyNotes } from '@services/studies.service';

import type { Sermon, StudyNote } from '@/models/models';

/**
 * BOTH DIRECTIONS OF "THIS SERMON WAS BUILT ON THAT NOTE", FROM ONE STORED FACT.
 *
 * `Sermon.sourceNoteIds` is the only copy. Everything else here is derived from the two
 * owner-scoped lists the app already caches, so the two screens can never disagree about
 * a link and neither of them needs a query the app was not making anyway:
 *
 *   sermon screen → the notes it names          (`useSourceNotes`)
 *   note screen   → the sermons that name it    (`useSermonsBuiltOnNote`)
 *
 * The same shape as series membership, and for the same reason: a mirrored second copy is
 * what produced "badge says series, series says empty" before `series.items` became the
 * single truth.
 */

/** The person's notes, read from the shared cache entry — never a private copy. */
export interface StudyNoteDirectory {
  notes: StudyNote[];
  loading: boolean;
  /**
   * TRUE only when this list is the person's ACTUAL notes.
   *
   * Without it "the read failed" is indistinguishable from "you have no notes", and callers
   * draw conclusions from an empty array: the picker would label every linked note as deleted
   * and offer to unlink notes that exist perfectly well. A read that errored, is still in
   * flight, or was never enabled answers `false`.
   */
  ready: boolean;
}

export function useStudyNoteDirectory(options: { enabled?: boolean } = {}): StudyNoteDirectory {
  const { enabled = true } = options;
  const { uid, isAuthLoading } = useResolvedUid();
  /**
   * WHEN THIS CONSUMER STARTED LOOKING.
   *
   * A cached list counts as "success" even when nothing was fetched: cache-first keeps data
   * fresh for 30 seconds and a persisted cache can be older still, so a note created on another
   * device a moment ago may simply be absent. Requiring an answer that arrived AFTER this mount
   * is what separates "the server says this note is gone" from "my copy has not heard of it".
   */
  const mountedAt = useRef(Date.now());
  const query = useServerFirstQuery({
    queryKey: studyNoteListKey(uid),
    queryFn: () => (uid ? getStudyNotes(uid) : Promise.resolve([])),
    // A note document carries its whole text, so reading the collection is not free. The
    // sermon header asks for it ONLY when the sermon actually names a note; the picker,
    // whose entire job is to show the list, always does.
    enabled: !!uid && enabled,
  });
  const loading = (isAuthLoading || query.isLoading) && enabled;
  return {
    notes: query.data ?? [],
    loading,
    /**
     * KNOWN-GOOD means a fetch actually SUCCEEDED and nothing is in flight.
     *
     * A cached array alone is not enough, and this is the difference between a safe screen and
     * one that offers to unlink a note that exists: while a background refetch runs, or offline,
     * or after an error, the list can simply be missing a note that another device added, and
     * every consumer here reads "not in the list" as "deleted".
     */
    ready:
      enabled &&
      !loading &&
      !query.error &&
      query.isSuccess &&
      !query.isFetching &&
      query.isOnline &&
      query.data !== undefined &&
      // `>=` because a fetch that resolves in the same millisecond as the mount is still an
      // answer from this session; a cache restored BEFORE mount carries a strictly older stamp.
      query.dataUpdatedAt >= mountedAt.current,
  };
}

export interface SourceNotesResult {
  /** Resolved notes, in the order the sermon stores them. */
  notes: StudyNote[];
  /**
   * Ids that no longer resolve — a note deleted after it was linked.
   *
   * The header does not draw them: a chip for a note that is gone is a dead end. The picker
   * DOES, as a removable row, because otherwise the count says two while one row shows and
   * the dead id can only be cleared by unlinking everything.
   */
  missingIds: string[];
  loading: boolean;
}

export function useSourceNotes(
  sermon: Pick<Sermon, 'sourceNoteIds'> | null | undefined
): SourceNotesResult {
  const ids = useMemo(() => sermon?.sourceNoteIds ?? [], [sermon?.sourceNoteIds]);
  const { notes, loading, ready } = useStudyNoteDirectory({ enabled: ids.length > 0 });

  return useMemo(() => {
    if (ids.length === 0) return { notes: [], missingIds: [], loading: false };
    // An id only counts as MISSING once the directory is known-good; a failed read must not
    // promote every link to "deleted".
    if (!ready) {
      const known = new Map(notes.map((n) => [n.id, n]));
      return { notes: ids.map((id) => known.get(id)).filter(Boolean) as StudyNote[], missingIds: [], loading };
    }
    const byId = new Map(notes.map((note) => [note.id, note]));
    const resolved: StudyNote[] = [];
    const missingIds: string[] = [];
    for (const id of ids) {
      const note = byId.get(id);
      if (note) resolved.push(note);
      else missingIds.push(id);
    }
    return { notes: resolved, missingIds, loading };
  }, [ids, notes, loading, ready]);
}

/** The other direction: sermons whose stored `sourceNoteIds` name this note. */
export function useSermonsBuiltOnNote(noteId: string | undefined): {
  sermons: Sermon[];
  loading: boolean;
} {
  const { uid, isAuthLoading } = useResolvedUid();
  const query = useServerFirstQuery({
    queryKey: sermonListKey(uid),
    queryFn: () => (uid ? getSermons(uid) : Promise.resolve([])),
    enabled: !!uid && !!noteId,
  });
  const sermons = useMemo(() => {
    if (!noteId) return [];
    return (query.data ?? []).filter((sermon) => (sermon.sourceNoteIds ?? []).includes(noteId));
  }, [query.data, noteId]);

  return { sermons, loading: isAuthLoading || query.isLoading };
}

/**
 * WHAT THE EDITOR OPENED WITH — captured once, and the only thing a save may vouch for.
 *
 * ⚠️ THIS IS THE WHOLE PROTECTION, and getting it from live props instead breaks it silently.
 * The picker holds its checkboxes from the moment it opened, while the sermon prop underneath
 * keeps refreshing; taking the revision and the baseline from the CURRENT prop would pair an
 * old selection with a new proof of freshness, and the guard would happily let that old
 * selection replace what another device had just stored. Same defect the repository already
 * wrote down for editors: the baseline is the open-time value, never a fresh read.
 *
 * `noteIds: null` means the field was absent when the editor opened — kept apart from `[]`
 * because the guard hashes a missing field as null and an empty list as an empty list.
 */
export interface SourceNoteOpeningContext {
  /**
   * WHICH sermon this proof belongs to.
   *
   * The writer reads its target from the freshest props, and those can change to a DIFFERENT
   * sermon while a dialog is open (one menu component re-used for another row). Without the id
   * the revision and baseline of sermon A could be presented as proof for a write to sermon B —
   * and if their link lists happen to match, the content check would wave it through.
   */
  sermonId: string | null;
  noteIds: string[] | null;
  revision: number;
}

export function openingContextOf(
  sermon: Pick<Sermon, 'id' | 'sourceNoteIds' | 'rev'> | null | undefined
): SourceNoteOpeningContext {
  return {
    sermonId: sermon?.id ?? null,
    // Cloned on purpose: keeping the live array reference would let a later in-place mutation
    // of the cached entity rewrite the very baseline this exists to freeze.
    noteIds: sermon?.sourceNoteIds ? [...sermon.sourceNoteIds] : null,
    revision: sermon?.rev?.[SERMON_CORE_AGGREGATE] ?? 0,
  };
}

/**
 * WHAT HAPPENED TO THE SAVE — four different things, and the dialog owes a different move to
 * each. Collapsing them into a boolean is what made "queued offline" look like "refused",
 * leaving a Cancel button that cancels nothing while the write sits in the outbox.
 */
export type SourceNoteSaveOutcome = 'saved' | 'unchanged' | 'queued' | 'stale' | 'failed';

export interface SourceNoteSaveResult {
  outcome: SourceNoteSaveOutcome;
  /** On `stale`: what the server actually holds, so the dialog can adopt it and move on. */
  serverNoteIds?: string[];
  /** On `stale`: the revision the refusal saw, so a deliberate second press can win. */
  serverRevision?: number;
}

/**
 * WHAT A SAVE PRODUCED — a patch, never an entity.
 *
 * Three rounds of review kept finding the same class of defect in one place: something handed a
 * WHOLE sermon across a boundary, and whichever copy it was built from turned out to be the
 * poorer one for somebody. The list copy deliberately omits parts of the document (see
 * `useSermon.ts`), the detail copy holds edits the list has never seen, and no single counter can
 * rank two multi-aggregate copies. So nothing crosses the boundary except the fields this
 * feature actually changed; each side merges them into the copy it owns.
 */
export interface SourceNoteLinkPatch {
  sermonId: string;
  sourceNoteIds: string[];
  updatedAt?: string;
  /** Committed `rev.core`, when the write reported one. */
  revision?: number;
}

/**
 * APPLY A LINK RECEIPT TO WHICHEVER COPY YOU OWN.
 *
 * The decision "may this receipt replace what the copy holds?" is NOT made here: it is the same
 * question every read in this app already asks, and the answer lives in `readFreshness`
 * (`serverCopyIsNewer`). Reusing it matters for a reason that cost several review rounds to
 * learn — the counter is per AGGREGATE, so a `rev.core` that moved because someone renamed the
 * sermon says nothing about these links, and a hand-rolled comparison of one number gets it
 * wrong in both directions.
 *
 * A receipt with no revision is an OFFLINE intent: the links are shown, and the copy keeps its
 * own markers, so a later server answer can still win.
 */
export function applySourceNoteLinkPatch<T extends Sermon>(copy: T, patch: SourceNoteLinkPatch): T {
  if (copy.id !== patch.sermonId) return copy;

  if (patch.revision === undefined) {
    // Pending intent, honestly marked as such: no new revision, no new timestamp.
    return { ...copy, sourceNoteIds: patch.sourceNoteIds };
  }

  /**
   * The receipt is compared AS A COPY, with only the core counter replaced. Handing
   * `serverCopyIsNewer` a bare `{core: n}` would make every other aggregate look like a
   * regression to zero and the answer would always be "not newer".
   */
  const receipt: VersionedCopy = {
    rev: { ...(copy.rev ?? {}), [SERMON_CORE_AGGREGATE]: patch.revision },
    updatedAt: patch.updatedAt ?? copy.updatedAt,
  };
  if (!serverCopyIsNewer(receipt, copy)) return copy;

  return {
    ...copy,
    sourceNoteIds: patch.sourceNoteIds,
    updatedAt: patch.updatedAt ?? copy.updatedAt,
    rev: receipt.rev as Record<string, number>,
  };
}

export interface SourceNoteLinkResult {
  saving: boolean;
  setSourceNotes: (
    nextIds: string[],
    opening: SourceNoteOpeningContext,
    options?: {
      /**
       * The person deliberately chose this set, so write it even when it matches the value the
       * dialog opened with. Needed because "same as when I opened it" is NOT the same as
       * "nothing to do": the server may have moved to something else meanwhile, and skipping
       * the write would silently leave the other device's list in place.
       */
      force?: boolean;
    }
  ) => Promise<SourceNoteSaveResult>;
}

/** Same ids, order ignored — compared as SETS, so no separator character is involved at all. */
const sameIdSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((id) => right.has(id));
};

/**
 * WRITE THE LINK THROUGH THE ONE DOOR, stating what the editor opened with.
 *
 * `updateSermon` reaches `conflictSafeUpdate` with the opening revision and a baseline of the
 * single field being replaced, so a list chosen on the phone a minute ago is not silently
 * thrown away — the save is refused, the server's list is handed back, and the dialog can
 * adopt it. Offline the intent is queued and replayed through the same guard on reconnect.
 */
export function useSourceNoteLink(
  sermon: Sermon | null | undefined,
  /** Called with the fields this save changed. Merge them into the copy YOU own. */
  onPatched?: (patch: SourceNoteLinkPatch) => void
): SourceNoteLinkResult {
  const { t } = useTranslation();
  const { uid } = useResolvedUid();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  /**
   * THE FRESHEST LOCAL COPY, not the one this save started from.
   *
   * A link write takes a network round trip, and during it the page can move: a thought added,
   * a title typed, a plan saved. The detail screen REPLACES its state with whatever `onUpdate`
   * hands back (`sermons/[id]/page.tsx` → `setSermon`), so publishing a snapshot captured when
   * the save began would delete those edits from the screen. The ref always holds the newest
   * props, so the merge lands on top of them.
   */
  const sermonRef = useRef(sermon);
  /**
   * UPDATED AFTER THE COMMIT, on purpose, and this is the safer of two imperfect options.
   *
   * Writing it during render looks tempting — no window at all between new props and the ref —
   * but React explicitly forbids it: a concurrent render that is later DISCARDED would still
   * have moved the ref, so the value could describe a sermon the person never saw. What is
   * committed is what is on the screen, and that is what a save may act on. The remaining
   * window (commit → effect) holds the PREVIOUS committed value, never a phantom one, and the
   * identity guard below refuses anything that belongs to another sermon.
   *
   * Same shape as the sermon page's own latest-value ref (`sermons/[id]/page.tsx`).
   */
  useEffect(() => {
    sermonRef.current = sermon;
  }, [sermon]);

  /**
   * MERGE THE ONE FIELD INTO THE LATEST COPY — never publish the snapshot the save started
   * from. That snapshot is as old as the request: a title typed, a thought added or a plan
   * saved while the write was in flight would all be resurrected by writing the whole entity
   * back, and `refetchType: 'none'` would then persist that wrong copy to disk.
   */
  const publish = useCallback(
    async (patch: SourceNoteLinkPatch) => {
      if (uid) {
        const key = sermonListKey(uid);
        // A list fetch that started before this write would land AFTER the merge and quietly
        // restore the old links — and with `refetchType: 'none'` nothing would come to correct
        // it. Cancelling first is the repository's own pattern for optimistic list updates.
        await queryClient.cancelQueries({ queryKey: key });
        queryClient.setQueryData<Sermon[]>(key, (old) =>
          old ? old.map((item) => applySourceNoteLinkPatch(item, patch)) : old
        );
        // Paired with the write, so the copy persisted to IndexedDB is the merged one — a
        // `setQueryData` alone is the anti-pattern this repository names by name.
        queryClient.invalidateQueries({ queryKey: key, refetchType: 'none' });
      }
      // And that is all this hook publishes. The screen that owns a fuller copy applies the same
      // patch to it — see `SourceNoteLinkPatch`.
      onPatched?.(patch);
    },
    [queryClient, uid, onPatched]
  );

  const setSourceNotes = useCallback(
    async (
      nextIds: string[],
      opening: SourceNoteOpeningContext,
      options?: { force?: boolean }
    ): Promise<SourceNoteSaveResult> => {
      const target = sermonRef.current ?? sermon;
      if (!target) return { outcome: 'failed' };
      // The proof belongs to ONE sermon. If this component now points at another, the write has
      // no valid baseline for it, and refusing is the only honest answer.
      if (opening.sermonId && opening.sermonId !== target.id) {
        console.error('Source-note save refused: the opening context belongs to another sermon', {
          opening: opening.sermonId,
          target: target.id,
        });
        return { outcome: 'failed' };
      }
      // Pressing Save without touching anything must not write: it would move the core
      // revision and `updatedAt` for nothing, and every other device would see the sermon as
      // freshly changed. A DELIBERATE choice is always written, even when it happens to equal
      // the opening value — see `force`.
      if (!options?.force && sameIdSet(nextIds, opening.noteIds ?? [])) {
        return { outcome: 'unchanged' };
      }

      setSaving(true);
      try {
        const updated = await updateSermon(
          { ...target, sourceNoteIds: nextIds },
          { sourceNoteIds: nextIds },
          opening.revision,
          { sourceNoteIds: opening.noteIds }
        );
        await publish({
          sermonId: target.id,
          sourceNoteIds: nextIds,
          updatedAt: updated?.updatedAt,
          revision: updated?.rev?.[SERMON_CORE_AGGREGATE],
        });
        return { outcome: 'saved' };
      } catch (error) {
        if (isStaleWriteError(error)) {
          // REFUSED, and the transaction is the only thing that saw the server — so hand its
          // values back instead of leaving the dialog to press the same doomed button again.
          const serverNoteIds = Array.isArray(error.serverValues?.sourceNoteIds)
            ? (error.serverValues.sourceNoteIds as string[])
            : [];
          await publish({
            sermonId: target.id,
            sourceNoteIds: serverNoteIds,
            revision: error.actualRevision,
          });
          toast.error(t('freshness.staleSaveToast'));
          return { outcome: 'stale', serverNoteIds, serverRevision: error.actualRevision };
        }
        if (isOfflineQueuedError(error)) {
          // QUEUED, not refused: the intent is durable and will replay through the same guard.
          // Showing it locally is the honest thing — the person's choice is stored, and a
          // dialog that stayed open with a Cancel button would promise a cancellation that
          // does not exist.
          await publish({ sermonId: target.id, sourceNoteIds: nextIds });
          toast.message(t('freshness.queuedPending', { count: 1 }));
          return { outcome: 'queued' };
        }
        console.error('Failed to save the sermon source notes:', error);
        toast.error(t('sermon.sourceNotes.saveError'));
        return { outcome: 'failed' };
      } finally {
        setSaving(false);
      }
    },
    [sermon, publish, t]
  );

  return { saving, setSourceNotes };
}
