import { Sermon, Preparation } from '@/models/models';
import {
  USE_CLIENT_SERMONS,
  getSermonByIdViaClient,
  getSermonsViaClient,
  updateSermonPreparationViaClient,
  updateSermonViaClient,
} from '@/services/sermons.client';
import { apiClient } from '@/utils/apiClient';
import { FetchTimeoutError } from '@/utils/fetchWithTimeout';
import { timeOrZero, compareById } from '@/utils/sortHelpers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;
const clientActive = () => USE_CLIENT_SERMONS && typeof window !== 'undefined';

const isExpectedFetchFailure = (error: unknown): boolean => {
  if (error instanceof FetchTimeoutError) {
    return true;
  }

  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message === 'Failed to fetch' ||
    error.name === 'TypeError' ||
    error.message.includes('NetworkError')
  );
};

export const getSermons = async (userId: string): Promise<Sermon[]> => {
  if (clientActive()) {
    return getSermonsViaClient(userId);
  }
  try {
    const response = await apiClient(`${API_BASE}/api/sermons?userId=${userId}`, {
      cache: "no-store",
      category: 'metadata'
    });
    if (!response.ok) {
      console.error(`getSermons: Response not ok, status: ${response.status}`);
      throw new Error('Failed to fetch sermons');
    }
    const data = await response.json();
    return (data as Sermon[]).sort((a, b) => {
      const byDate = timeOrZero(b.date) - timeOrZero(a.date);
      if (byDate !== 0) return byDate;
      // Deterministic tiebreaker on equal dates: keeps array order stable across
      // fetches so React Query structural sharing holds (prevents the cache→server
      // "reorder flash" on cold load).
      return compareById(a, b);
    });
  } catch (error) {
    console.error('getSermons: Error fetching sermons:', error);
    throw error;
  }
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  if (clientActive()) {
    return getSermonByIdViaClient(id);
  }
  try {
    const response = await apiClient(`${API_BASE}/api/sermons/${id}`, {
      cache: "no-store",
      category: 'detail'
    });
    if (!response.ok) {
      if (response.status === 404) {
        console.warn(`getSermonById: Sermon ${id} not found (404)`);
        return undefined; // Return undefined for 404 - sermon was deleted
      }
      console.error(`getSermonById: Response not ok for id ${id}, status: ${response.status}`);
      throw new Error('Failed to fetch sermon');
    }
    const data = await response.json();
    return data;
  } catch (error) {
    if (!isExpectedFetchFailure(error)) {
      console.error(`getSermonById: Error fetching sermon ${id}:`, error);
    }
    throw error;
  }
};

export const createSermon = async (sermon: Omit<Sermon, 'id'> & { id?: string }): Promise<Sermon> => {
  // createSermon stays on the server even when the flag is ON — as a principled
  // boundary, not a workaround. A create can cascade into a series
  // (addSermonToSeries), so it follows the same "cross-collection cascade -> server"
  // rule every other collection uses (groups series-link, series membership, tag
  // delete). The server's get-then-set is already idempotent by client id, and
  // addPreachDate is now idempotent by id too (see preachDates), so there is no
  // replay-dup landmine. Moving create to a client setDoc would only add a
  // replay-clobber risk (a late online-flush resetting thoughts[]) for no real gain.
  // All sermon READS and own-doc EDITS (structure/outline/thoughts/preachDates/update)
  // are on the client.
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await apiClient(`${API_BASE}/api/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sermon),
      category: 'crud'
    });
    if (!response.ok) {
      console.error("createSermon: Response not ok, status:", response.status);
      throw new Error('Failed to create sermon');
    }
    const data = await response.json();
    return data.sermon;
  } catch (error) {
    console.error('createSermon: Error creating sermon:', error);
    throw error;
  }
};

export async function deleteSermon(sermonId: string): Promise<void> {
  const response = await apiClient(`${API_BASE}/api/sermons/${sermonId}`, {
    method: 'DELETE',
    category: 'crud'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete sermon with id ${sermonId}`);
  }
}

export const updateSermon = async (updatedSermon: Sermon): Promise<Sermon | null> => {
  if (clientActive()) {
    return updateSermonViaClient(updatedSermon);
  }
  try {
    const response = await apiClient(`${API_BASE}/api/sermons/${updatedSermon.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedSermon),
      category: 'crud'
    });
    if (!response.ok) {
      console.error(`updateSermon: Response not ok for id ${updatedSermon.id}, status: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('updateSermon: Error updating sermon', error);
    return null;
  }
};

export const updateSermonPreparation = async (sermonId: string, updates: Preparation): Promise<Preparation | null> => {
  if (clientActive()) {
    return updateSermonPreparationViaClient(sermonId, updates);
  }
  try {
    const response = await apiClient(`${API_BASE}/api/sermons/${sermonId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: sermonId, preparation: updates }),
      category: 'crud'
    });
    if (!response.ok) {
      console.error(`updateSermonPreparation: Response not ok for id ${sermonId}, status: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.preparation ?? updates;
  } catch (error) {
    console.error('updateSermonPreparation: Error updating preparation', error);
    return null;
  }
};
