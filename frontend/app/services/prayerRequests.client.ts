import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { PrayerRequest, PrayerStatus, PrayerUpdate } from '@/models/models';
import { atomicUpdate } from '@/services/atomicUpdate.client';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';

const PRAYER_REQUESTS_COLLECTION = 'prayerRequests';
const PRAYER_NOT_FOUND_ERROR = 'Prayer request not found';

/**
 * Independently edited parts of a prayer request. Kept apart so marking one
 * answered, or logging an update, never collides with someone editing the text —
 * false conflicts teach people to click through the dialog, which is worse than
 * having none.
 */
export const PRAYER_CORE_AGGREGATE = 'core';
export const PRAYER_STATUS_AGGREGATE = 'status';
export const PRAYER_UPDATES_AGGREGATE = 'updates';

export interface AddPrayerUpdateViaClientPayload {
  updateId: string;
  text: string;
  createdAt: string;
}

function deepCleanUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((item) => deepCleanUndefined(item)) as T;
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, deepCleanUndefined(v)])
    ) as T;
  }
  return value;
}

function hydratePrayerRequest(data: Omit<PrayerRequest, 'id'>, id: string): PrayerRequest {
  return {
    ...data,
    id,
    updates: data.updates || [],
    tags: data.tags || [],
    status: data.status || 'active',
  };
}

function sortPrayerRequests(list: PrayerRequest[]): PrayerRequest[] {
  return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getAllPrayerRequestsViaClient(userId: string): Promise<PrayerRequest[]> {
  const db = getClientDb();
  const snap = await getDocs(
    query(collection(db, PRAYER_REQUESTS_COLLECTION), where('userId', '==', userId))
  );
  return sortPrayerRequests(
    snap.docs.map((d) =>
      hydratePrayerRequest(d.data() as Omit<PrayerRequest, 'id'>, d.id)
    )
  );
}

export async function getPrayerRequestByIdViaClient(id: string): Promise<PrayerRequest | undefined> {
  const db = getClientDb();
  const snap = await getDoc(doc(db, PRAYER_REQUESTS_COLLECTION, id));
  if (!snap.exists()) return undefined;
  return hydratePrayerRequest(snap.data() as Omit<PrayerRequest, 'id'>, snap.id);
}

export async function updatePrayerRequestViaClient(
  id: string,
  updates: Partial<PrayerRequest>,
  /** Revision this edit was built from; `null` keeps the unguarded legacy path. */
  expectedRevision: number | null = null
): Promise<PrayerRequest> {
  const db = getClientDb();
  const ref = doc(db, PRAYER_REQUESTS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(PRAYER_NOT_FOUND_ERROR);

  const current = hydratePrayerRequest(snap.data() as Omit<PrayerRequest, 'id'>, snap.id);
  const safeUpdates = { ...updates };
  delete safeUpdates.id;
  const cleanUpdates = deepCleanUndefined({
    ...safeUpdates,
    updatedAt: new Date().toISOString(),
  });
  // GUARDED PATH — see conflictSafeUpdate.client.ts. No revision stated = old path.
  if (expectedRevision !== null) {
    await conflictSafeUpdate(ref, cleanUpdates, PRAYER_NOT_FOUND_ERROR, {
      aggregate: PRAYER_CORE_AGGREGATE,
      expectedRevision,
    });
  } else {
    // Unguarded writers must STILL advance the counter, or it lies and a later
    // stale save is handed permission to overwrite — see revisionBump.
    await updateDoc(ref, { ...cleanUpdates, ...revisionBump(PRAYER_CORE_AGGREGATE) });
  }
  return hydratePrayerRequest(
    { ...current, ...cleanUpdates } as Omit<PrayerRequest, 'id'>,
    id
  );
}

export async function deletePrayerRequestViaClient(id: string): Promise<void> {
  const db = getClientDb();
  await deleteDoc(doc(db, PRAYER_REQUESTS_COLLECTION, id));
}

export async function addPrayerUpdateViaClient(
  id: string,
  payload: AddPrayerUpdateViaClientPayload
): Promise<PrayerRequest> {
  const trimmedText = payload.text.trim();
  if (!trimmedText) throw new Error('Missing text');

  const db = getClientDb();
  const ref = doc(db, PRAYER_REQUESTS_COLLECTION, id);

  // Appends to updates[] — a full-array write, so it must be computed from fresh
  // data or an update added on another device is wiped. atomicUpdate re-runs this
  // when the doc changed mid-flight; `result` holds the committed value.
  let result!: PrayerRequest;
  await atomicUpdate<Omit<PrayerRequest, 'id'>>(
    ref,
    (data) => {
      const current = hydratePrayerRequest(data, id);
      if (current.updates.some((update) => update.id === payload.updateId)) {
        result = current; // replay no-op
        return null;
      }

      const update: PrayerUpdate = {
        id: payload.updateId,
        text: trimmedText,
        createdAt: payload.createdAt,
      };
      const updates = [...current.updates, update];
      result = hydratePrayerRequest({ ...current, updates, updatedAt: payload.createdAt }, id);
      return { updates, updatedAt: payload.createdAt, ...revisionBump(PRAYER_UPDATES_AGGREGATE) };
    },
    PRAYER_NOT_FOUND_ERROR,
    // No-ops when this updateId is already stored, so replaying a transient
    // failure cannot duplicate the update or overwrite a newer edit.
    { retryTransientAsQueuedWrite: true }
  );
  return result;
}

export interface SetPrayerStatusViaClientPayload {
  status: PrayerStatus;
  updatedAt: string;
  answeredAt?: string;
  answerText?: string;
}

export async function setPrayerStatusViaClient(
  id: string,
  payload: SetPrayerStatusViaClientPayload
): Promise<PrayerRequest> {
  const db = getClientDb();
  const ref = doc(db, PRAYER_REQUESTS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(PRAYER_NOT_FOUND_ERROR);

  const current = hydratePrayerRequest(snap.data() as Omit<PrayerRequest, 'id'>, snap.id);
  const patch = deepCleanUndefined({
    status: payload.status,
    updatedAt: payload.updatedAt,
    ...(payload.answeredAt !== undefined ? { answeredAt: payload.answeredAt } : {}),
    ...(payload.answerText !== undefined ? { answerText: payload.answerText } : {}),
  });
  await updateDoc(ref, { ...patch, ...revisionBump(PRAYER_STATUS_AGGREGATE) });
  return hydratePrayerRequest({ ...current, ...patch } as Omit<PrayerRequest, 'id'>, id);
}
