'use client';

import { newClientId } from '@/utils/clientId';

import { equalValues } from './protocol';

import type { RecoveryOrigin, VersionedRecovery } from './recoverySource';
import type { StorageRead, StorageTransaction } from './storage.client';

/** Every durable write rotates its storage identity, including ACK and baseline projections. */
export const versionRecoveryRecord = <T extends VersionedRecovery>(record: T): T => ({ ...record, recoveryVersion: newClientId() });

/** Pin a legacy row only if the complete validated record still equals the read used for recovery. */
export function pinRecoveryVersion<T extends VersionedRecovery>(transaction: StorageTransaction, key: IDBValidKey,
  expected: T, validate: (value: unknown) => T): Promise<string | null> {
  const frozen = validate(expected);
  return transaction('readwrite', (store, read, done) => {
    read(store.get(key), (value: T | undefined) => {
      if (!value) { done(null); return; }
      let current: T;
      try { current = validate(value); } catch { done(null); return; }
      if (!equalValues(current, frozen)) { done(null); return; }
      const version = current.recoveryVersion ?? newClientId();
      if (!current.recoveryVersion) store.put({ ...value, recoveryVersion: version }, key);
      done(version);
    });
  });
}

interface RecoverySourceSelection {
  key: IDBValidKey;
  owns(value: unknown): boolean;
}

/** Run before the existing reference collector in the target's native transaction. */
export function retireRecoveryVersions(store: IDBObjectStore, read: StorageRead, sources: readonly RecoveryOrigin[],
  select: (id: string) => RecoverySourceSelection | null, done: () => void): void {
  const next = (index: number): void => {
    if (index === sources.length) { done(); return; }
    const source = sources[index], selection = select(source.id);
    if (!selection) { next(index + 1); return; }
    read(store.get(selection.key), (value: VersionedRecovery | undefined) => {
      // Corrupt, changed or unknown sources stay available; cleanup cannot reject a valid target decision.
      let owned = false;
      try { owned = value?.recoveryVersion === source.version && selection.owns(value); } catch { /* Preserve unknown data. */ }
      if (owned) store.delete(selection.key);
      next(index + 1);
    });
  };
  next(0);
}
