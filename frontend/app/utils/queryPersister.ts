import { del, get, set } from 'idb-keyval';

import { debugLog } from '@/utils/debugMode';

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

export function createIDBPersister(key: IDBValidKey = 'react-query-cache'): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(key, client);
      debugLog('ReactQuery cache persisted', {
        key,
        queries: client?.clientState?.queries?.length ?? 0,
      });
    },
    restoreClient: async () => {
      const restored = await get<PersistedClient>(key);
      debugLog('ReactQuery cache restored', {
        key,
        queries: restored?.clientState?.queries?.length ?? 0,
      });
      return restored;
    },
    removeClient: async () => {
      await del(key);
      debugLog('ReactQuery cache removed', { key });
    },
  };
}
