import { createStore, entries, get } from 'idb-keyval';


import { newClientId } from '@/utils/clientId';
import { recordingMatchesDestination } from '@/utils/recordingDraftScope';
import { updateStoredValue } from '@/utils/storageUpdate';

/** One durable raw-source store; entries are bound to the account and original destination. */
export type RecordingDraftContext = 'study' | 'thought' | 'sermon' | 'prayer' | 'outline' | 'scratch';

export interface RecordingDraft {
  id: string;
  /** Older entries have no owner; retain them without assigning them to a later sign-in. */
  ownerId?: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
  context: RecordingDraftContext;
  contextId?: string;
  sizeBytes: number;
  transcript?: string;
  destination?: { sectionId: string; pointId?: string; subPointId?: string };
}

interface DiscardedRecording {
  id: string;
  ownerId: string;
  context?: RecordingDraftContext;
  contextId?: string;
  discarded: true;
}
type StoredRecording = RecordingDraft | DiscardedRecording;


const listeners = new Set<() => void>();
let channel: BroadcastChannel | null = null;
const notify = () => { listeners.forEach(listener => listener()); };
const openChannel = (): BroadcastChannel | null => {
  if (typeof window === 'undefined' || typeof window.BroadcastChannel !== 'function') return null;
  try {
    const opened = new window.BroadcastChannel('recording-drafts-changed');
    opened.onmessage = () => notify();
    return opened;
  } catch {
    // Notifications are optional; a device refusing a channel still has durable source storage.
    return null;
  }
};
const publish = () => {
  notify();
  const outgoing = channel ?? openChannel();
  try { outgoing?.postMessage('changed'); }
  catch { /* A channel refusal must not turn an accepted storage write into a failed save. */ }
  finally { if (outgoing !== channel) outgoing?.close(); }
};
export function subscribeRecordingDrafts(listener: () => void): () => void {
  listeners.add(listener);
  if (!channel) channel = openChannel();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { channel?.close(); channel = null; }
  };
}

let store: ReturnType<typeof createStore> | null = null;
const getStore = () => {
  if (typeof indexedDB === 'undefined') return null;
  if (!store) store = createStore('recording-drafts', 'recording-drafts');
  return store;
};
const requireStore = () => {
  const current = getStore();
  if (!current) throw new Error('Recording storage is unavailable');
  return current;
};
const hasOwner = (ownerId: string | undefined): ownerId is string =>
  typeof ownerId === 'string' && ownerId.trim().length > 0;
const isDraft = (value: StoredRecording | undefined): value is RecordingDraft =>
  Boolean(value && 'blob' in value && value.blob && typeof value.blob.size === 'number');
const sameDestination = (left: Pick<RecordingDraft, 'ownerId' | 'context' | 'contextId'>,
  right: Pick<RecordingDraft, 'ownerId' | 'context' | 'contextId'>) =>
  left.ownerId === right.ownerId && left.context === right.context && left.contextId === right.contextId;

export async function saveRecordingDraft(
  input: Omit<RecordingDraft, 'id' | 'createdAt' | 'sizeBytes' | 'ownerId'> & { id?: string; ownerId: string }
): Promise<string> {
  if (!hasOwner(input.ownerId) || !input.contextId?.trim()) throw new Error('Recording owner and destination are required');
  if (!input.blob || input.blob.size === 0) throw new Error('Recording source is empty');
  const current = requireStore();
  const id = input.id ?? newClientId();
  if (!id.trim()) throw new Error('Recording identity is required');
  await updateStoredValue<StoredRecording>(id, existing => {
    if (existing) {
      if (!isDraft(existing) || !sameDestination(existing, input)) throw new Error('Recording identity cannot be reused');
      // Re-parking is idempotent: a late retry must not replace the source or its action time.
      return existing;
    }
    return {
      id, ownerId: input.ownerId, blob: input.blob, mimeType: input.mimeType,
      context: input.context, contextId: input.contextId,
      createdAt: Date.now(), sizeBytes: input.blob.size,
      ...(input.destination ? { destination: input.destination } : {}),
    };
  }, current);
  publish();
  return id;
}


