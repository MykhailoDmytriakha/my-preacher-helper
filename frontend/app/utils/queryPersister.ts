import { del, get, set } from 'idb-keyval';

import { debugLog } from '@/utils/debugMode';
import { answerWithin, watchedStore } from '@/utils/deviceStorage';

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

const PERSISTED_ERROR_MARKER = '__recoverableWriteError';

type ErrorField =
  | 'code'
  | 'status'
  | 'retryAfterSeconds'
  | 'isStaleWrite'
  | 'aggregate'
  | 'expectedRevision'
  | 'actualRevision'
  | 'isOfflineQueued';

const ERROR_FIELDS: readonly ErrorField[] = [
  'code',
  'status',
  'retryAfterSeconds',
  'isStaleWrite',
  'aggregate',
  'expectedRevision',
  'actualRevision',
  'isOfflineQueued',
];

type SerializedWriteError = {
  [PERSISTED_ERROR_MARKER]: true;
  name: string;
  message: string;
} & Partial<Record<ErrorField, unknown>>;

function serializeWriteError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;

  const fields = error as Error & Partial<Record<ErrorField, unknown>>;
  const serialized: SerializedWriteError = {
    [PERSISTED_ERROR_MARKER]: true,
    name: error.name,
    message: error.message,
  };
  for (const field of ERROR_FIELDS) {
    if (fields[field] !== undefined) serialized[field] = fields[field];
  }
  return serialized;
}

function isSerializedWriteError(error: unknown): error is SerializedWriteError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      (error as Partial<SerializedWriteError>)[PERSISTED_ERROR_MARKER] === true &&
      typeof (error as Partial<SerializedWriteError>).message === 'string'
  );
}

function restoreWriteError(error: SerializedWriteError): Error {
  const restored = new Error(error.message);
  restored.name = error.name;
  for (const field of ERROR_FIELDS) {
    if (error[field] !== undefined) {
      Object.assign(restored, { [field]: error[field] });
    }
  }
  return restored;
}

function serializePersistedClient(client: PersistedClient): PersistedClient {
  const mutations = client.clientState?.mutations;
  if (!mutations?.some((mutation) => mutation.state.error instanceof Error)) return client;

  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: mutations.map((mutation) =>
        mutation.state.error instanceof Error
          ? {
              ...mutation,
              state: { ...mutation.state, error: serializeWriteError(mutation.state.error) },
            }
          : mutation
      ),
    },
  } as PersistedClient;
}

function restorePersistedClient(client: PersistedClient | undefined): PersistedClient | undefined {
  const mutations = client?.clientState?.mutations;
  if (!client || !mutations?.some((mutation) => isSerializedWriteError(mutation.state.error))) {
    return client;
  }

  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: mutations.map((mutation) =>
        isSerializedWriteError(mutation.state.error)
          ? {
              ...mutation,
              state: { ...mutation.state, error: restoreWriteError(mutation.state.error) },
            }
          : mutation
      ),
    },
  } as PersistedClient;
}

/** idb-keyval's default database — where the query cache has always lived — watched like every other store. */
export const queryCacheStore = watchedStore('keyval-store', 'keyval', 'query-cache');

export function createIDBPersister(key: IDBValidKey = 'react-query-cache', { mayOverwrite = () => true, onLateRestore }: {
  /** False while something still has to read the old cache first; the write is skipped, the next one retries. */
  mayOverwrite?: () => boolean;
  /** A restore that answered after the app stopped waiting: hydrate it; writing resumes right after. */
  onLateRestore?: (client: PersistedClient) => void;
} = {}): Persister {
  /*
   * A CACHE THAT COULD NOT BE READ IS NEVER WRITTEN OVER (BUG-20260927-engine-open-hangs-on-silent-device-storage).
   * Restoring waits for device storage no longer than the silence threshold, so a silent store no
   * longer holds every query in "restoring". But the unread cache may carry paused mutations —
   * offline edits not yet sent — so nothing is written over it until the read answers; then it is
   * handed to the app to take in, and only after that does writing resume. A read that fails
   * leaves the cache exactly as it is for this session.
   */
  let unread = false;
  return {
    persistClient: async (client: PersistedClient) => {
      if (unread || !mayOverwrite()) return;
      await set(key, serializePersistedClient(client), queryCacheStore);
      debugLog('ReactQuery cache persisted', {
        key,
        queries: client?.clientState?.queries?.length ?? 0,
      });
    },
    restoreClient: async () => {
      const reading = get<PersistedClient>(key, queryCacheStore);
      const read = await answerWithin(reading);
      if (!read.answered) {
        unread = true;
        debugLog('ReactQuery cache left unread: device storage is silent', { key });
        void reading.then(value => {
          const late = restorePersistedClient(value);
          if (late) onLateRestore?.(late);
          unread = false;
          debugLog('ReactQuery cache restored late', { key, queries: late?.clientState?.queries?.length ?? 0 });
        }, () => undefined);
        return undefined;
      }
      const restored = restorePersistedClient(read.value);
      debugLog('ReactQuery cache restored', {
        key,
        queries: restored?.clientState?.queries?.length ?? 0,
      });
      return restored;
    },
    removeClient: async () => {
      if (unread || !mayOverwrite()) return;
      await del(key, queryCacheStore);
      debugLog('ReactQuery cache removed', { key });
    },
  };
}
