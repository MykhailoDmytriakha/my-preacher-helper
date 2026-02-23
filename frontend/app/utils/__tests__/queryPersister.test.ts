import type { PersistedClient } from '@tanstack/react-query-persist-client';

import { createIDBPersister } from '../queryPersister';

// Mock idb-keyval
jest.mock('idb-keyval', () => ({
    del: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
}));

// Mock debugLog to avoid window/localStorage side-effects
jest.mock('@/utils/debugMode', () => ({
    debugLog: jest.fn(),
}));

import { del, get, set } from 'idb-keyval';
import { debugLog } from '@/utils/debugMode';

const mockGet = get as jest.MockedFunction<typeof get>;
const mockSet = set as jest.MockedFunction<typeof set>;
const mockDel = del as jest.MockedFunction<typeof del>;
const mockDebugLog = debugLog as jest.MockedFunction<typeof debugLog>;

const makeClient = (queryCount = 2): PersistedClient =>
({
    clientState: {
        queries: Array.from({ length: queryCount }, (_, i) => ({ queryKey: [`key-${i}`] })),
        mutations: [],
    },
    timestamp: Date.now(),
} as unknown as PersistedClient);

describe('createIDBPersister', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('with default key', () => {
        it('creates a persister object with persistClient, restoreClient, and removeClient methods', () => {
            const persister = createIDBPersister();
            expect(typeof persister.persistClient).toBe('function');
            expect(typeof persister.restoreClient).toBe('function');
            expect(typeof persister.removeClient).toBe('function');
        });
    });

    describe('persistClient', () => {
        it('calls set with the default key and the provided client', async () => {
            mockSet.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister();
            const client = makeClient(3);

            await persister.persistClient(client);

            expect(mockSet).toHaveBeenCalledWith('react-query-cache', client);
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache persisted',
                { key: 'react-query-cache', queries: 3 }
            );
        });

        it('calls set with a custom key', async () => {
            mockSet.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister('custom-key');
            const client = makeClient(1);

            await persister.persistClient(client);

            expect(mockSet).toHaveBeenCalledWith('custom-key', client);
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache persisted',
                { key: 'custom-key', queries: 1 }
            );
        });

        it('logs queries as 0 when clientState or queries is missing', async () => {
            mockSet.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister();

            // Client with no queries array
            const emptyClient = {} as PersistedClient;
            await persister.persistClient(emptyClient);

            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache persisted',
                { key: 'react-query-cache', queries: 0 }
            );
        });
    });

    describe('restoreClient', () => {
        it('returns the cached client from IDB and logs', async () => {
            const stored = makeClient(5);
            mockGet.mockResolvedValueOnce(stored);
            const persister = createIDBPersister();

            const result = await persister.restoreClient();

            expect(mockGet).toHaveBeenCalledWith('react-query-cache');
            expect(result).toBe(stored);
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache restored',
                { key: 'react-query-cache', queries: 5 }
            );
        });

        it('returns undefined when nothing is stored and logs 0 queries', async () => {
            mockGet.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister();

            const result = await persister.restoreClient();

            expect(result).toBeUndefined();
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache restored',
                { key: 'react-query-cache', queries: 0 }
            );
        });

        it('uses a custom key', async () => {
            mockGet.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister('my-key');

            await persister.restoreClient();

            expect(mockGet).toHaveBeenCalledWith('my-key');
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache restored',
                { key: 'my-key', queries: 0 }
            );
        });
    });

    describe('removeClient', () => {
        it('calls del with the default key and logs', async () => {
            mockDel.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister();

            await persister.removeClient();

            expect(mockDel).toHaveBeenCalledWith('react-query-cache');
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache removed',
                { key: 'react-query-cache' }
            );
        });

        it('calls del with a custom key and logs', async () => {
            mockDel.mockResolvedValueOnce(undefined);
            const persister = createIDBPersister('custom-remove-key');

            await persister.removeClient();

            expect(mockDel).toHaveBeenCalledWith('custom-remove-key');
            expect(mockDebugLog).toHaveBeenCalledWith(
                'ReactQuery cache removed',
                { key: 'custom-remove-key' }
            );
        });
    });
});
