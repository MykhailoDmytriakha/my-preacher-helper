'use client';

import { doc } from 'firebase/firestore';


import { getClientDb } from '@/config/firebaseClientDb';
import { conflictSafeUpdate, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  listOutbox,
  markOutboxConflicted,
  removeFromOutbox,
  type OutboxEntry,
} from '@/services/writeOutbox.client';

import type { ScratchNote, SermonOutline, ThoughtsBySection } from '@/models/models';

/**
 * Put every queued offline intent back through the SAME guard.
 *
 * This is the whole point of the outbox: an edit made on a train is not written
 * blindly on reconnect. It is replayed with the revision it was BUILT FROM, so if
 * another device moved the document meanwhile the replay is refused instead of
 * overwriting — and the entry survives as `conflicted`, still carrying its text,
 * for the person to resolve.
 *
 * Entries already marked `conflicted` are left alone: replaying them would just
 * be refused again, and re-sending them with a fresh revision would be the silent
 * overwrite this exists to prevent. Only a deliberate human choice may do that.
 */
export async function replayOutbox(uid: string): Promise<{
  replayed: number;
  conflicted: number;
  failed: number;
  /** Documents this run actually wrote — the caller must refresh their views. */
  touched: Array<{ collection: string; docId: string }>;
}> {
  const db = getClientDb();
  const pending = listOutbox(uid).filter((entry) => entry.status === 'pending');

  let replayed = 0;
  let conflicted = 0;
  let failed = 0;
  const touched: Array<{ collection: string; docId: string }> = [];

  /**
   * What THIS run has already committed, per document+aggregate.
   *
   * A person offline often saves the same thing twice — the title, then the verse,
   * or the same field after a failed-looking attempt. Every intent then carries the
   * SAME base revision. Replaying them literally means the first one commits and
   * every later one is refused "changed on another device" — against the person's
   * own save, seconds earlier. That false conflict is worse than useless: it teaches
   * people to click through the dialog. So a follow-up intent is rebased onto what
   * this run just wrote, and its content check is dropped — the content differs
   * because WE changed it.
   */
  const committedHere = new Map<string, number>();
  /**
   * Which FIELDS this run has already rewritten, per lane.
   *
   * Rebasing the revision is right — the person's own earlier intent moved it. But
   * the previous version also threw the content check away wholesale, and that is a
   * silent overwrite waiting to happen: queue a title AND a verse offline, let the
   * phone rewrite the verse meanwhile, and the replayed verse intent inherited the
   * fresh revision with NO content check and replaced the phone's text without a
   * word. The check is only invalid for fields WE just wrote; for every other field
   * the author's opening value still describes what it started from.
   */
  const rewrittenHere = new Map<string, Set<string>>();
  const laneOf = (entry: OutboxEntry) => `${entry.collection}/${entry.docId}#${entry.aggregate}`;
  const contentFieldsOf = (patch: Record<string, unknown>) =>
    Object.keys(patch).filter((name) => !name.startsWith('rev.') && name !== 'updatedAt');

  for (const entry of pending) {
    const lane = laneOf(entry);
    const rebased = committedHere.get(lane);
    try {
      /**
       * A SEMANTIC intent: redo the merge instead of applying a patch.
       *
       * Ordered structures (the sermon plan) cannot be protected offline by a
       * commutative operation — "merge" there means recompute against what the
       * server holds. So the writer queued the OPERATION and what the editor started
       * from, and here it runs again with fresh data. A collision surfaces exactly as
       * it does online: the intent is kept and marked, never silently applied.
       */
      if (entry.merge) {
        const writers = await import('@/services/sermons.client');
        if (entry.merge.kind === 'outline') {
          await writers.updateSermonOutlineViaClient(
            entry.docId,
            (entry.patch as { outline: SermonOutline }).outline,
            { baseOutline: entry.merge.base as SermonOutline | null }
          );
        } else if (entry.merge.kind === 'scratch') {
          await writers.addScratchNoteViaClient(
            entry.docId,
            (entry.patch as { scratch: ScratchNote[] }).scratch,
            entry.merge.base as ScratchNote[] | null
          );
        } else if (entry.merge.kind === 'structure') {
          await writers.updateStructureViaClient(
            entry.docId,
            (entry.patch as { structure: ThoughtsBySection }).structure,
            // The arrangement the screen started from travels with the intent, so the
            // replay can tell a move made HERE from one made on the other device.
            entry.merge.base as ThoughtsBySection | null
          );
        } else {
          const payload = entry.patch as { outline: SermonOutline; scratch: ScratchNote[] };
          await writers.applyScratchToOutlineViaClient(
            entry.docId,
            payload.outline,
            payload.scratch,
            entry.merge.base as { outline?: SermonOutline | null; scratch?: ScratchNote[] | null }
          );
        }
        removeFromOutbox(entry.id);
        touched.push({ collection: entry.collection, docId: entry.docId });
        replayed += 1;
        continue;
      }
      const committed = await conflictSafeUpdate(
        doc(db, entry.collection, entry.docId),
        // A FRESH timestamp. Replaying Monday's `updatedAt` on Friday buried the
        // document at the bottom of "recently updated" — the person's own save made
        // their work look untouched for days.
        ({ ...entry.patch, ...('updatedAt' in entry.patch ? { updatedAt: new Date().toISOString() } : {}) }) as Parameters<typeof conflictSafeUpdate>[1],
        `${entry.collection}/${entry.docId} not found`,
        {
          aggregate: entry.aggregate,
          expectedRevision: rebased ?? entry.baseRevision,
          // Everything this run has not rewritten itself is still checked against
          // the value the author started from.
          expectedBaseline: narrowedBaseline(entry, rewrittenHere.get(lane)),
        }
      );
      committedHere.set(lane, committed);
      const rewritten = rewrittenHere.get(lane) ?? new Set<string>();
      contentFieldsOf(entry.patch).forEach((name) => rewritten.add(name));
      rewrittenHere.set(lane, rewritten);
      removeFromOutbox(entry.id);
      touched.push({ collection: entry.collection, docId: entry.docId });
      replayed += 1;
    } catch (error) {
      if (isStaleWriteError(error)) {
        // Count it as CONFLICTED only if the transition was really recorded. When
        // storage refuses it, the entry stays pending and would be refused again on
        // every heartbeat — reporting it as failed is the honest answer and keeps the
        // count truthful for the banner.
        if (markOutboxConflicted(entry.id, error.actualRevision)) conflicted += 1;
        else failed += 1;
        continue;
      }
      // The document is GONE — deleted from another device while this edit waited.
      // Retrying forever would hammer a dead target every minute and the text would
      // stay invisible. Surface it as a conflict instead: the person sees their
      // words and decides, and nothing retries behind their back.
      if (/not found/i.test((error as { message?: string })?.message ?? '')) {
        // Flagged as MISSING, not merely refused: there is nothing to overwrite, so
        // the UI must not offer "keep mine" — an update against a deleted document
        // can never succeed, and a button that promises what it cannot do is worse
        // than no button.
        if (markOutboxConflicted(entry.id, entry.baseRevision, true)) conflicted += 1;
        else failed += 1;
        continue;
      }
      // Still unreachable, or a real error: KEEP the entry. Dropping it here
      // would be the silent loss the outbox exists to prevent.
      failed += 1;
    }
  }

  return { replayed, conflicted, failed, touched };
}

/** Conflicted intents waiting for a human decision — the UI reads these. */
export function pendingOutboxConflicts(uid: string): OutboxEntry[] {
  return listOutbox(uid).filter((entry) => entry.status === 'conflicted');
}

/**
 * The author's opening values, minus the fields this replay run has itself
 * rewritten (checking those would compare against text WE replaced).
 *
 * Returns undefined when nothing is left to vouch for — the counter then decides
 * alone, which is the honest fallback.
 */
function narrowedBaseline(
  entry: OutboxEntry,
  rewritten: Set<string> | undefined
): Record<string, unknown> | undefined {
  const baseline = entry.expectedBaseline;
  if (!baseline) return undefined;
  if (!rewritten || rewritten.size === 0) return baseline;
  const remaining: Record<string, unknown> = {};
  Object.keys(baseline).forEach((name) => {
    if (!rewritten.has(name)) remaining[name] = baseline[name];
  });
  return Object.keys(remaining).length > 0 ? remaining : undefined;
}
