import { useSyncExternalStore } from 'react';

/*
 * HOW CROSS REFERENCES SHOW ON THIS DEVICE (the owner, 2026-10-15): shown while reading the Bible,
 * as a count beside a verse; in a passage window opened from a sermon, a note or a group only when
 * asked for; the main links or all of them; the rest of a verse's links in its window as verses with
 * their text, or only as references (the owner, 2026-10-16). One record per device, like the Bible chosen
 * (`translation.ts`): the reader and the settings in the "T" menu read and write the same one, and a
 * change shows at once in both. Browser storage can be missing or refuse: the choice then lasts for
 * the visit.
 */
export type CrossReferenceMode = 'main' | 'all';

export type CrossReferencePrefs = {
  /** The count beside a verse while reading the Bible. */
  show: boolean;
  /** The same in a passage window opened from another screen. */
  inWindow: boolean;
  mode: CrossReferenceMode;
  /** The window's "others" as verses with their text, like the main links; off — only their references. */
  othersAsVerses: boolean;
};

export const DEFAULT_CROSS_REFERENCE_PREFS: CrossReferencePrefs = { show: true, inWindow: false, mode: 'main', othersAsVerses: false };

const STORAGE_KEY = 'bible:cross-references';

let memory: CrossReferencePrefs | null = null;
let snapshot: { raw: string | null; prefs: CrossReferencePrefs } | null = null;
const listeners = new Set<() => void>();

function parse(raw: string | null): CrossReferencePrefs {
  if (!raw) return DEFAULT_CROSS_REFERENCE_PREFS;
  try {
    const value = JSON.parse(raw) as Partial<CrossReferencePrefs>;
    return {
      show: typeof value.show === 'boolean' ? value.show : DEFAULT_CROSS_REFERENCE_PREFS.show,
      inWindow: typeof value.inWindow === 'boolean' ? value.inWindow : DEFAULT_CROSS_REFERENCE_PREFS.inWindow,
      mode: value.mode === 'all' || value.mode === 'main' ? value.mode : DEFAULT_CROSS_REFERENCE_PREFS.mode,
      othersAsVerses: typeof value.othersAsVerses === 'boolean' ? value.othersAsVerses : DEFAULT_CROSS_REFERENCE_PREFS.othersAsVerses,
    };
  } catch {
    return DEFAULT_CROSS_REFERENCE_PREFS;
  }
}

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The choice on this device; the same object until it changes, so React re-renders only on a change. */
export function readCrossReferencePrefs(): CrossReferencePrefs {
  if (memory) return memory;
  const raw = readRaw();
  if (!snapshot || snapshot.raw !== raw) snapshot = { raw, prefs: parse(raw) };
  return snapshot.prefs;
}

export function saveCrossReferencePrefs(change: Partial<CrossReferencePrefs>): void {
  const next = { ...readCrossReferencePrefs(), ...change };
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    memory = null;
    snapshot = { raw, prefs: next };
  } catch {
    // Storage refused: the choice lasts until the page is left.
    memory = next;
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab of the app changed it.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const serverSnapshot = () => DEFAULT_CROSS_REFERENCE_PREFS;

export function useCrossReferencePrefs(): CrossReferencePrefs {
  return useSyncExternalStore(subscribe, readCrossReferencePrefs, serverSnapshot);
}

/** Forgets the copy kept in memory — for tests. */
export function resetCrossReferencePrefsForTests(): void {
  memory = null;
  snapshot = null;
}
