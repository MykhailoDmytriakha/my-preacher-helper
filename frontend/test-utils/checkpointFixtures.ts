import { checkpointKey } from '@/data-engine/checkpointStorage.client';
import { commitRowKey } from '@/data-engine/retention.client';
import { DataSession } from '@/data-engine/session';

import type { CommitRequest } from '@/data-engine/commits';
import type { EditorRecord } from '@/data-engine/controller';
import type { installStorageHarness } from '@/data-engine/__tests__/storageHarness';

export const snapshot = { resource: { collection: 'studyNotes', id: 'note' },
  value: { userId: 'owner', content: 'base' }, metadata: null };
export const request = (id = 'saved', editorId = 'editor', editGeneration = 1): CommitRequest => ({
  id, owner: 'owner', editorId, editGeneration, baseline: snapshot, value: { ...snapshot.value, content: id },
  predecessor: null, revision: 0, initialized: true, working: snapshot, intended: { ...snapshot.value, content: id },
  command: null, submitted: null, sequence: 0, state: 'queued', result: null, unfinalized: [],
});
export const acknowledge = (saved: CommitRequest): CommitRequest => ({ ...saved, state: 'acknowledged',
  result: { kind: 'acknowledged', operationId: saved.id, snapshot: { ...snapshot, value: saved.value } } });
export function record(content = 'letter', editorId = 'editor', pending: CommitRequest[] = []): EditorRecord {
  const session = new DataSession(snapshot);
  session.edit({ ...snapshot.value, content });
  for (const saved of pending) session.registerCommit(saved.id, saved.editGeneration, saved.value);
  // A letter after Save must remain dirty independently of the submitted words.
  if (pending.length) session.edit({ ...snapshot.value, content });
  return { owner: 'owner', editorId, checkpoint: session.checkpoint(), prepared: null, unfinalized: [] };
}
export function seedRequest(storage: ReturnType<typeof installStorageHarness>, saved: CommitRequest): void {
  storage.rows.set(JSON.stringify(commitRowKey(saved)), saved);
  storage.rows.set(JSON.stringify(['identity', saved.owner, saved.id]), commitRowKey(saved));
}
export function seedHistory(storage: ReturnType<typeof installStorageHarness>, size: number): void {
  for (let index = 0; index < size; index += 1) {
    const saved = { ...request(`history-${index}`, `history-editor-${index}`), state: 'refused' as const };
    seedRequest(storage, saved);
    storage.rows.set(JSON.stringify(checkpointKey('owner', saved.editorId)), record(saved.id, saved.editorId, [saved]));
  }
}
