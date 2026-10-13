import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Group } from '@/models/models';
import { readOwnerDocument, readOwnerList } from '@/services/ownerListRead.client';
import { hydrateGroup } from '@/utils/groupDocument';
import { auth } from '@services/firebaseAuth.service';

/*
 * Groups are written only through the data engine (engineOwnedCollections.ts). What stays here are
 * the two reads the legacy series hooks still use (useSeriesDetail, useSeriesMembership); they go
 * when series leave the legacy road.
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

async function readOneGroupViaSdk(groupId: string): Promise<Group | undefined> {
  const db = getClientDb();
  const snap = await getDoc(doc(db, GROUPS_COLLECTION, groupId));
  if (!snap.exists()) return undefined;
  return hydrateGroup({ ...(snap.data() as Omit<Group, 'id'>), id: snap.id } as Group);
}

async function getGroupByIdViaClient(groupId: string): Promise<Group | undefined> {
  const owner = auth.currentUser?.uid;
  if (!owner) return readOneGroupViaSdk(groupId);
  return readOwnerDocument(GROUPS_COLLECTION, owner, groupId, readOneGroupViaSdk(groupId), shapeGroups);
}

export const getAllGroups = async (userId: string): Promise<Group[]> => getAllGroupsViaClient(userId);

export const getGroupById = async (groupId: string): Promise<Group | undefined> => getGroupByIdViaClient(groupId);
