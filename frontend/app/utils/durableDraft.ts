import { serializeContent } from '@/utils/contentFingerprint';

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

/** A single stored draft. `savedAt` orders drafts newest first when a screen looks for them. */
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
 * WHETHER THIS DEVICE CAN KEEP DRAFTS AT ALL (BUG-20260815-durable-draft-fails-silently-when-storage-refuses).
 *
 * A refused save used to be silent, so every screen went on believing its safety net held. Which
 * drafts are owed a copy the browser refused is kept here, once for the whole app: the app-wide
 * DraftStorageNotice shows while any is owed, and a key leaves only when its own copy lands, the
 * draft is retired, or the very text that was refused is confirmed by the server — a small draft
 * that saves never hides another that did not, and a saved one never keeps the notice up.
 */
const refusedDraftKeys = new Map<string, string>();
const draftStorageListeners = new Set<() => void>();

function recordDraftStorage(key: string, refused: false): void;
function recordDraftStorage(key: string, refused: true, value: unknown): void;
function recordDraftStorage(key: string, refused: boolean, value?: unknown): void {
  const before = refusedDraftKeys.size > 0;
  if (refused) refusedDraftKeys.set(key, serializeContent(value)); else refusedDraftKeys.delete(key);
  if (before === refusedDraftKeys.size > 0) return;
  draftStorageListeners.forEach(listener => { try { listener(); } catch { /* a listener never breaks typing */ } });
}

export function isDraftStorageRefused(): boolean {
  return refusedDraftKeys.size > 0;
}

export function subscribeDraftStorage(listener: () => void): () => void {
  draftStorageListeners.add(listener);
  return () => { draftStorageListeners.delete(listener); };
}

/**
 * Persist a draft and say whether it landed. Never throws: losing the safety net must not break
 * typing — but it must not go unnoticed either.
 *
 * OUT OF ROOM, NOTHING ELSE IS REMOVED (BUG-20260928-draft-eviction-drops-unseen-drafts). The
 * draft being written duplicates text still on an open screen; another stored draft may be the
 * only copy of text from an earlier session that nobody has seen since. Making room by deleting
 * it traded an original for a backup, silently. So a refused copy is reported instead: the
 * app-wide DraftStorageNotice tells the person before any text can be lost.
 */
export function saveDraft<T>(key: string, value: T): boolean {
  const store = storage();
  if (!store) {
    recordDraftStorage(key, true, value);
    return false;
  }

  const payload = JSON.stringify({ value, savedAt: Date.now() } satisfies DurableDraft<T>);

  try {
    store.setItem(key, payload);
  } catch {
    console.error('durableDraft: no room to persist', key);
    recordDraftStorage(key, true, value);
    return false;
  }
  recordDraftStorage(key, false);
  return true;
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

/** Remove the stored copy only; what the key is owed is decided by the caller. */
function removeStoredDraft(key: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(key);
  } catch {
    /* nothing to do */
  }
}

/** Drop a draft unconditionally (the user discarded it). Never throws. */
export function clearDraft(key: string): void {
  // A retired draft is no longer owed a copy.
  recordDraftStorage(key, false);
  removeStoredDraft(key);
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
  // The text whose copy was refused is on the server now: that copy is no longer owed.
  if (refusedDraftKeys.get(key) === serializeContent(confirmed)) recordDraftStorage(key, false);
  const stored = readDraft<T>(key);
  if (!stored) return;
  if (serializeContent(stored.value) !== serializeContent(confirmed)) return;
  // Only the confirmed copy goes. A newer text whose copy was refused is still owed one, and its
  // warning stays up until that very text is confirmed or discarded.
  removeStoredDraft(key);
}

/**
 * Carry a draft to a new address, leaving no window with no durable copy.
 *
 * WHY. A new note is written under the placeholder id "new", and the moment the
 * create returns a real id the placeholder record is retired. But the create
 * resolves OPTIMISTICALLY — it hands back a client-generated id without waiting
 * for the server (`useStudyNotes.ts` createNote) — so between "placeholder
 * cleared" and "the editor's next keystroke writes under the real id", the text
 * exists only in React state. A tab closed in that window, with the write later
 * refused, loses it: exactly the failure this module exists to prevent, moved one
 * step later.
 *
 * Copy FIRST, delete after, and never delete when there is nothing to carry — an
 * unconditional clear here would destroy a draft the destination already owns.
 */
export function moveDraft(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  // What the document is owed moves with it whether or not its stored copy can: the refused text
  // will be stored or confirmed under the new key, and only there can it settle the debt.
  carryRefusal(fromKey, toKey);
  const stored = readDraft<unknown>(fromKey);
  if (!stored) return;
  // Copied as it is, without settling anything: an older stored text landing under the new key
  // proves nothing about a newer text the browser refused there.
  if (!writeStoredDraft(toKey, stored)) return;
  // VERIFY THE COPY LANDED before the source goes: clearing it on faith would leave the text
  // with no durable copy at all, which is worse than not moving it.
  const carried = readDraft<unknown>(toKey);
  if (!carried || serializeContent(carried.value) !== serializeContent(stored.value)) return;
  removeStoredDraft(fromKey);
  // The carried text itself is now kept under the new key: a debt for exactly that text is settled.
  if (refusedDraftKeys.get(toKey) === serializeContent(stored.value)) recordDraftStorage(toKey, false);
}

/** Write a stored record unchanged; says whether the browser kept it. Debts are not touched. */
function writeStoredDraft(key: string, stored: DurableDraft<unknown>): boolean {
  const store = storage();
  if (!store) return false;
  try {
    store.setItem(key, JSON.stringify(stored));
    return true;
  } catch {
    console.error('durableDraft: no room to carry', key);
    return false;
  }
}

/**
 * Move what a key is owed to the key its document now lives under. When the destination already
 * owes a text of its own, the two cannot share one key and neither may be dropped: the placeholder's
 * debt stays where it is, so the notice stays up — a warning too many is safe, one too few loses
 * text. (A created note always gets a fresh id today, so its destination owes nothing yet.)
 */
function carryRefusal(fromKey: string, toKey: string): void {
  const owed = refusedDraftKeys.get(fromKey);
  if (owed === undefined || refusedDraftKeys.has(toKey)) return;
  // One key's debt becomes another's: the notice does not change and nobody needs telling.
  refusedDraftKeys.delete(fromKey);
  refusedDraftKeys.set(toKey, owed);
}

/**
 * Which documents currently hold a stored record for `aggregate`, newest first.
 *
 * Needed because a screen can own MANY documents — the settings page lists every
 * plan template — so it cannot know on mount which one a refused edit belongs to.
 * Without discovery the choice was either one shared slot (two refusals overwrite
 * each other) or a key nobody can find again after a reload.
 */
export function findDraftDocIds(uid: string, aggregate: string): string[] {
  const store = storage();
  if (!store) return [];
  const prefix = `${PREFIX}${uid}:`;
  const suffix = `:${aggregate}`;
  return listDraftKeys(store)
    .filter((key) => key.startsWith(prefix) && key.endsWith(suffix))
    .map((key) => ({ docId: key.slice(prefix.length, key.length - suffix.length), key }))
    .sort((a, b) => (readDraft(b.key)?.savedAt ?? 0) - (readDraft(a.key)?.savedAt ?? 0))
    .map((entry) => entry.docId);
}

/** All draft keys currently stored. Used for discovery and cleanup. */
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
