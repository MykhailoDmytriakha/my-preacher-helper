import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Group, GroupFlowItem, GroupMeetingDate } from '@/models/models';
import { atomicUpdate } from '@/services/atomicUpdate.client';
import { conflictSafeUpdate, revisionBump } from '@/services/conflictSafeUpdate.client';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { newClientId } from '@/utils/clientId';

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

// Groups use the client Firestore SDK for reads and own-doc writes, including
// meeting dates (embedded read-modify-write of the group's meetingDates[] array
// — same `groups` doc, so the native offline queue owns durability). Only
// operations that cross into `series` stay on the server: DELETE
// (removeGroupFromAllSeries) and updates that change seriesId/seriesPosition.
const GROUPS_COLLECTION = 'groups';
const GROUP_NOT_FOUND = 'Group not found';

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

// --- client-SDK read/write paths ---

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

/** Group content edited by a human is one aggregate; meetingDates are handled apart. */
export const GROUP_CONTENT_AGGREGATE = 'content';
export const GROUP_MEETING_DATES_AGGREGATE = 'meetingDates';

async function updateGroupViaClient(
  groupId: string,
  updates: Partial<Group>,
  expectedRevision: number | null = null,
  /**
   * The values these fields had when the editor OPENED — its own baseline, not a
   * fresh read. This is the whole difference between a real check and a no-op: a
   * fingerprint taken from a `getDoc` issued moments before the write compares the
   * server with itself and always agrees, so the stale text goes in.
   */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<Group> {
  const db = getClientDb();
  const ref = doc(db, GROUPS_COLLECTION, groupId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(GROUP_NOT_FOUND);
  const current = hydrateGroup({ ...(snap.data() as Omit<Group, 'id'>), id: snap.id } as Group);
  const cleanUpdates = deepCleanUndefined({
    ...updates,
    ...(updates.flow ? { flow: normalizeFlow(updates.flow) } : {}),
    updatedAt: new Date().toISOString(),
  });
  // GUARDED PATH — see conflictSafeUpdate.client.ts. No revision stated = old path.
  if (expectedRevision !== null) {
    const committed = await conflictSafeUpdate(ref, cleanUpdates, GROUP_NOT_FOUND, {
      aggregate: GROUP_CONTENT_AGGREGATE,
      expectedRevision,
      // Content check alongside the counter — from the CALLER's opening values, so
      // a writer that skipped the counter is caught and an unrelated field never
      // provokes a false conflict.
      expectedBaseline,
      outboxRoute: current.userId
        ? { uid: current.userId, collection: GROUPS_COLLECTION, docId: groupId, savedAt: Date.now() }
        : undefined,
    });
    // Carry the COMMITTED revision back. Without it the caller keeps the pre-write
    // number and its next save is refused as stale — a false conflict on the
    // person's own follow-up edit, which is exactly what trains people to click
    // through the dialog.
    return hydrateGroup({
      ...current,
      ...cleanUpdates,
      rev: { ...(current.rev ?? {}), [GROUP_CONTENT_AGGREGATE]: committed },
    } as Group);
  }

  // Unguarded path still advances the counter — see revisionBump.
  await updateDoc(ref, { ...cleanUpdates, ...revisionBump(GROUP_CONTENT_AGGREGATE) });
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

// --- meeting-dates: embedded own-doc RMW (mirror addPreachDateViaClient) ---
// These write ONLY { meetingDates, updatedAt } — never content fields. That
// field-disjointness is what lets a content update and a meeting-date update to
// the same group doc in one autosave compose without lost-updates.

async function addGroupMeetingDateViaClient(
  groupId: string,
  data: Omit<GroupMeetingDate, 'id' | 'createdAt'> & { id?: string }
): Promise<GroupMeetingDate> {
  const db = getClientDb();
  const ref = doc(db, GROUPS_COLLECTION, groupId);
  const mintedId = data.id ?? newClientId();

  // Full-array write → must be computed from fresh data, or a meeting date added
  // on another device is wiped. atomicUpdate re-runs this if the doc changed.
  let committed!: GroupMeetingDate;
  await atomicUpdate<Group>(
    ref,
    (group) => {
      const meetingDates = group.meetingDates || [];

      // Look up by the id that will actually be written — including one minted
      // here. `deadline-exceeded` can be reported AFTER a successful commit, so a
      // retry (SDK-internal or our queued fallback) must find its own entry and
      // no-op instead of appending a duplicate.
      const existing = meetingDates.find((entry) => entry.id === mintedId);
      if (existing) {
        committed = existing; // replay no-op
        return null;
      }

      committed = {
        ...data,
        id: mintedId,
        createdAt: new Date().toISOString(),
      } as GroupMeetingDate;
      return {
        meetingDates: [...meetingDates, deepCleanUndefined(committed)],
        updatedAt: new Date().toISOString(),
        ...revisionBump(GROUP_MEETING_DATES_AGGREGATE),
      };
    },
    GROUP_NOT_FOUND,
    { retryTransientAsQueuedWrite: true } // no-ops when mintedId already exists
  );
  return committed;
}

async function updateGroupMeetingDateViaClient(
  groupId: string,
  dateId: string,
  updates: Partial<GroupMeetingDate>
): Promise<GroupMeetingDate> {
  const db = getClientDb();
  const ref = doc(db, GROUPS_COLLECTION, groupId);

  // DELIBERATELY NOT transactional — same reason as updateThoughtViaClient: a
  // merge of caller-supplied fields is unsafe to re-run, and Firestore may
  // re-invoke a transaction callback after a commit whose response was lost.
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(GROUP_NOT_FOUND);
  const meetingDates = (hydrateGroup({ ...(snap.data() as Omit<Group, 'id'>), id: snap.id } as Group)).meetingDates || [];
  const index = meetingDates.findIndex((entry) => entry.id === dateId);
  if (index === -1) throw new Error('Meeting date not found');

  const updatedMeetingDate: GroupMeetingDate = {
    ...meetingDates[index],
    ...updates,
    id: meetingDates[index].id,
    createdAt: meetingDates[index].createdAt,
  };

  const nextDates = [...meetingDates];
  nextDates[index] = deepCleanUndefined(updatedMeetingDate);
  await updateDoc(ref, {
    meetingDates: nextDates,
    updatedAt: new Date().toISOString(),
    // Its own aggregate: a meeting-date edit must not make the CONTENT editor
    // look stale, and content edits must not vouch for meeting dates.
    ...revisionBump(GROUP_MEETING_DATES_AGGREGATE),
  });
  return updatedMeetingDate;
}

async function deleteGroupMeetingDateViaClient(groupId: string, dateId: string): Promise<void> {
  const db = getClientDb();
  await atomicUpdate<Group>(
    doc(db, GROUPS_COLLECTION, groupId),
    (group) => ({
      meetingDates: (group.meetingDates || []).filter((entry) => entry.id !== dateId),
      updatedAt: new Date().toISOString(),
      ...revisionBump(GROUP_MEETING_DATES_AGGREGATE),
    }),
    GROUP_NOT_FOUND,
    { retryTransientAsQueuedWrite: true } // removal is idempotent on fresh data
  );
}

// NOTE: write paths intentionally do NOT pre-check connectivity. When offline,
// the fetch below rejects with a network error and React Query (networkMode
// 'offlineFirst') pauses + persists the mutation, resuming it on reconnect.
// Throwing early here would short-circuit that buffer and lose the write.
// (Client-SDK writes queue natively in Firestore's offline buffer instead.)
export const getAllGroups = async (userId: string): Promise<Group[]> => {
  return getAllGroupsViaClient(userId);
};

export const getGroupById = async (groupId: string): Promise<Group | undefined> => {
  return getGroupByIdViaClient(groupId);
};

export const createGroup = async (group: Omit<Group, 'id'> & { id?: string }): Promise<Group> => {
  return createGroupViaClient(group);
};

export const updateGroup = async (
  groupId: string,
  updates: Partial<Group>,
  /** Revision this edit was built from; `null` keeps the unguarded legacy path. */
  expectedRevision: number | null = null,
  /** The content fields as the SCREEN OPENED them — see the guard's baseline. */
  expectedBaseline: Record<string, unknown> | null = null
): Promise<Group> => {
  // Playlist model: a group's series membership lives in series.items and is
  // written ONLY by the client sweep (useSeriesMembership) — never as a group
  // back-ref. Strip the deprecated seriesId/seriesPosition so a stray caller
  // can't write them, and keep updateGroup a pure own-doc client write.
  const { seriesId: _seriesId, seriesPosition: _seriesPosition, ...contentUpdates } = updates;
  return updateGroupViaClient(groupId, contentUpdates, expectedRevision, expectedBaseline);
};

// DELETE stays on the server: it cascades via seriesRepository.removeGroupFromAllSeries
// (writes into the `series` collection — a cross-collection effect Security Rules
// can't express on the client).
export const deleteGroup = async (groupId: string): Promise<void> => {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await fetch(`${API_BASE}/api/groups/${groupId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });

  if (!response.ok) {
    throw await writeResponseError(response, 'Failed to delete group');
  }
};

// Meeting-date operations run through the client Firestore SDK (own-doc embedded
// RMW on the group's meetingDates[] array). addGroupMeetingDate accepts an
// optional caller-minted id so a replayed/offline-buffered add is idempotent.
export const addGroupMeetingDate = async (
  groupId: string,
  payload: Omit<GroupMeetingDate, 'id' | 'createdAt'> & { id?: string }
): Promise<GroupMeetingDate> => {
  return addGroupMeetingDateViaClient(groupId, payload);
};

export const updateGroupMeetingDate = async (
  groupId: string,
  dateId: string,
  updates: Partial<GroupMeetingDate>
): Promise<GroupMeetingDate> => {
  return updateGroupMeetingDateViaClient(groupId, dateId, updates);
};

export const deleteGroupMeetingDate = async (groupId: string, dateId: string): Promise<void> => {
  return deleteGroupMeetingDateViaClient(groupId, dateId);
};

export const fetchCalendarGroups = async (
  userId: string,
  startDate?: string,
  endDate?: string
): Promise<Group[]> => {
  return fetchCalendarGroupsViaClient(userId, startDate, endDate);
};
