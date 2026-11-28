'use client';

import { checkpointKey } from './checkpointStorage.client';
import { isRetirableOrdinaryEditor } from './editorIdentity';
import { readOrdinaryEditorLease, type OrdinaryEditorLeases } from './ordinaryEditorLeases.client';
import { activeOrdinaryEditorKey, COMMIT_ROW_KINDS, commitGenerationKey, retireCleanManualScopes } from './retention.client';
import { createEngineStorageTransaction, engineOwnerRange } from './storage.client';

interface Candidate {
  editorId: string;
  lease: string;
}

/** On opening the app, remove only clean admissions whose original writer has died. */
export async function collectAbandonedOrdinaryEditors(owner: string, leases: Pick<OrdinaryEditorLeases, 'runIfFree'>): Promise<void> {
  const transaction = createEngineStorageTransaction();
  const candidates = await transaction<Candidate[]>('readonly', (store, read, done) => {
    const range = engineOwnerRange('ordinary-editor', owner);
    read(store.getAllKeys(range), keys => read(store.getAll(range), values => {
      done(keys.flatMap((key, index) => {
        const editorId: unknown = Array.isArray(key) ? key[2] : undefined;
        const lease = readOrdinaryEditorLease(values[index]);
        return lease && typeof editorId === 'string' && isRetirableOrdinaryEditor(editorId) ? [{ editorId, lease }] : [];
      }));
    }));
  });
  for (const { editorId, lease } of candidates) {
    await leases.runIfFree(lease, () => transaction<void>('readwrite', (store, read, done) => {
      const key = activeOrdinaryEditorKey(owner, editorId);
      read(store.get(key), admission => {
        if (readOrdinaryEditorLease(admission) !== lease) { done(undefined); return; }
        // An unfinished checkpoint can resume at its original identity. A retained
        // request may still have other references even after its editor died.
        read(store.get(checkpointKey(owner, editorId)), checkpoint => {
          if (checkpoint !== undefined) { done(undefined); return; }
          let remaining = COMMIT_ROW_KINDS.length;
          let retained = false;
          for (const kind of COMMIT_ROW_KINDS) read(store.getAllKeys(engineOwnerRange(kind, owner, editorId), 1), requests => {
            if (requests.length) retained = true;
            if (--remaining) return;
            if (!retained) {
              store.delete(key);
              store.delete(commitGenerationKey({ owner, editorId }));
              retireCleanManualScopes(store, read, owner, editorId, () => done(undefined));
            } else done(undefined);
          });
        });
      });
    }));
  }
}
