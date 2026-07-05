import { createStore, del, entries, get, set } from 'idb-keyval';

import { newClientId } from '@/utils/clientId';

/**
 * Durable client-side store for UNFINISHED audio recordings. When a transcription
 * fails (or the tab is closed mid-flow), the raw recorded Blob is parked here so
 * the user's dictated thought survives a reload instead of being lost. IndexedDB
 * stores Blobs natively, so no base64 round-trip is needed.
 *
 * A DEDICATED idb-keyval store ('recording-drafts' object store in its own
 * 'recording-drafts' database) keeps these blobs off the React Query cache store.
 */
export type RecordingDraftContext = 'study' | 'thought' | 'sermon' | 'prayer';

export interface RecordingDraft {
  id: string; // uuid
  blob: Blob; // the recorded audio
  mimeType: string;
  createdAt: number; // Date.now()
  context: RecordingDraftContext;
  contextId?: string; // e.g. study id / sermon id, to scope drafts to a page
  sizeBytes: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Lazily create the store so importing this module is SSR-safe (createStore
// touches indexedDB). Returns null when IndexedDB is unavailable.
let store: ReturnType<typeof createStore> | null = null;
const getStore = () => {
  if (typeof indexedDB === 'undefined') return null;
  if (!store) store = createStore('recording-drafts', 'recording-drafts');
  return store;
};

export async function saveRecordingDraft(
  input: Omit<RecordingDraft, 'id' | 'createdAt' | 'sizeBytes'> & { id?: string }
): Promise<string> {
  const s = getStore();
  const id = input.id ?? newClientId();
  if (!s) return id;
  const draft: RecordingDraft = {
    id,
    blob: input.blob,
    mimeType: input.mimeType,
    context: input.context,
    contextId: input.contextId,
    createdAt: Date.now(),
    sizeBytes: input.blob.size,
  };
  await set(id, draft, s);
  return id;
}

export async function listRecordingDrafts(filter?: {
  context?: RecordingDraftContext;
  contextId?: string;
}): Promise<RecordingDraft[]> {
  const s = getStore();
  if (!s) return [];
  const all = await entries<string, RecordingDraft>(s);
  return all
    .map(([, draft]) => draft)
    .filter((draft) => {
      if (filter?.context && draft.context !== filter.context) return false;
      if (filter?.contextId && draft.contextId !== filter.contextId) return false;
      return true;
    })
    .sort((a, b) => b.createdAt - a.createdAt); // newest first
}

export async function getRecordingDraft(id: string): Promise<RecordingDraft | undefined> {
  const s = getStore();
  if (!s) return undefined;
  return get<RecordingDraft>(id, s);
}

export async function deleteRecordingDraft(id: string): Promise<void> {
  const s = getStore();
  if (!s) return;
  await del(id, s);
}

/**
 * Pure decision: which draft ids are past their TTL as of `now`. Factored out so
 * the expiry rule is unit-testable without IndexedDB.
 */
export function selectExpiredDraftIds(
  drafts: { id: string; createdAt: number }[],
  now: number,
  ttlMs: number
): string[] {
  const cutoff = now - ttlMs;
  return drafts.filter((d) => d.createdAt < cutoff).map((d) => d.id);
}

export async function pruneExpiredDrafts(ttlMs: number = DEFAULT_TTL_MS): Promise<number> {
  const s = getStore();
  if (!s) return 0;
  const all = await entries<string, RecordingDraft>(s);
  const expired = selectExpiredDraftIds(
    all.map(([, draft]) => draft),
    Date.now(),
    ttlMs
  );
  await Promise.all(expired.map((id) => del(id, s)));
  return expired.length;
}
