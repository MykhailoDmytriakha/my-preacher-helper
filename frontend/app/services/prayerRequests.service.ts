import { PrayerRequest, PrayerStatus } from '@/models/models';
import { newClientId } from '@/utils/clientId';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export interface AddPrayerUpdatePayload {
  updateId?: string;
  text: string;
  createdAt?: string;
}

export interface SetPrayerStatusPayload {
  status: PrayerStatus;
  updatedAt?: string;
  answeredAt?: string;
  answerText?: string;
}

const clientActive = () =>
  process.env.NEXT_PUBLIC_USE_CLIENT_PRAYER === 'true' && typeof window !== 'undefined';

const normalizeAddUpdatePayload = (input: string | AddPrayerUpdatePayload): AddPrayerUpdatePayload =>
  typeof input === 'string' ? { text: input } : input;

const withStableUpdateReplayFields = (payload: AddPrayerUpdatePayload) => ({
  updateId: payload.updateId ?? newClientId(),
  text: payload.text,
  createdAt: payload.createdAt ?? new Date().toISOString(),
});

const normalizeStatusPayload = (
  statusOrPayload: PrayerStatus | SetPrayerStatusPayload,
  answerText?: string
): SetPrayerStatusPayload =>
  typeof statusOrPayload === 'string'
    ? { status: statusOrPayload, answerText }
    : statusOrPayload;

const withStableStatusReplayFields = (payload: SetPrayerStatusPayload) => {
  const updatedAt = payload.updatedAt ?? new Date().toISOString();
  const { answeredAt, ...rest } = payload;
  return {
    ...rest,
    updatedAt,
    ...(payload.status === 'answered' ? { answeredAt: answeredAt ?? updatedAt } : {}),
  };
};

// NOTE: writes intentionally do NOT pre-check connectivity — see groups.service
// for the rationale. Offline, the fetch rejects and React Query buffers + replays.

export const getAllPrayerRequests = async (userId: string): Promise<PrayerRequest[]> => {
  if (clientActive()) {
    const { getAllPrayerRequestsViaClient } = await import('./prayerRequests.client');
    return getAllPrayerRequestsViaClient(userId);
  }
  const res = await fetch(`${API_BASE}/api/prayer?userId=${userId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch prayer requests');
  return res.json();
};

export const getPrayerRequestById = async (id: string): Promise<PrayerRequest | undefined> => {
  if (clientActive()) {
    const { getPrayerRequestByIdViaClient } = await import('./prayerRequests.client');
    return getPrayerRequestByIdViaClient(id);
  }
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch prayer request');
  return res.json();
};

export const createPrayerRequest = async (
  payload: Pick<PrayerRequest, 'userId' | 'title'> &
    Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>> & { id?: string }
): Promise<PrayerRequest> => {
  // Create stays server-only even with the client flag ON. It has no cascade,
  // but replaying client setDoc could full-overwrite mutable fields like
  // updates/status; the server create path returns existing client-id docs
  // without clobbering them.
  const res = await fetch(`${API_BASE}/api/prayer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create prayer request');
  return res.json();
};

export const updatePrayerRequest = async (id: string, updates: Partial<PrayerRequest>): Promise<PrayerRequest> => {
  if (clientActive()) {
    const { updatePrayerRequestViaClient } = await import('./prayerRequests.client');
    return updatePrayerRequestViaClient(id, updates);
  }
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update prayer request');
  return res.json();
};

export const deletePrayerRequest = async (id: string): Promise<void> => {
  if (clientActive()) {
    const { deletePrayerRequestViaClient } = await import('./prayerRequests.client');
    return deletePrayerRequestViaClient(id);
  }
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete prayer request');
};

export const addPrayerUpdate = async (
  id: string,
  input: string | AddPrayerUpdatePayload
): Promise<PrayerRequest> => {
  const payload = normalizeAddUpdatePayload(input);
  if (clientActive()) {
    const { addPrayerUpdateViaClient } = await import('./prayerRequests.client');
    return addPrayerUpdateViaClient(id, withStableUpdateReplayFields(payload));
  }
  const res = await fetch(`${API_BASE}/api/prayer/${id}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: payload.text }),
  });
  if (!res.ok) throw new Error('Failed to add prayer update');
  return res.json();
};

export const setPrayerStatus = async (
  id: string,
  statusOrPayload: PrayerStatus | SetPrayerStatusPayload,
  answerText?: string
): Promise<PrayerRequest> => {
  const payload = normalizeStatusPayload(statusOrPayload, answerText);
  if (clientActive()) {
    const { setPrayerStatusViaClient } = await import('./prayerRequests.client');
    return setPrayerStatusViaClient(id, withStableStatusReplayFields(payload));
  }
  const res = await fetch(`${API_BASE}/api/prayer/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: payload.status,
      ...(payload.answerText !== undefined && { answerText: payload.answerText }),
    }),
  });
  if (!res.ok) throw new Error('Failed to update prayer status');
  return res.json();
};
