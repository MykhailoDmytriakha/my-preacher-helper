import { get, set } from 'idb-keyval';

export type PendingThoughtStatus = 'pending' | 'error' | 'sending';

export type PendingThoughtSection = 'introduction' | 'main' | 'conclusion';

export interface PendingThoughtRecord {
  localId: string;
  sermonId: string;
  sectionId: PendingThoughtSection;
  text: string;
  tags: string[];
  outlinePointId?: string;
  createdAt: string;
  lastAttemptAt: string;
  expiresAt: string;
  status: PendingThoughtStatus;
  lastError?: string;
}

const PENDING_THOUGHTS_KEY_PREFIX = 'pending-thoughts:';

export const LOCAL_THOUGHT_PREFIX = 'local-';

export const buildLocalThoughtId = () => `${LOCAL_THOUGHT_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getPendingThoughtsKey = (sermonId: string) => `${PENDING_THOUGHTS_KEY_PREFIX}${sermonId}`;

const hasIndexedDb = typeof indexedDB !== 'undefined';
const memoryStore = new Map<string, PendingThoughtRecord[]>();

export const loadPendingThoughts = async (sermonId: string): Promise<PendingThoughtRecord[]> => {
  const key = getPendingThoughtsKey(sermonId);
  if (!hasIndexedDb) {
    return memoryStore.get(key) ?? [];
  }
  const stored = await get<PendingThoughtRecord[]>(key);
  return Array.isArray(stored) ? stored : [];
};

export const savePendingThoughts = async (sermonId: string, items: PendingThoughtRecord[]): Promise<void> => {
  const key = getPendingThoughtsKey(sermonId);
  if (!hasIndexedDb) {
    memoryStore.set(key, items);
    return;
  }
  await set(key, items);
};
