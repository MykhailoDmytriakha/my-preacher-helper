'use client';

import { serializeContent } from '@/utils/contentFingerprint';
import { draftBelongsToOwner, readDraftAddress } from '@/utils/draftAddress';
import {
  draftKey, readDraft, retireDraftCapture, saveDraft, readDraftsStrict,
  type DurableDraft,
} from '@/utils/durableDraft';

export const DRAFT_CAPTURE_PREFIX = 'draft-capture:v1:';
interface DraftCaptureScope {
  token: string;
  sourceKey: string;
  resource: { collection: string; id: string };
}

export interface CapturedDraftWrite {
  requestId: string;
  scope: string;
  owner: string;
  resource: { collection: string; id: string };
  value: unknown;
}

/** Only public canonical capabilities: this module owns no request rows or transport. */
export interface DraftCapturePort {
  listWriteCaptures(prefix: string): Promise<CapturedDraftWrite[]>;
  releaseWriteCapture(scope: string, requestId: string): Promise<void>;
  subscribeSavedWork(listener: () => void): () => void;
}

/** Read-only preparation: the ordinary draft write already minted the payload identity. */
export function prepareDraftCapture<T>(key: string, value: T, resource: DraftCaptureScope['resource']): string | undefined {
  const current = readDraft<T>(key);
  if (!current || typeof current.captureToken !== 'string' || !current.captureToken
    || serializeContent(current.value) !== serializeContent(value)) return undefined;
  return DRAFT_CAPTURE_PREFIX + encodeURIComponent(JSON.stringify({ token: current.captureToken, sourceKey: key, resource } satisfies DraftCaptureScope));
}

function readScope(scope: string): DraftCaptureScope | null {
  if (!scope.startsWith(DRAFT_CAPTURE_PREFIX)) return null;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(scope.slice(DRAFT_CAPTURE_PREFIX.length)));
    if (!value || typeof value !== 'object') return null;
    const parsed = value as Partial<DraftCaptureScope>;
    return typeof parsed.token === 'string' && Boolean(parsed.token) && typeof parsed.sourceKey === 'string'
      && parsed.resource && typeof parsed.resource.collection === 'string' && typeof parsed.resource.id === 'string'
      ? parsed as DraftCaptureScope : null;
  } catch { return null; }
}

/** Immediate autosave can beat the typing debounce; bind the exact submitted words. */
export function prepareNoteDraftCapture(owner: string | null | undefined, noteId: string, value: unknown, writerId?: string, editedAt?: number): string | undefined {
  if (!owner) return undefined;
  const key = draftKey(owner, noteId, 'note', writerId);
  if (!saveDraft(key, value, undefined, true, editedAt)) return undefined;
  return prepareDraftCapture(key, value, { collection: 'studyNotes', id: noteId });
}

function sameResource(left: DraftCaptureScope['resource'], right: DraftCaptureScope['resource']): boolean {
  return left.collection === right.collection && left.id === right.id;
}

function ownsAddress(owner: string, key: string, draft: DurableDraft<unknown>, resource: DraftCaptureScope['resource']): boolean {
  // The one production adapter is the note aggregate. No arbitrary aggregate or
  // different creation may be retired by a matching-looking local scope.
  const address = readDraftAddress(key);
  if (resource.collection !== 'studyNotes' || !address || address.owner !== owner || address.aggregate !== 'note') return false;
  if (address.documentId === resource.id) return true;
  return draft.creationTargetId === resource.id
    && (address.documentId === 'new' || address.documentId === `new~${resource.id}`);
}

/** One pass can be replayed after either side of the localStorage/IndexedDB boundary. */
export async function reconcileCapturedDrafts(owner: string, port: DraftCapturePort, active: () => boolean = () => true): Promise<void> {
  const captures = await port.listWriteCaptures(DRAFT_CAPTURE_PREFIX);
  if (!active()) return;
  for (const captured of captures) {
    if (!active()) return;
    const binding = readScope(captured.scope);
    if (captured.owner !== owner || !binding || !captured.value || !sameResource(binding.resource, captured.resource)
      || !ownsAddress(owner, binding.sourceKey, { value: null, savedAt: 0, creationTargetId: captured.resource.id }, captured.resource)) continue;
    // A note capture can stay at its original address or move once to its
    // adopted note ID. Unrelated drafts cannot block retirement of this hold.
    const writerId = readDraftAddress(binding.sourceKey)?.writerId;
    const keys = [binding.sourceKey, draftKey(owner, captured.resource.id, 'note', writerId)];
    const drafts = readDraftsStrict(keys);
    if (!drafts) continue;
    const matching = [...drafts].filter(([, draft]) => draft.captureToken === binding.token);
    let safe = true;
    for (const [key, draft] of matching) {
      if (!ownsAddress(owner, key, draft, captured.resource)
        || !retireDraftCapture(key, binding.token, draft.value)) safe = false;
    }
    if (!safe || !active()) continue;
    // Removal may have failed, a new binding may have appeared, or storage may
    // have stopped answering. None is evidence that the hold is orphaned.
    const remaining = readDraftsStrict(keys);
    if (!remaining || [...remaining.values()].some(draft => draft.captureToken === binding.token)) continue;
    await port.releaseWriteCapture(captured.scope, captured.requestId);
  }
}

/** Workspace lifetime, independent of the note route and its transient callbacks. */
export function connectDraftCaptureRecovery(owner: string, port: DraftCapturePort): () => void {
  let active = true, running = false, again = false;
  const reconcile = () => {
    if (!active) return;
    again = true;
    if (running) return;
    running = true;
    void (async () => {
      try {
        while (active && again) {
          again = false;
          await reconcileCapturedDrafts(owner, port, () => active);
        }
      } catch {
        // Both original stores remain the recovery evidence. A later saved-work,
        // storage or foreground event retries; a read failure never retires text.
      } finally { running = false; }
    })();
  };
  const stop = port.subscribeSavedWork(reconcile);
  const storageChanged = (event: StorageEvent) => {
    if (!event.key || draftBelongsToOwner(event.key, owner)) reconcile();
  };
  const visible = () => { if (document.visibilityState === 'visible') reconcile(); };
  window.addEventListener('storage', storageChanged);
  window.addEventListener('focus', reconcile);
  document.addEventListener('visibilitychange', visible);
  reconcile();
  return () => {
    active = false;
    stop();
    window.removeEventListener('storage', storageChanged);
    window.removeEventListener('focus', reconcile);
    document.removeEventListener('visibilitychange', visible);
  };
}
