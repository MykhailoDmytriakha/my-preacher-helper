import { Sermon, Preparation } from '@/models/models';
import {
  getSermonByIdViaClient,
  getSermonsViaClient,
  updateSermonPreparationViaClient,
  updateSermonViaClient,
} from '@/services/sermons.client';
import { apiClient } from '@/utils/apiClient';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

export const getSermons = async (userId: string): Promise<Sermon[]> => {
  return getSermonsViaClient(userId);
};

export const getSermonById = async (id: string): Promise<Sermon | undefined> => {
  return getSermonByIdViaClient(id);
};

export const createSermon = async (sermon: Omit<Sermon, 'id'> & { id?: string }): Promise<Sermon> => {
  // createSermon stays on the server as a principled boundary. The server's
  // get-then-set is idempotent by client id, and addPreachDate is idempotent by
  // id too (see preachDates), so there is no replay-dup landmine. Moving create
  // to a client setDoc would only add a replay-clobber risk (a late online-flush
  // resetting thoughts[]) for no real gain. Series membership is NO LONGER a
  // create concern: the playlist model writes it exclusively through the client
  // sweep (useSeriesMembership) into series.items — the create route ignores any
  // seriesId in the body. All sermon READS and own-doc EDITS
  // (structure/outline/thoughts/preachDates/update) are on the client.
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
  return updateSermonViaClient(updatedSermon);
};

export const updateSermonPreparation = async (sermonId: string, updates: Preparation): Promise<Preparation | null> => {
  return updateSermonPreparationViaClient(sermonId, updates);
};
