import {
  collection,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import {
  Sermon,
  SermonOutline,
} from '@/models/models';
import {
  isStaleWriteError,
} from '@/services/conflictSafeUpdate.client';
import { readOwnerList } from '@/services/ownerListRead.client';
import { listOutbox } from '@/services/writeOutbox.client';
import { hydrateSermon, sortSermons } from '@/utils/sermonDocument';
export { hydrateSermon } from '@/utils/sermonDocument';

// Sermon READS + own-doc WRITES (update fields, structure, outline, thoughts[],
// preachDates[]) normally go through the client Firestore SDK (offline
// replica + deployed Security Rules). Operations that need secrets (AI:
// transcription/insights/plan/brainstorm/TTS) or cascade into OTHER collections
// (delete -> series delete-cleanup) stay on the server. Series MEMBERSHIP is not
// a cascade anymore: it lives in series.items and is written by the client
// playlist sweep (useSeriesMembership). The Phase 5 cleanup removed the last
// consumer of the old NEXT_PUBLIC_USE_CLIENT_SERMONS strangler-fig flag, so the
// client path is no longer gated.

const SERMONS_COLLECTION = 'sermons';

function db() {
  return getClientDb();
}

// --- READS ---

/** The same shaping for both roads: the browser's own read and the server's answer. */
const shapeSermons = (documents: Record<string, unknown>[]): Sermon[] =>
  sortSermons(documents.map((data) => hydrateSermon(data as unknown as Sermon)));

async function readSermonsViaSdk(userId: string): Promise<Sermon[]> {
  const snap = await getDocs(
    query(collection(db(), SERMONS_COLLECTION), where('userId', '==', userId))
  );
  return shapeSermons(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

export async function getSermonsViaClient(userId: string): Promise<Sermon[]> {
  return readOwnerList(SERMONS_COLLECTION, userId, readSermonsViaSdk(userId), shapeSermons);
}

/** Aggregate name for the sermon's own fields (title/verse/isPreached/preparation). */
export const SERMON_CORE_AGGREGATE = 'core';
export const SERMON_PLAN_AGGREGATE = 'plan';
const SERMON_OUTLINE_AGGREGATE = 'outline';

/**
 * The plan was written in two places and the same point differs in both.
 *
 * Reported instead of guessed. It carries what the server holds so the screen can
 * show both versions, and it marks itself as a refusal (`isStaleWrite`) because
 * that is what it is: nothing was written, and a person has to decide.
 */
export class OutlineCollisionError extends Error {
  readonly isStaleWrite = true;
  readonly aggregate = SERMON_OUTLINE_AGGREGATE;
  constructor(
    readonly collisions: string[],
    readonly serverOutline: SermonOutline | null,
    readonly actualRevision: number
  ) {
    super(`The plan changed on another device in the same point(s): ${collisions.join(', ')}`);
    this.name = 'OutlineCollisionError';
  }
}

export function isOutlineCollisionError(error: unknown): error is OutlineCollisionError {
  return (error as OutlineCollisionError | null)?.name === 'OutlineCollisionError';
}

/**
 * What the server really held, read back off a refusal and keyed by NODE again.
 *
 * The guard reports field paths (`planText.<id>`) because that is what it compared; the screens
 * think in nodes. Translating lives here, beside the writer that chose the field names, so the
 * convention is stated once. Anything that is not this plan's text is ignored rather than
 * guessed at.
 */
export function planTextConflictValues(error: unknown): Record<string, string | null> | null {
  if (!isStaleWriteError(error)) return null;
  const byNode: Record<string, string | null> = {};
  Object.entries(error.serverValues).forEach(([field, value]) => {
    if (!field.startsWith('planText.')) return;
    byNode[field.slice('planText.'.length)] = typeof value === 'string' ? value : null;
  });
  return Object.keys(byNode).length > 0 ? byNode : null;
}

/**
 * Which plan cells are STILL WAITING to reach the server, from the offline queue.
 *
 * Two different things need this same answer, which is why it is one function:
 *
 *   - the baseline must NOT adopt a queued value as "what the server holds", or the screen
 *     starts vouching for text no server has seen — and if the replay is later refused, every
 *     further save is judged against a value that never existed;
 *   - the durable draft must KEEP such a cell, because "queued" is precisely "not confirmed",
 *     and dropping it is how the words written on a train stop existing anywhere the person
 *     can see.
 *
 * Reading the queue rather than tracking a flag is deliberate: the queue is the fact. A flag
 * would have to be released correctly on drain, on refusal and on reload, and any one of those
 * being wrong leaves a cell held for ever.
 */
export function pendingPlanTextNodeIds(
  uid: string | null | undefined,
  sermonId: string | null | undefined
): Set<string> {
  const waiting = new Set<string>();
  if (!uid || !sermonId) return waiting;
  listOutbox(uid)
    .filter((entry) => entry.docId === sermonId && entry.aggregate === SERMON_PLAN_AGGREGATE)
    .forEach((entry) => {
      Object.keys(entry.patch ?? {}).forEach((field) => {
        if (field.startsWith('planText.')) waiting.add(field.slice('planText.'.length));
      });
    });
  return waiting;
}

/**
 * THE WORDS STILL WAITING IN THE QUEUE, per plan cell — the newest intent wins, as replay would
 * make it. The queue is the fact about them: a screen may hold other words for the same cell (a
 * copy for reading, or an engine document that never saw a write queued before its collection
 * moved), and the device draft keeps these (BUG-20261003-preaching-on-copy-stores-copy-words-as-draft).
 */
export function pendingPlanText(
  uid: string | null | undefined,
  sermonId: string | null | undefined
): Record<string, string> {
  const waiting: Record<string, string> = {};
  if (!uid || !sermonId) return waiting;
  listOutbox(uid)
    .filter((entry) => entry.docId === sermonId && entry.aggregate === SERMON_PLAN_AGGREGATE)
    .forEach((entry) => {
      Object.entries(entry.patch ?? {}).forEach(([field, value]) => {
        if (field.startsWith('planText.') && typeof value === 'string') waiting[field.slice('planText.'.length)] = value;
      });
    });
  return waiting;
}