/** Cache recognized words with their source; recovery must not pay the provider twice. */
export async function saveRecordingDraftText(id: string, ownerId: string, transcript: string): Promise<boolean> {
  if (!hasOwner(ownerId)) throw new Error('Recording owner is required');
  let accepted = false;
  await updateStoredValue<StoredRecording | undefined>(id, existing => {
    if (!existing || existing.ownerId !== ownerId) throw new Error('Recording source is not available');
    if (!isDraft(existing)) return existing;
    accepted = true;
    return { ...existing, transcript };
  }, requireStore());
  publish();
  return accepted;
}

export async function moveRecordingDraft(id: string, ownerId: string,
  from: { context: RecordingDraftContext; contextId: string }, contextId: string): Promise<void> {
  if (!hasOwner(ownerId) || !contextId.trim()) throw new Error('Recording owner and destination are required');
  await updateStoredValue<StoredRecording | undefined>(id, current => {
    if (!current || !isDraft(current)) return current;
    if (current.ownerId !== ownerId || current.context !== from.context || current.contextId !== from.contextId) {
      throw new Error('Recording destination changed');
    }
    return { ...current, contextId };
  }, requireStore());
  publish();
}

/** Upgrade only sources whose original loaded document proves the authenticated owner. */
export async function adoptLegacyRecordingDrafts(proof: {
  ownerId: string; sourceOwnerId: string; context: RecordingDraftContext; contextId: string;
}): Promise<number> {
  if (!hasOwner(proof.ownerId) || proof.ownerId !== proof.sourceOwnerId || !proof.contextId
    || !['sermon', 'study'].includes(proof.context)) return 0;
  const current = getStore();
  if (!current) return 0;
  const rows = await entries<string, StoredRecording>(current);
  let adopted = 0;
  for (const [id, value] of rows) {
    if (!isDraft(value) || value.ownerId !== undefined || value.context !== proof.context || value.contextId !== proof.contextId) continue;
    await updateStoredValue<StoredRecording | undefined>(id, latest => {
      if (!isDraft(latest) || latest.ownerId !== undefined || latest.context !== proof.context || latest.contextId !== proof.contextId) return latest;
      adopted += 1;
      return { ...latest, ownerId: proof.ownerId };
    }, current);
  }
  if (adopted) publish();
  return adopted;
}

export async function listRecordingDrafts(filter?: {
  ownerId?: string;
  context?: RecordingDraftContext;
  contextId?: string;
  linkedSourceIds?: readonly string[];
}): Promise<RecordingDraft[]> {
  if (!hasOwner(filter?.ownerId)) return [];
  const current = getStore();
  if (!current) return [];
  const all = await entries<string, StoredRecording>(current);
  return all.map(([, value]) => value).filter(isDraft)
    .filter(draft => draft.ownerId === filter.ownerId
      && recordingMatchesDestination(draft, filter.context, filter.contextId, filter.linkedSourceIds))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRecordingDraft(id: string, ownerId: string): Promise<RecordingDraft | undefined> {
  if (!hasOwner(ownerId)) return undefined;
  const current = getStore();
  if (!current) return undefined;
  const value = await get<StoredRecording>(id, current);
  return isDraft(value) && value.ownerId === ownerId ? value : undefined;
}

export async function deleteRecordingDraft(id: string, ownerId: string): Promise<void> {
  if (!hasOwner(ownerId)) throw new Error('Recording owner is required');
  await updateStoredValue<StoredRecording | undefined>(id, existing => {
    if (!existing) return { id, ownerId, discarded: true };
    if (existing.ownerId !== ownerId) throw new Error('Recording belongs to another account');
    if (!isDraft(existing)) return existing;
    // Keep identity only, never audio: an old asynchronous failure cannot resurrect a discarded take.
    return { id, ownerId, context: existing.context, contextId: existing.contextId ?? '', discarded: true };
  }, requireStore());
  publish();
}
