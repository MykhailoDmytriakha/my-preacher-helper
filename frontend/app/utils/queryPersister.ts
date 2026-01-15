import { del, get, set } from 'idb-keyval';

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

export function createIDBPersister(key: IDBValidKey = 'react-query-cache'): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(key, client);
    },
    restoreClient: async () => {
      return get<PersistedClient>(key);
    },
    removeClient: async () => {
      await del(key);
    },
  };
}
