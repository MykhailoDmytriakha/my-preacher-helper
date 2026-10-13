import { collection, getDocs, query, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Series } from '@/models/models';
import { readOwnerList } from '@/services/ownerListRead.client';
import { hydrateSeries, sortSeries } from '@/utils/seriesDocument';

/*
 * Series are written only through the data engine (engineOwnedCollections.ts). What stays here is
 * the list read the legacy membership sweep (useSeriesMembership) still uses; it goes with it.
 */
const SERIES_COLLECTION = 'series';

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

export const getAllSeries = async (userId: string): Promise<Series[]> => getAllSeriesViaClient(userId);
