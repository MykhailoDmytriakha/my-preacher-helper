import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { assertLegacyClientWriteAllowed } from '@/data-engine/clientPolicy';
import { Series } from '@/models/models';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';
import { readOwnerDocument, readOwnerList } from '@/services/ownerListRead.client';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { hydrateSeries, sortSeries } from '@/utils/seriesDocument';
import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';
import { auth } from '@services/firebaseAuth.service';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

const codeByStatus: Record<number, string> = {
  400: 'invalid-argument',
  401: 'unauthenticated',
  403: 'permission-denied',
  404: 'not-found',
  413: 'invalid-argument',
};

async function writeResponseError(response: Response, fallbackMessage: string): Promise<Error> {
  // A proxy can return HTML for a 413. Parse best-effort so that malformed error
  // bodies cannot erase the response class which tells recovery not to retry.
  const body = await response.json().catch(() => null);
  const data = body && typeof body === 'object' ? (body as { error?: unknown; code?: unknown }) : {};
  const message = typeof data.error === 'string' ? data.error : fallbackMessage;
  const code = typeof data.code === 'string' ? data.code : codeByStatus[response.status];
  return Object.assign(new Error(message), { status: response.status, ...(code ? { code } : {}) });
}

// Series use the client Firestore SDK for reads, create, and metadata-only
// updates. Operations that cross into `sermons`/`groups` stay on the server:
// DELETE and every membership op.
const SERIES_COLLECTION = 'series';

// Fields the server PUT /api/series/[id] route allows — metadata only, never items
// or sermonIds (membership flows through the dedicated cascade endpoints). The client
// update path mirrors this whitelist exactly so it can never desync the back-refs.
const SERIES_UPDATE_FIELDS: (keyof Series)[] = [
  'title', 'theme', 'description', 'bookOrTopic', 'startDate', 'duration', 'color', 'status', 'seriesKind',
];

// --- client-SDK read/write paths ---

/** The same shaping for both roads: the browser's own read and the server's answer. */
const shapeSeries = (documents: Record<string, unknown>[]): Series[] =>
  sortSeries(documents.map((data) => hydrateSeries(data as unknown as Series)));

