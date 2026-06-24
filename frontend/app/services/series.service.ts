import { addDoc, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { Series } from '@/models/models';
import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from '@/utils/seriesItems';
import { timeOrZero, compareById } from '@/utils/sortHelpers';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE;

// Series use the client Firestore SDK for reads, create, and metadata-only
// updates. Operations that cross into `sermons`/`groups` stay on the server:
// DELETE and every membership op.
const SERIES_COLLECTION = 'series';

// Fields the server PUT /api/series/[id] route allows — metadata only, never items
// or sermonIds (membership flows through the dedicated cascade endpoints). The client
// update path mirrors this whitelist exactly so it can never desync the back-refs.
const SERIES_UPDATE_FIELDS: (keyof Series)[] = [
  'title', 'theme', 'description', 'bookOrTopic', 'startDate', 'duration', 'color', 'status', 'seriesKind',
];

// --- helpers mirroring series.repository.ts (kept byte-identical) ---

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

function hydrateSeries(series: Series): Series {
  const items = normalizeSeriesItems(series.items, series.sermonIds || []);
  return {
    ...series,
    items,
    sermonIds: deriveSermonIdsFromItems(items),
    seriesKind: series.seriesKind || inferSeriesKind(items),
  };
}

function sortSeries(list: Series[]): Series[] {
  return [...list].sort((a, b) => {
    const byDate = timeOrZero(b.startDate) - timeOrZero(a.startDate);
    if (byDate !== 0) return byDate;
    const byTitle = (a.title || '').localeCompare(b.title || '');
    if (byTitle !== 0) return byTitle;
    return compareById(a, b);
  });
}

// --- client-SDK read/write paths ---

async function getAllSeriesViaClient(userId: string): Promise<Series[]> {
  const db = getClientDb();
  const snap = await getDocs(query(collection(db, SERIES_COLLECTION), where('userId', '==', userId)));
  const list = snap.docs.map((d) => hydrateSeries({ ...(d.data() as Omit<Series, 'id'>), id: d.id } as Series));
  return sortSeries(list);
}

async function getSeriesByIdViaClient(seriesId: string): Promise<Series | undefined> {
  const db = getClientDb();
  const snap = await getDoc(doc(db, SERIES_COLLECTION, seriesId));
  if (!snap.exists()) return undefined;
  return hydrateSeries({ ...(snap.data() as Omit<Series, 'id'>), id: snap.id } as Series);
}

async function createSeriesViaClient(series: Omit<Series, 'id'> & { id?: string }): Promise<Series> {
  const db = getClientDb();
  const now = new Date().toISOString();
  const { id: providedId, ...rest } = series;
  const items = normalizeSeriesItems(rest.items, rest.sermonIds || []);
  const clean = deepCleanUndefined({
    ...rest,
    items,
    sermonIds: deriveSermonIdsFromItems(items),
    seriesKind: rest.seriesKind || inferSeriesKind(items),
    createdAt: now,
    updatedAt: now,
  });
  // Idempotent create when the caller supplies a client id — see groups.service
  // (setDoc on a known id makes a replayed offline create a no-op overwrite, not a dup).
  if (providedId) {
    await setDoc(doc(db, SERIES_COLLECTION, providedId), clean);
    return hydrateSeries({ ...clean, id: providedId } as Series);
  }
  const ref = await addDoc(collection(db, SERIES_COLLECTION), clean);
  return hydrateSeries({ ...clean, id: ref.id } as Series);
}

async function updateSeriesViaClient(seriesId: string, updates: Partial<Series>): Promise<Series> {
  const db = getClientDb();
  const ref = doc(db, SERIES_COLLECTION, seriesId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error(`Series ${seriesId} not found`);
  const current = hydrateSeries({ ...(snap.data() as Omit<Series, 'id'>), id: snap.id } as Series);
  // Whitelist metadata fields only — mirror the server route; never write items/sermonIds.
  const whitelisted: Record<string, unknown> = {};
  for (const field of SERIES_UPDATE_FIELDS) {
    if (updates[field] !== undefined) whitelisted[field] = updates[field];
  }
  const cleanUpdates = deepCleanUndefined({ ...whitelisted, updatedAt: new Date().toISOString() });
  await updateDoc(ref, cleanUpdates);
  return hydrateSeries({ ...current, ...cleanUpdates } as Series);
}

// NOTE: writes intentionally do NOT pre-check connectivity. Offline, the fetch
// rejects with a network error and React Query (networkMode 'offlineFirst')
// pauses + persists the mutation, replaying it on reconnect. A pre-throw would
// short-circuit that buffer and lose the write. (Client-SDK writes queue natively
// in Firestore's offline buffer instead.)

export const getAllSeries = async (userId: string): Promise<Series[]> => {
  return getAllSeriesViaClient(userId);
};

export const getSeriesById = async (seriesId: string): Promise<Series | undefined> => {
  return getSeriesByIdViaClient(seriesId);
};

export const createSeries = async (series: Omit<Series, 'id'> & { id?: string }): Promise<Series> => {
  return createSeriesViaClient(series);
};

export const updateSeries = async (seriesId: string, updates: Partial<Series>): Promise<Series> => {
  // Items/sermonIds membership flows through the dedicated cascade endpoints, never
  // updateSeries; the client path whitelists metadata only (same as the server route),
  // so it stays a pure own-doc write with no cross-collection effect.
  return updateSeriesViaClient(seriesId, updates);
};

export const deleteSeries = async (seriesId: string): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE}/api/series/${seriesId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(`deleteSeries: Response not ok for id ${seriesId}, status:`, response.status);
      throw new Error('Failed to delete series');
    }
  } catch (error) {
    console.error(`deleteSeries: Error deleting series ${seriesId}:`, error);
    throw error;
  }
};

