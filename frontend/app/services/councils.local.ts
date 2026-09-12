import type { Council } from '@/models/models';

/**
 * THE BROWSER'S OWN COPY FROM BEFORE THE DATABASE. Councils lived in localStorage while the
 * section's shape was being settled (2026-09-11); the first read from the database carries
 * them over and then this key is cleared. Nothing new is written here.
 */
const STORAGE_VERSION = 1;

export const councilsStorageKey = (userId: string) => `councils:v${STORAGE_VERSION}:${userId}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readLocalCouncils(userId: string): Council[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(councilsStorageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as Council[]) : [];
  } catch {
    return [];
  }
}

export function clearLocalCouncils(userId: string): void {
  try {
    storage()?.removeItem(councilsStorageKey(userId));
  } catch {
    // Nothing to clear, or storage refused: the copy is harmless either way.
  }
}
