import { collection, getDocs, query, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Group } from '@/models/models';
import { readOwnerList } from '@/services/ownerListRead.client';
import { hydrateGroup } from '@/utils/groupDocument';

/*
 * Groups are written only through the data engine (engineOwnedCollections.ts). What stays here is
 * the list read the legacy membership sweep (useSeriesMembership) still uses; it goes with it.
 */
const GROUPS_COLLECTION = 'groups';

/** The same shaping for both roads. */
const shapeGroups = (documents: Record<string, unknown>[]): Group[] =>
  documents
    .map((data) => hydrateGroup(data as unknown as Group))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

async function readGroupsViaSdk(userId: string): Promise<Group[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, GROUPS_COLLECTION), where('userId', '==', userId)));
  return shapeGroups(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

/* Groups share the series screen, and therefore shared its silence — see `series.service.ts`. */
async function getAllGroupsViaClient(userId: string): Promise<Group[]> {
  return readOwnerList(GROUPS_COLLECTION, userId, readGroupsViaSdk(userId), shapeGroups);
}

export const getAllGroups = async (userId: string): Promise<Group[]> => getAllGroupsViaClient(userId);