async function readSeriesViaSdk(userId: string): Promise<Series[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, SERIES_COLLECTION), where('userId', '==', userId)));
  return shapeSeries(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

/*
 * ONE ROAD IS NOT ENOUGH HERE EITHER. On the owner's iPad the browser's Firestore answers
 * nothing at all — neither data nor error — and a series screen with no deadline then stays a
 * skeleton for ever (measured 2026-09-16: 46 s on `/series/:id`, one HTTP read of councils in
 * 251 ms beside it). Lists went through this door on 2026-09-11; series, groups and study notes
 * were left behind, which is why this section was the one that would not open.
 */
async function getAllSeriesViaClient(userId: string): Promise<Series[]> {
  return readOwnerList(SERIES_COLLECTION, userId, readSeriesViaSdk(userId), shapeSeries);
}

async function readOneSeriesViaSdk(seriesId: string): Promise<Series | undefined> {
  const db = getClientDb();
  const snap = await getDoc(doc(db, SERIES_COLLECTION, seriesId));
  if (!snap.exists()) return undefined;
  return hydrateSeries({ ...(snap.data() as Omit<Series, 'id'>), id: snap.id } as Series);
}

async function getSeriesByIdViaClient(seriesId: string): Promise<Series | undefined> {
  const owner = auth.currentUser?.uid;
  // Signed out there is nobody to read for; leave the old path to answer (or refuse) as it did.
  if (!owner) return readOneSeriesViaSdk(seriesId);
  return readOwnerDocument(
    SERIES_COLLECTION,
    owner,
    seriesId,
    readOneSeriesViaSdk(seriesId),
    shapeSeries
  );
}

async function createSeriesViaClient(series: Omit<Series, 'id'> & { id?: string }): Promise<Series> {
  const db = getClientDb();
  const now = new Date().toISOString();
  const { id: providedId, ...rest } = series;
  const items = normalizeSeriesItems(rest.items, rest.sermonIds || []);
  const clean = deepCleanUndefined({
    ...rest,
    items,
    sermonIds: deriveSermonIdsFromItems(items),
    seriesKind: rest.seriesKind || inferSeriesKind(items),
    createdAt: now,
    updatedAt: now,
  });
  // Idempotent create when the caller supplies a client id — see groups.service
  // (setDoc on a known id makes a replayed offline create a no-op overwrite, not a dup).
  if (providedId) {
    await setDoc(doc(db, SERIES_COLLECTION, providedId), clean);
    return hydrateSeries({ ...clean, id: providedId } as Series);
  }
  const ref = await addDoc(collection(db, SERIES_COLLECTION), clean);
  return hydrateSeries({ ...clean, id: ref.id } as Series);
}

/** Series metadata edited by a human is one aggregate; membership items are not. */
export const SERIES_META_AGGREGATE = 'meta';

async function updateSeriesViaClient(
  seriesId: string,
  updates: Partial<Series>,
  expectedRevision: number | null = null,
  /**
   * The metadata fields as the EDIT FORM OPENED them.
   *
   * Series was the last aggregate judged by the counter alone, and that is exactly
   * the hole the rules cannot close while they are disabled: an old installed PWA
   * changes the title WITHOUT advancing `rev.meta`, so hours later a save from the
   * same number looks legitimate and silently replaces the phone's title. Comparing
   * the values the form started from catches it without anyone's cooperation.
   */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<Series> {
  const db = getClientDb();
  const ref = doc(db, SERIES_COLLECTION, seriesId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Series ${seriesId} not found`);
  const current = hydrateSeries({ ...(snap.data() as Omit<Series, 'id'>), id: snap.id } as Series);
  // Whitelist metadata fields only — mirror the server route; never write items/sermonIds.
  const whitelisted: Record<string, unknown> = {};
  for (const field of SERIES_UPDATE_FIELDS) {
    if (updates[field] !== undefined) whitelisted[field] = updates[field];
  }
  const cleanUpdates = deepCleanUndefined({ ...whitelisted, updatedAt: new Date().toISOString() });

  // GUARDED PATH — see conflictSafeUpdate.client.ts. Without a stated revision the
  // behaviour is exactly what it was.
  if (expectedRevision !== null) {
    const committed = await conflictSafeUpdate(ref, cleanUpdates, `Series ${seriesId} not found`, {
      aggregate: SERIES_META_AGGREGATE,
      expectedRevision,
      expectedBaseline,
      outboxRoute: current.userId
        ? { uid: current.userId, collection: SERIES_COLLECTION, docId: seriesId, savedAt: Date.now() }
        : undefined,
    });
    // Carry the COMMITTED revision back, or the caller's next save states the
    // pre-write number and is refused as stale — a false conflict on its own edit.
    return hydrateSeries({
      ...current,
      ...cleanUpdates,
      rev: { ...(current.rev ?? {}), [SERIES_META_AGGREGATE]: committed },
    } as Series);
  }

  // Unguarded path still advances the counter — see revisionBump.
  await updateDoc(ref, { ...cleanUpdates, ...revisionBump(SERIES_META_AGGREGATE) });
  return hydrateSeries({ ...current, ...cleanUpdates } as Series);
}

// NOTE: writes intentionally do NOT pre-check connectivity. Offline, the fetch
// rejects with a network error and React Query (networkMode 'offlineFirst')
// pauses + persists the mutation, replaying it on reconnect. A pre-throw would
// short-circuit that buffer and lose the write. (Client-SDK writes queue natively
// in Firestore's offline buffer instead.)

export const getAllSeries = async (userId: string): Promise<Series[]> => {
  return getAllSeriesViaClient(userId);
};

export const getSeriesById = async (seriesId: string): Promise<Series | undefined> => {
  return getSeriesByIdViaClient(seriesId);
};

export const createSeries = async (series: Omit<Series, 'id'> & { id?: string }): Promise<Series> => {
  assertLegacyClientWriteAllowed(SERIES_COLLECTION);
  return createSeriesViaClient(series);
};

export const updateSeries = async (
  seriesId: string,
  updates: Partial<Series>,
  expectedRevision: number | null = null,
  /** The metadata fields as the form OPENED them — see the guard's baseline. */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<Series> => {
  // Items/sermonIds membership flows through the dedicated cascade endpoints, never
  // updateSeries; the client path whitelists metadata only (same as the server route),
  // so it stays a pure own-doc write with no cross-collection effect.
  assertLegacyClientWriteAllowed(SERIES_COLLECTION);
  return updateSeriesViaClient(seriesId, updates, expectedRevision, expectedBaseline);
};

export const deleteSeries = async (seriesId: string): Promise<void> => {
  assertLegacyClientWriteAllowed(SERIES_COLLECTION);
  try {
    const authHeaders = await getAuthenticatedRequestHeaders();
    const response = await fetch(`${API_BASE}/api/series/${seriesId}`, {
      method: 'DELETE',
      headers: authHeaders,
    });

    if (!response.ok) {
      console.error(`deleteSeries: Response not ok for id ${seriesId}, status:`, response.status);
      throw await writeResponseError(response, 'Failed to delete series');
    }
  } catch (error) {
    console.error(`deleteSeries: Error deleting series ${seriesId}:`, error);
    throw error;
  }
};

// Membership ops (add/remove/reorder sermons & groups) are NO LONGER here: they
// moved to the client playlist sweep (see hooks/useSeriesMembership.ts +
// services/seriesMembership.client.ts), which writes series.items via the
// client Firestore SDK — one atomic offline-capable writer instead of the old
// server cascade. deleteSeries stays on the server (it clears delete-cleanup
// refs across collections via the Admin SDK).
