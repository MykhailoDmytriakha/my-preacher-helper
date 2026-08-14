import { Sermon, Preparation } from '@/models/models';
import {
  getSermonByIdViaClient,
  getSermonsViaClient,
  updateSermonPreparationViaClient,
  updateSermonViaClient,
  type SermonCoreUpdate,
} from '@/services/sermons.client';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

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
    const authHeaders = await getAuthenticatedRequestHeaders();
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...authHeaders };
    const response = await apiClient(`${API_BASE}/api/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify(sermon),
      category: 'crud'
    });
    if (!response.ok) {
      console.error("createSermon: Response not ok, status:", response.status);
      throw await writeResponseError(response, 'Failed to create sermon');
    }
    const data = await response.json();
    return data.sermon;
  } catch (error) {
    console.error('createSermon: Error creating sermon:', error);
    throw error;
  }
};

export async function deleteSermon(sermonId: string): Promise<void> {
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await apiClient(`${API_BASE}/api/sermons/${sermonId}`, {
    method: 'DELETE',
    headers: authHeaders,
    category: 'crud'
  });
  if (!response.ok) {
    throw await writeResponseError(response, `Failed to delete sermon with id ${sermonId}`);
  }
}

/**
 * `patch` names the fields the caller actually changed. Without it the whole
 * whitelist (title, verse, isPreached, preparation) is written from the caller's
 * snapshot, so saving one field reverts the others if they changed elsewhere.
 */
export const updateSermon = async (
  updatedSermon: Sermon,
  patch?: SermonCoreUpdate,
  expectedRevision: number | null = null,
  expectedBaseline?: Record<string, unknown> | null
): Promise<Sermon | null> => {
  return updateSermonViaClient(updatedSermon, patch, expectedRevision, expectedBaseline);
};

/** `changedKeys` limits the write to those preparation steps — see the client. */
export const updateSermonPreparation = async (
  sermonId: string,
  updates: Preparation,
  changedKeys?: (keyof Preparation)[]
): Promise<Preparation | null> => {
  return updateSermonPreparationViaClient(sermonId, updates, changedKeys);
};
