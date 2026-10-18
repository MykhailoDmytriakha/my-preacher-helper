import { useSyncExternalStore } from 'react';

/*
 * A CHOICE KEPT ON THIS DEVICE — a setting the person makes on one device and finds there again: which
 * cross references show, the marker's colour. From its first read the page holds the choice in memory:
 * browser storage is read once and written through, and a screen never re-reads storage to draw. On the
 * owner's iPad a choice saved without an error was drawn as the old one a moment later — "on" three
 * times in a row, never "off", the switch off again each time (2026-10-17,
 * BUG-20261017-xref-switch-does-not-stay-on).
 *
 * Every record carries the moment of the person's action, by this device's clock, never earlier than a
 * moment this page has already seen. The later action wins: another tab's record replaces the page's
 * choice only when it is newer, so an event queued with an older value, or a write that storage refused
 * here, never undoes a newer choice. A read that fails is not remembered — the next read tries again —
 * and a write that fails, or does not read back, keeps the choice for the visit; `save` says which.
 */
export type DeviceChoiceSaved = 'kept' | 'memory-only' | 'not-read-back';

export interface DeviceChoice<T extends object> {
  /** The choice on this device; the same object until it changes, so React draws again only on a change. */
  read(): T;
  save(change: Partial<T>): DeviceChoiceSaved;
  /** The choice for a component: drawn again when it changes here or in another tab. */
  useChoice(): T;
  /** Forgets the copy in memory, so the next read takes storage again — for tests. */
  resetForTests(): void;
}

/** The moment of the action inside the stored record; `parse` of the setting never sees it. */
const SAVED_AT = '__savedAt';

function savedAt(raw: string | null): number {
  if (!raw) return 0;
  try {
    const value = (JSON.parse(raw) as Record<string, unknown>)[SAVED_AT];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function deviceChoice<T extends object>({ key, parse, fallback, onOtherTab }: {
  key: string;
  /** Storage's text as a choice; nothing or a broken record gives the defaults. */
  parse: (raw: string | null) => T;
  /** The defaults: on the server, while hydrating, and while storage cannot be read. */
  fallback: T;
  /** Another tab of the app changed it — for the technical details a feedback report sends. */
  onOtherTab?: () => void;
}): DeviceChoice<T> {
  let current: T | null = null;
  /** The moment of the action behind `current`; 0 — a record from before the moment was kept. */
  let currentAt = 0;
  let watching = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  // Another tab of the app changed it. Watched for the page's whole life, not only while a screen shows
  // it, so a change made while the reader was closed is not missed and written back later.
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea !== window.localStorage) return;
    if (event.key === null) {
      // Another tab cleared the whole storage: the next read takes what storage holds now.
      current = null;
      currentAt = 0;
    } else {
      if (event.key !== key) return;
      const at = savedAt(event.newValue);
      // Not newer than a choice this version made or read: an event queued with an older value, an equal
      // moment, or a record of the earlier version without a moment. A page holding only such a record
      // (moment 0) follows every change.
      if (current && currentAt > 0 && at <= currentAt) return;
      current = parse(event.newValue);
      currentAt = at;
    }
    onOtherTab?.();
    notify();
  };

  const read = (): T => {
    if (current) return current;
    if (typeof window === 'undefined') return fallback;
    if (!watching) {
      watching = true;
      window.addEventListener('storage', onStorage);
    }
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }
    current = parse(raw);
    currentAt = savedAt(raw);
    return current;
  };

  const save = (change: Partial<T>): DeviceChoiceSaved => {
    const next = { ...read(), ...change };
    const at = Math.max(Date.now(), currentAt + 1);
    current = next;
    currentAt = at;
    const raw = JSON.stringify({ ...next, [SAVED_AT]: at });
    let saved: DeviceChoiceSaved = 'kept';
    try {
      window.localStorage.setItem(key, raw);
      if (window.localStorage.getItem(key) !== raw) saved = 'not-read-back';
    } catch {
      saved = 'memory-only';
    }
    notify();
    return saved;
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const serverSnapshot = () => fallback;

  return {
    read,
    save,
    useChoice: () => useSyncExternalStore(subscribe, read, serverSnapshot),
    resetForTests: () => {
      current = null;
      currentAt = 0;
    },
  };
}
