import { PrayerRequest, PrayerStatus } from '@/models/models';
import {
  addPrayerUpdateViaClient,
  deletePrayerRequestViaClient,
  getAllPrayerRequestsViaClient,
  getPrayerRequestByIdViaClient,
  setPrayerStatusViaClient,
  updatePrayerRequestViaClient,
} from '@/services/prayerRequests.client';
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

export const getAllPrayerRequests = async (userId: string): Promise<PrayerRequest[]> => {
  return getAllPrayerRequestsViaClient(userId);
};

export const getPrayerRequestById = async (id: string): Promise<PrayerRequest | undefined> => {
  return getPrayerRequestByIdViaClient(id);
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
  return updatePrayerRequestViaClient(id, updates);
};

export const deletePrayerRequest = async (id: string): Promise<void> => {
  return deletePrayerRequestViaClient(id);
};

export const addPrayerUpdate = async (
  id: string,
  input: string | AddPrayerUpdatePayload
): Promise<PrayerRequest> => {
  const payload = normalizeAddUpdatePayload(input);
  return addPrayerUpdateViaClient(id, withStableUpdateReplayFields(payload));
};

export const setPrayerStatus = async (
  id: string,
  statusOrPayload: PrayerStatus | SetPrayerStatusPayload,
  answerText?: string
): Promise<PrayerRequest> => {
  const payload = normalizeStatusPayload(statusOrPayload, answerText);
  return setPrayerStatusViaClient(id, withStableStatusReplayFields(payload));
};
