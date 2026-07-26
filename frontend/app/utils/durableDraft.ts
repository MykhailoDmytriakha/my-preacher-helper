/**
 * Durable drafts — the user's text must survive a closed tab, a crash, a reload
 * and a failed write.
 *
 * WHY THIS EXISTS. Editors keep the text the user is typing in React state and
 * persist it on a debounce. Everything typed between the last keystroke and the
 * debounce firing exists ONLY in memory, so it dies with the page. The study
 * note editor is the sharpest case: its autosave effect CANCELS the pending save
 * on cleanup (`studies/[id]/page.tsx:225-232`), so typing and navigating away
 * within 1.5s loses the text with no signal at all.
 *
 * A draft is written BEFORE any write is attempted and cleared only once the
 * server has accepted that exact value. Therefore the invariant is precise:
 *
 *     a draft exists  <=>  there is text that was never confirmed as saved
 *
 * which is what makes "offer to restore it" unambiguous rather than noisy.
 *
 * This generalises the one-off backup the preparation editor already had
 * (`sermons/[id]/page.tsx:307-330`) and closes three holes it has:
 *   1. its key is `prep-draft-backup-<sermonId>` with NO uid, so on a shared
 *      computer the next account can read the previous account's text;
 *   2. it applies the local copy over remote silently ("local wins over stale
 *      remote"), so a draft left behind by a failed save keeps re-applying over
 *      genuinely newer text edited on another device;
 *   3. it is written only when a save is attempted, so text typed and never
 *      submitted is not backed up at all.
 *
 * Storage is localStorage, deliberately: it is synchronous, so a draft can be
 * written during `pagehide` when the page is already going away. IndexedDB is
 * async and is not reliably flushed at that moment.
 */

/** Bump when the stored shape changes; old entries are then ignored, not parsed. */
const PREFIX = 'draft:v1:';

/** A single stored draft. `savedAt` is only used for eviction ordering. */
export interface DurableDraft<T> {
  value: T;
  savedAt: number;
}

/**
 * Drafts are scoped by owner AND document AND aggregate.
 *
 * - `uid` keeps one account's text out of the next account's editor on a shared
 *   computer (the mistake the preparation backup makes).
 * - `aggregate` keeps independently edited parts of the same document apart, so
 *   restoring an outline draft cannot resurrect stale preparation text.
 */
export function draftKey(uid: string, docId: string, aggregate: string): string {
  return `${PREFIX}${uid}:${docId}:${aggregate}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage;
  } catch {
    // Access itself throws in some privacy modes.
    return null;
  }
}

/**
 * Persist a draft. Never throws: losing the safety net must not break typing.
 *
 * On a quota error we evict the OLDEST drafts (never the one being written) and
 * retry once. Failing silently after that is the correct trade — the editor
 * keeps working, and the caller learns nothing it could act on anyway.
 */
export function saveDraft<T>(key: string, value: T): void {
  const store = storage();
  if (!store) return;

  const payload = JSON.stringify({ value, savedAt: Date.now() } satisfies DurableDraft<T>);

  try {
    store.setItem(key, payload);
  } catch {
    evictOldestDrafts(store, key);
    try {
      store.setItem(key, payload);
    } catch {
      // Out of room even after eviction — the draft is simply not kept.
    }
  }
}

/** Read a draft, or null when absent/unparsable. Never throws. */
export function readDraft<T>(key: string): DurableDraft<T> | null {
  const store = storage();
  if (!store) return null;

  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DurableDraft<T>;
    if (!parsed || typeof parsed !== 'object' || !('value' in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Drop a draft unconditionally (the user discarded it). Never throws. */
export function clearDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/**
 * Drop a draft ONLY if it still holds exactly what was just confirmed saved.
 *
 * This is what makes two tabs on one document safe. Both tabs share the key, so
 * the later typist owns the stored draft. If tab A saves its text while the
 * stored draft already belongs to tab B, an unconditional clear would destroy
 * B's unsaved text — the very loss this module exists to prevent. Comparing
 * first means A's success only ever retires A's own draft.
 */
export function clearDraftIfMatches<T>(key: string, confirmed: T): void {
  const stored = readDraft<T>(key);
  if (!stored) return;
  if (JSON.stringify(stored.value) !== JSON.stringify(confirmed)) return;
  clearDraft(key);
}

/** All draft keys currently stored, oldest first. Used for eviction and cleanup. */
export function listDraftKeys(store: Storage = storage() as Storage): string[] {
  if (!store) return [];
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

/**
 * Remove every draft belonging to one owner.
 *
 * ⚠️ DELIBERATELY NOT WIRED TO LOGOUT, and it must not be. A draft IS unsaved
 * text, so clearing on logout destroys user data — including the ordinary case of
 * logging out and back in as the SAME account. This repo already learned that the
 * hard way with persisted paused mutations, where clearing on logout silently
 * dropped unsynced offline edits and had to be reverted (see BUGS.md,
 * cross-account persisted-cache entry: the fix is to SEPARATE by owner, not to
 * erase). Another account cannot read these drafts anyway — the key is scoped by
 * uid. Keep this for an explicit, user-initiated "discard my drafts" action.
 */
export function clearDraftsForOwner(uid: string): void {
  const store = storage();
  if (!store) return;
  const owned = listDraftKeys(store).filter((key) => key.startsWith(`${PREFIX}${uid}:`));
  owned.forEach((key) => {
    try {
      store.removeItem(key);
    } catch {
      /* keep going */
    }
  });
}

/** Free room by dropping the oldest drafts, never the one being written. */
function evictOldestDrafts(store: Storage, keepKey: string): void {
  const entries = listDraftKeys(store)
    .filter((key) => key !== keepKey)
    .map((key) => ({ key, savedAt: readDraft(key)?.savedAt ?? 0 }))
    .sort((a, b) => a.savedAt - b.savedAt);

  // Half is arbitrary but bounded: enough room for a large note without wiping
  // every other unsaved draft the user may still need.
  const dropCount = Math.max(1, Math.ceil(entries.length / 2));
  entries.slice(0, dropCount).forEach(({ key }) => {
    try {
      store.removeItem(key);
    } catch {
      /* keep going */
    }
  });
}
