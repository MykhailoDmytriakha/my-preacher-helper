jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

import {
  consumeSlidingWindowRateLimit,
  type SlidingWindowRateLimitOptions,
} from '@/services/rateLimit.server';

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock; runTransaction: jest.Mock };
};

interface StoredRateLimitDocument {
  scope: string;
  keyHash: string;
  timestamps: number[];
  updatedAt: number;
}

const documents = new Map<string, StoredRateLimitDocument>();
const transactionGet = jest.fn();
const transactionSet = jest.fn();
let lastDocumentPath = '';

const WINDOW_MS = 60 * 60 * 1000;
const BASE_TIME = Date.parse('2026-07-14T12:00:00.000Z');

function options(overrides: Partial<SlidingWindowRateLimitOptions> = {}): SlidingWindowRateLimitOptions {
  return {
    scope: 'feedback',
    key: 'verified-user-1',
    limit: 3,
    windowMs: WINDOW_MS,
    now: new Date(BASE_TIME),
    ...overrides,
  };
}

describe('Firestore sliding-window rate limiter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    documents.clear();
    lastDocumentPath = '';

    adminDb.collection.mockImplementation((collection: string) => ({
      doc: (id: string) => {
        lastDocumentPath = `${collection}/${id}`;
        return { path: lastDocumentPath };
      },
    }));
    transactionGet.mockImplementation(async (ref: { path: string }) => ({
      exists: documents.has(ref.path),
      data: () => documents.get(ref.path),
    }));
    transactionSet.mockImplementation((
      ref: { path: string },
      value: StoredRateLimitDocument
    ) => {
      documents.set(ref.path, value);
    });
    adminDb.runTransaction.mockImplementation(async (callback) => callback({
      get: transactionGet,
      set: transactionSet,
    }));
  });

  it('allows a request under the limit and records it atomically', async () => {
    const result = await consumeSlidingWindowRateLimit(options());

    expect(result).toEqual({ allowed: true, remaining: 2 });
    expect(adminDb.collection).toHaveBeenCalledWith('rateLimits');
    expect(adminDb.runTransaction).toHaveBeenCalledTimes(1);
    expect(transactionGet).toHaveBeenCalledWith({ path: lastDocumentPath });
    expect(documents.get(lastDocumentPath)?.timestamps).toEqual([BASE_TIME]);
  });

  it('rejects the (N+1)th request inside the rolling window', async () => {
    const results = [];
    for (let request = 0; request < 4; request += 1) {
      results.push(await consumeSlidingWindowRateLimit(options()));
    }

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, false]);
    expect(results[3]).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: WINDOW_MS,
    });
    expect(documents.get(lastDocumentPath)?.timestamps).toHaveLength(3);
  });

  it('allows another request just after the rolling window slides', async () => {
    await consumeSlidingWindowRateLimit(options());

    const result = await consumeSlidingWindowRateLimit(options({
      now: new Date(BASE_TIME + WINDOW_MS + 1),
    }));

    expect(result).toEqual({ allowed: true, remaining: 2 });
    expect(documents.get(lastDocumentPath)?.timestamps).toEqual([
      BASE_TIME + WINDOW_MS + 1,
    ]);
  });

  it('prunes expired timestamps on the accepting write so the document stays bounded', async () => {
    await consumeSlidingWindowRateLimit(options());
    documents.set(lastDocumentPath, {
      scope: 'feedback',
      keyHash: 'existing-hash',
      timestamps: [
        ...Array.from({ length: 100 }, (_, index) => BASE_TIME - WINDOW_MS - index - 1),
        BASE_TIME - WINDOW_MS + 1,
        BASE_TIME - 1,
      ],
      updatedAt: BASE_TIME - 1,
    });

    const result = await consumeSlidingWindowRateLimit(options());

    expect(result.allowed).toBe(true);
    expect(documents.get(lastDocumentPath)?.timestamps).toEqual([
      BASE_TIME - WINDOW_MS + 1,
      BASE_TIME - 1,
      BASE_TIME,
    ]);
    expect(documents.get(lastDocumentPath)?.timestamps).toHaveLength(3);
  });

  it('does not permit a 2N burst across a fixed-window boundary', async () => {
    const endOfFixedWindow = BASE_TIME + WINDOW_MS - 1;
    for (let request = 0; request < 3; request += 1) {
      await expect(consumeSlidingWindowRateLimit(options({
        now: new Date(endOfFixedWindow),
      }))).resolves.toMatchObject({ allowed: true });
    }

    const nextFixedWindowResults = [];
    for (let request = 0; request < 3; request += 1) {
      nextFixedWindowResults.push(await consumeSlidingWindowRateLimit(options({
        now: new Date(BASE_TIME + WINDOW_MS),
      })));
    }

    expect(nextFixedWindowResults.map((result) => result.allowed)).toEqual([
      false,
      false,
      false,
    ]);
    expect(documents.get(lastDocumentPath)?.timestamps).toHaveLength(3);
  });
});
