'use client';

import { createStore, del, entries, update } from 'idb-keyval';

import { commandFingerprint } from './protocol';

import type { JournalEntry, JournalStore } from './types';

/** Resolves only after the IndexedDB transaction commits, never at request success. */
export function createIndexedDbJournal(): JournalStore {
  let store: ReturnType<typeof createStore> | undefined;
  const database = () => (store ??= createStore('preacher-data-engine-v1', 'commands'));
  const key = (owner: string, operationId: string) => JSON.stringify([owner, operationId]);
  return {
    async put(entry) {
      const frozen = JSON.parse(JSON.stringify(entry)) as JournalEntry;
      await update<JournalEntry>(key(entry.command.owner, entry.command.operationId), (current) => {
        if (current && commandFingerprint(current.command) !== commandFingerprint(frozen.command)) {
          throw new Error('Operation identity cannot be reused for another command');
        }
        // Another tab may have committed a receipt while this executor was waiting.
        if (current && ['acknowledged', 'conflict', 'refused'].includes(current.state)) return current;
        return frozen;
      }, database());
    },
    async remove(owner, operationId) {
      await del(key(owner, operationId), database());
    },
    async list(owner) {
      const records = await entries<string, JournalEntry>(database());
      return records.filter(([storedKey, entry]) => (
        entry.command.owner === owner && storedKey === key(owner, entry.command.operationId)
      )).map(([, entry]) => entry).sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}
