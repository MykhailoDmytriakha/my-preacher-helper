import { PrayerRequest, PrayerStatus } from '@/models/models';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const isBrowserOffline = () => typeof navigator !== 'undefined' && !navigator.onLine;
const OFFLINE_ERROR = 'Offline: operation not available.';

export const getAllPrayerRequests = async (userId: string): Promise<PrayerRequest[]> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer?userId=${userId}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch prayer requests');
  return res.json();
};

export const getPrayerRequestById = async (id: string): Promise<PrayerRequest | undefined> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch prayer request');
  return res.json();
};

export const createPrayerRequest = async (
  payload: Pick<PrayerRequest, 'userId' | 'title'> & Partial<Pick<PrayerRequest, 'description' | 'categoryId' | 'tags'>>
): Promise<PrayerRequest> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Failed to create prayer request');
  return res.json();
};

export const updatePrayerRequest = async (id: string, updates: Partial<PrayerRequest>): Promise<PrayerRequest> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  if (!res.ok) throw new Error('Failed to update prayer request');
  return res.json();
};

export const deletePrayerRequest = async (id: string): Promise<void> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete prayer request');
};

export const addPrayerUpdate = async (id: string, text: string): Promise<PrayerRequest> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer/${id}/updates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error('Failed to add prayer update');
  return res.json();
};

export const setPrayerStatus = async (id: string, status: PrayerStatus, answerText?: string): Promise<PrayerRequest> => {
  if (isBrowserOffline()) throw new Error(OFFLINE_ERROR);
  const res = await fetch(`${API_BASE}/api/prayer/${id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, ...(answerText !== undefined && { answerText }) }),
  });
  if (!res.ok) throw new Error('Failed to update prayer status');
  return res.json();
};
