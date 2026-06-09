import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Group, GroupFlowItem, GroupMeetingDate } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Strangler-fig flag: when ON, group READS + simple WRITES (create, content-only
// update) go through the client Firestore SDK (offline replica + deployed Security
// Rules) instead of the /api/groups server routes. Operations that cross into the
// `series` collection stay on the server: DELETE (removeGroupFromAllSeries) and any
// update that changes seriesId/seriesPosition (cascade into series.items). Meeting
// dates also stay on the server for now. Default OFF — identical to before.
const USE_CLIENT_GROUPS = process.env.NEXT_PUBLIC_USE_CLIENT_GROUPS === 'true';
const GROUPS_COLLECTION = 'groups';

// --- helpers mirroring groups.repository.ts (kept byte-identical so client and
// server produce the same shape) ---

function normalizeFlow(flow: GroupFlowItem[] = []): GroupFlowItem[] {
  return [...flow]
    .filter((item) => Boolean(item?.id) && Boolean(item.templateId))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index + 1 }));
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

function hydrateGroup(group: Group): Group {
  return {
    ...group,
    templates: group.templates || [],
    flow: normalizeFlow(group.flow || []),
    meetingDates: group.meetingDates || [],
    status: group.status || 'draft',
  };
}

// --- client-SDK read/write paths (behind the flag) ---

async function getAllGroupsViaClient(userId: string): Promise<Group[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, GROUPS_COLLECTION), where('userId', '==', userId)));
  return snap.docs
    .map((d) => hydrateGroup({ ...(d.data() as Omit<Group, 'id'>), id: d.id } as Group))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function getGroupByIdViaClient(groupId: string): Promise<Group | undefined> {
  const db = getClientDb();
  const snap = await getDoc(doc(db, GROUPS_COLLECTION, groupId));
  if (!snap.exists()) return undefined;
  return hydrateGroup({ ...(snap.data() as Omit<Group, 'id'>), id: snap.id } as Group);
}

async function createGroupViaClient(group: Omit<Group, 'id'> & { id?: string }): Promise<Group> {
  const db = getClientDb();
  const now = new Date().toISOString();
  const { id: providedId, ...rest } = group;
  const clean = deepCleanUndefined({
    ...rest,
    templates: rest.templates || [],
    flow: normalizeFlow(rest.flow || []),
    meetingDates: rest.meetingDates || [],
    status: rest.status || 'draft',
    createdAt: now,
    updatedAt: now,
  });
  // Idempotent create when the caller supplies a client id: setDoc on a known doc
  // id makes an offline-buffered create a no-op overwrite if it ever replays (no
  // duplicate), where addDoc would allocate a fresh id each run. No pre-read — a
  // getDoc on a missing doc trips the ownsExisting read rule (see
  // project_no_getdoc_precheck_on_create); create: ownsIncoming guarantees ownership.
  if (providedId) {
    await setDoc(doc(db, GROUPS_COLLECTION, providedId), clean);
    return hydrateGroup({ ...clean, id: providedId } as Group);
  }
  const ref = await addDoc(collection(db, GROUPS_COLLECTION), clean);
  return hydrateGroup({ ...clean, id: ref.id } as Group);
}