export const addSermonToSeries = async (seriesId: string, sermonId: string, position?: number): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ sermonId, position }),
    });

    if (!response.ok) {
      console.error(`addSermonToSeries: Response not ok for series ${seriesId}, sermon ${sermonId}, status:`, response.status);
      throw new Error('Failed to add sermon to series');
    }
  } catch (error) {
    console.error(`addSermonToSeries: Error adding sermon ${sermonId} to series ${seriesId}:`, error);
    throw error;
  }
};

export const removeSermonFromSeries = async (seriesId: string, sermonId: string): Promise<void> => {
  try {
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons?sermonId=${sermonId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(`removeSermonFromSeries: Response not ok for series ${seriesId}, sermon ${sermonId}, status:`, response.status);
      throw new Error('Failed to remove sermon from series');
    }
  } catch (error) {
    console.error(`removeSermonFromSeries: Error removing sermon ${sermonId} from series ${seriesId}:`, error);
    throw error;
  }
};

export const reorderSermons = async (seriesId: string, sermonIds: string[]): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/sermons`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ sermonIds }),
    });

    if (!response.ok) {
      console.error(`reorderSermons: Response not ok for series ${seriesId}, status:`, response.status);
      throw new Error('Failed to reorder sermons');
    }
  } catch (error) {
    console.error(`reorderSermons: Error reordering sermons in series ${seriesId}:`, error);
    throw error;
  }
};

export const addGroupToSeries = async (
  seriesId: string,
  groupId: string,
  position?: number
): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/items`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'group', refId: groupId, position }),
    });

    if (!response.ok) {
      console.error(
        `addGroupToSeries: Response not ok for series ${seriesId}, group ${groupId}, status:`,
        response.status
      );
      throw new Error('Failed to add group to series');
    }
  } catch (error) {
    console.error(`addGroupToSeries: Error adding group ${groupId} to series ${seriesId}:`, error);
    throw error;
  }
};

export const removeSeriesItem = async (
  seriesId: string,
  type: 'sermon' | 'group',
  refId: string
): Promise<void> => {
  try {
    const params = new URLSearchParams({ type, refId });
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/items?${params.toString()}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      console.error(
        `removeSeriesItem: Response not ok for series ${seriesId}, type ${type}, refId ${refId}, status:`,
        response.status
      );
      throw new Error('Failed to remove item from series');
    }
  } catch (error) {
    console.error(
      `removeSeriesItem: Error removing item ${refId} (${type}) from series ${seriesId}:`,
      error
    );
    throw error;
  }
};

export const reorderSeriesItems = async (seriesId: string, itemIds: string[]): Promise<void> => {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const response = await fetch(`${API_BASE}/api/series/${seriesId}/items`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ itemIds }),
    });

    if (!response.ok) {
      console.error(`reorderSeriesItems: Response not ok for series ${seriesId}, status:`, response.status);
      throw new Error('Failed to reorder series items');
    }
  } catch (error) {
    console.error(`reorderSeriesItems: Error reordering items in series ${seriesId}:`, error);
    throw error;
  }
};
