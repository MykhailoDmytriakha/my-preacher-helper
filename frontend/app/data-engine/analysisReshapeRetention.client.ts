'use client';

import { LEASED_ANALYSIS_RESHAPE_PREFIX, readAnalysisReshapeLease } from './editorIdentity';

import type { OrdinaryEditorLeases } from './ordinaryEditorLeases.client';
import type { StorageTransaction } from './storage.client';

/** Remove completed generations only after the browser confirms their one-shot capture has ended. */
export async function collectReleasedAnalysisReshapeGenerations(transaction: StorageTransaction, owner: string,
  leases: Pick<OrdinaryEditorLeases, 'runIfFree'>): Promise<void> {
  const ownerKey = ['generation', owner];
  const prefix = LEASED_ANALYSIS_RESHAPE_PREFIX;
  const range = IDBKeyRange.bound([...ownerKey, prefix], [...ownerKey, prefix + '\uffff']);
  const keys = await transaction<IDBValidKey[]>('readonly', (store, read, done) => read(store.getAllKeys(range), done));
  const byLease = new Map<string, IDBValidKey[]>();
  for (const key of keys) {
    const editorId = Array.isArray(key) && key.length === 3 && typeof key[2] === 'string' ? key[2] : null;
    const lease = editorId && readAnalysisReshapeLease(editorId);
    if (!lease) continue;
    const group = byLease.get(lease) ?? [];
    group.push(key);
    byLease.set(lease, group);
  }
  for (const [lease, group] of byLease) {
    await leases.runIfFree(lease, () => transaction<void>('readwrite', (store, _read, done) => {
      for (const key of group) store.delete(key);
      done(undefined);
    }));
  }
}
