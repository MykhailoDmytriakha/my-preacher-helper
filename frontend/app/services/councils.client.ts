'use client';

import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { readOwnerList } from '@/services/ownerListRead.client';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';

import type { Council } from '@/models/models';

export const COUNCILS_COLLECTION = 'councils';

/** The same shaping for both roads: the browser's own read and the server's answer. */
export const shapeCouncils = (documents: Record<string, unknown>[]): Council[] =>
  documents.map((data) => hydrateCouncil(data, String(data.id ?? '')));

export function hydrateCouncil(data: Record<string, unknown>, id: string): Council {
  return {
    ...(data as Omit<Council, 'id'>),
    id,
    topics: Array.isArray(data.topics) ? (data.topics as Council['topics']) : [],
    rev: typeof data.rev === 'number' ? data.rev : 0,
  };
}

async function readCouncilsViaSdk(userId: string): Promise<Council[]> {
  const db = getClientDb();
  const snapshot = await getDocs(query(collection(db, COUNCILS_COLLECTION), where('userId', '==', userId)));
  return shapeCouncils(snapshot.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

/**
 * THE LIST BY TWO ROADS — the browser's Firestore first, the app's server when that road is
 * silent. Written once for every owner list (`ownerListRead.client.ts`); this only names the
 * collection and how its documents are shaped.
 */
export function getAllCouncilsViaClient(userId: string): Promise<Council[]> {
  return readOwnerList(COUNCILS_COLLECTION, userId, readCouncilsViaSdk(userId), shapeCouncils);
}

/**
 * The OFFLINE write: the SDK queues it in the local replica and replays it when the network is
 * back. Whole document by its own id, so a replay is the same write again, never a twin.
 */
export async function setCouncilViaSdk(council: Council): Promise<void> {
  const db = getClientDb();
  const { id, ...rest } = council;
  await setDoc(doc(db, COUNCILS_COLLECTION, id), deepCleanUndefined(rest));
}

export async function deleteCouncilViaSdk(id: string): Promise<void> {
  const db = getClientDb();
  await deleteDoc(doc(db, COUNCILS_COLLECTION, id));
}
