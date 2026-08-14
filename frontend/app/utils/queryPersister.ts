import { del, get, set } from 'idb-keyval';

import { debugLog } from '@/utils/debugMode';

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

export function createIDBPersister(key: IDBValidKey = 'react-query-cache'): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set(key, serializePersistedClient(client));
      debugLog('ReactQuery cache persisted', {
        key,
        queries: client?.clientState?.queries?.length ?? 0,
      });
    },
    restoreClient: async () => {
      const restored = restorePersistedClient(await get<PersistedClient>(key));
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
