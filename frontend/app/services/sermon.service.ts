import { Sermon, Preparation } from '@/models/models';
import { apiClient } from '@/utils/apiClient';
import { FetchTimeoutError } from '@/utils/fetchWithTimeout';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

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
    return data.sort((a: Sermon, b: Sermon) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('getSermons: Error fetching sermons:', error);
    throw error;
  }
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
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

export const createSermon = async (sermon: Omit<Sermon, 'id'>): Promise<Sermon> => {
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