async function updateGroupViaClient(groupId: string, updates: Partial<Group>): Promise<Group> {
  const db = getClientDb();
  const ref = doc(db, GROUPS_COLLECTION, groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Group not found');
  const current = hydrateGroup({ ...(snap.data() as Omit<Group, 'id'>), id: snap.id } as Group);
  const cleanUpdates = deepCleanUndefined({
    ...updates,
    ...(updates.flow ? { flow: normalizeFlow(updates.flow) } : {}),
    updatedAt: new Date().toISOString(),
  });
  await updateDoc(ref, cleanUpdates);
  return hydrateGroup({ ...current, ...cleanUpdates } as Group);
}

async function fetchCalendarGroupsViaClient(
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Group[]> {
  const groups = await getAllGroupsViaClient(userId);
  if (!startDate && !endDate) {
    return groups.filter((group) => (group.meetingDates || []).length > 0);
  }
  return groups.filter((group) =>
    (group.meetingDates || []).some((meeting) => {
      if (startDate && meeting.date < startDate) return false;
      if (endDate && meeting.date > endDate) return false;
      return true;
    })
  );
}

// NOTE: write paths intentionally do NOT pre-check connectivity. When offline,
// the fetch below rejects with a network error and React Query (networkMode
// 'offlineFirst') pauses + persists the mutation, resuming it on reconnect.
// Throwing early here would short-circuit that buffer and lose the write.
// (Client-SDK writes queue natively in Firestore's offline buffer instead.)
export const getAllGroups = async (userId: string): Promise<Group[]> => {
  if (USE_CLIENT_GROUPS && typeof window !== 'undefined') {
    return getAllGroupsViaClient(userId);
  }
  const response = await fetch(`${API_BASE}/api/groups?userId=${userId}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error('Failed to fetch groups');
  }

  return response.json();
};

export const getGroupById = async (groupId: string): Promise<Group | undefined> => {
  if (USE_CLIENT_GROUPS && typeof window !== 'undefined') {
    return getGroupByIdViaClient(groupId);
  }
  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new Error('Failed to fetch group');
  }

  return response.json();
};

export const createGroup = async (group: Omit<Group, 'id'> & { id?: string }): Promise<Group> => {
  if (USE_CLIENT_GROUPS && typeof window !== 'undefined') {
    return createGroupViaClient(group);
  }
  const response = await fetch(`${API_BASE}/api/groups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(group),
  });

  if (!response.ok) {
    throw new Error('Failed to create group');
  }

  const data = await response.json();
  return data.group;
};

export const updateGroup = async (groupId: string, updates: Partial<Group>): Promise<Group> => {
  // seriesId/seriesPosition changes cascade into the `series` collection (cross-
  // collection write) → those MUST stay on the server. Content-only updates
  // (title/description/status/templates/flow) go via the client SDK.
  const touchesSeries = 'seriesId' in updates || 'seriesPosition' in updates;
  if (USE_CLIENT_GROUPS && typeof window !== 'undefined' && !touchesSeries) {
    return updateGroupViaClient(groupId, updates);
  }
  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    throw new Error('Failed to update group');
  }

  return response.json();
};

// DELETE stays on the server: it cascades via seriesRepository.removeGroupFromAllSeries
// (writes into the `series` collection — a cross-collection effect Security Rules
// can't express on the client).
export const deleteGroup = async (groupId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error('Failed to delete group');
  }
};

// Meeting-date operations stay on the server for now (embedded read-modify-write of
// the group's meetingDates array; they write into the same `groups` doc so the
// client cache stays in sync via Firestore). Candidate for a later slice.
export const addGroupMeetingDate = async (
  groupId: string,
  payload: Omit<GroupMeetingDate, 'id' | 'createdAt'>
): Promise<GroupMeetingDate> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to add group meeting date');
  }

  const data = await response.json();
  return data.meetingDate;
};

export const updateGroupMeetingDate = async (
  groupId: string,
  dateId: string,
  updates: Partial<GroupMeetingDate>
): Promise<GroupMeetingDate> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates/${dateId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update group meeting date');
  }

  const data = await response.json();
  return data.meetingDate;
};

export const deleteGroupMeetingDate = async (groupId: string, dateId: string): Promise<void> => {
  const response = await fetch(`${API_BASE}/api/groups/${groupId}/meeting-dates/${dateId}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to delete group meeting date');
  }
};

export const fetchCalendarGroups = async (
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Group[]> => {
  if (USE_CLIENT_GROUPS && typeof window !== 'undefined') {
    return fetchCalendarGroupsViaClient(userId, startDate, endDate);
  }
  const params = new URLSearchParams({ userId });
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);

  const response = await fetch(`${API_BASE}/api/calendar/groups?${params.toString()}`);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch calendar groups');
  }

  const data = await response.json();
  return data.groups;
};
