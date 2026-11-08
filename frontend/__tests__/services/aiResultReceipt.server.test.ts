/** @jest-environment node */

jest.mock('server-only', () => ({}), { virtual: true });

import { AiResultReceiptConflict, AiResultUnavailableError } from '@/api/errors/aiResultRecovery.server';
import { aiResultReceipt } from '@/data-engine/aiOperations.server';
import { recoverableAiResult } from '@/services/recoverableAiResult.server';
import { getUserEntitlementServerSide } from '@/services/userEntitlement.server';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn(), runTransaction: jest.fn() },
}));

const { adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminDb: { collection: jest.Mock; runTransaction: jest.Mock };
};

type Data = Record<string, unknown>;
type Reference = { path: string };
type Query = { prefix: string; field: string; value: unknown; count: number };
type Stored = { data: Data; writeTime: number };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function storeFixture() {
  const documents = new Map<string, Stored>();
  let writeTime = 0;
  const write = (path: string, data: Data) => {
    const version = ++writeTime;
    documents.set(path, { data, writeTime: version });
    return { writeTime: version };
  };
  const read = (path: string) => ({ exists: documents.has(path), data: () => documents.get(path)?.data });
  const doc = (path: string) => ({
    path,
    collection: (name: string) => ({
      doc: (id: string) => doc(path + '/' + name + '/' + id),
      where: (field: string, _operator: string, value: unknown) => ({
        limit: (count: number): Query => ({ prefix: path + '/' + name + '/', field, value, count }),
      }),
    }),
    get: async () => read(path),
    async create(data: Data) {
      if (documents.has(path)) throw Object.assign(new Error('Already exists'), { code: 6 });
      return write(path, data);
    },
    async update(data: Data, precondition: { lastUpdateTime: number }) {
      const previous = documents.get(path);
      if (previous?.writeTime !== precondition.lastUpdateTime) {
        throw Object.assign(new Error('Precondition failed'), { code: 9 });
      }
      return write(path, { ...previous.data, ...data });
    },
  });
  adminDb.collection.mockImplementation((name: string) => ({ doc: (id: string) => doc(name + '/' + id) }));
  async function transaction<T>(run: (access: {
    get: (ref: Reference | Query) => Promise<ReturnType<typeof read> | { docs: Array<ReturnType<typeof read> & { ref: Reference; id: string }>; size: number }>;
    set: (ref: Reference, data: Data) => void;
    update: (ref: Reference, data: Data) => void;
  }) => Promise<T>) {
    const changes: Array<() => void> = [];
    const merge = (ref: Reference, data: Data) => {
      changes.push(() => write(ref.path, { ...documents.get(ref.path)?.data, ...data }));
    };
    const result = await run({ get: async ref => {
      if ('path' in ref) return read(ref.path);
      const docs = [...documents.entries()]
        .filter(([path, stored]) => path.startsWith(ref.prefix) && stored.data[ref.field] === ref.value)
        .slice(0, ref.count)
        .map(([path]) => ({ ref: { path }, id: path.split('/').at(-1)!, ...read(path) }));
      return { docs, size: docs.length };
    }, set: merge, update: merge });
    changes.forEach(commit => commit());
    return result;
  }
  adminDb.runTransaction.mockImplementation(transaction);
  return { read, write, transaction };
}

describe('AI result receipt', () => {
  const ownerId = 'owner';
  const operationId = 'test-operation-1';
  const fingerprint = 'original-source';
  const accountPath = 'users/owner';
  const receiptPath = 'users/owner/aiResultReceipts/test-operation-1';
  const oldUsage = { periodStart: '2026-11-01T00:00:00.000Z', aiUsed: 5, audioSecondsUsed: 9 };
  let store: ReturnType<typeof storeFixture>;
  let time: Date;
  const open = (overrides: Partial<{ ownerId: string; fingerprint: string; operationId: string }> = {}) =>
    aiResultReceipt({ ownerId, operationId, fingerprint, now: () => time, ...overrides });

  async function claimNew() {
    const claim = await open().claim();
    if (claim.state !== 'claimed') throw new Error('Expected the first caller to claim the generation');
    return claim;
  }

  beforeEach(() => {
    jest.resetAllMocks();
    time = new Date('2026-11-07T23:00:00.000Z');
    store = storeFixture();
    store.write(accountPath, { usage: oldUsage });
  });

  it('recovers the same result while the first accounting request is stalled, and charges only once', async () => {
    const original = open();
    const claim = await claimNew();
    const answer = { outline: ['Grace', 'Hope'] };
    await claim.save(answer);
    const blocked = deferred();
    const began = deferred();
    adminDb.runTransaction.mockImplementationOnce(async run => {
      began.resolve();
      await blocked.promise;
      return store.transaction(run);
    });

    const pendingCharge = original.settle();
    await began.promise;
    try {
      expect(store.read(receiptPath).data()).toMatchObject({ state: 'ready' });
      expect(store.read(accountPath).data()).toEqual({ usage: oldUsage });
      const retry = open();
      await expect(retry.claim()).resolves.toMatchObject({ state: 'ready' });
      await expect(retry.settle()).resolves.toEqual({ value: answer, completedAtMs: time.getTime() });
    } finally {
      blocked.resolve();
      await pendingCharge;
    }
    await expect(pendingCharge).resolves.toEqual({ value: answer, completedAtMs: time.getTime() });
    expect(store.read(accountPath).data()).toMatchObject({ usage: { ...oldUsage, aiUsed: 6 } });
    expect(store.read(receiptPath).data()).toMatchObject({ state: 'settled' });
  });

  it('counts an unclaimed ready response at the next paid text admission without its original operation ID', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(time);
    try {
      const claim = await claimNew();
      await claim.save({ response: 'the browser closed before accounting' });
      const other = await open({ ownerId: 'another-owner' }).claim();
      if (other.state !== 'claimed') throw new Error('Expected a new owner-scoped claim');
      await other.save({ response: 'another owner' });

      const first = await getUserEntitlementServerSide(ownerId, { includeTextPreference: true, reconcileTextReceipts: true });
      const second = await getUserEntitlementServerSide(ownerId, { includeTextPreference: true, reconcileTextReceipts: true });

      expect(first.usage?.aiUsed).toBe(6);
      expect(second.usage?.aiUsed).toBe(6);
      expect(store.read(receiptPath).data()).toMatchObject({ state: 'settled' });
      expect(store.read('users/another-owner/aiResultReceipts/test-operation-1').data()).toMatchObject({ state: 'ready' });
      await expect(open().settle()).resolves.toMatchObject({ value: { response: 'the browser closed before accounting' } });
      expect(store.read(accountPath).data()).toMatchObject({ usage: { aiUsed: 6 } });
    } finally {
      jest.useRealTimers();
    }
  });

  it('recovery-only serves an existing result but cannot open a new generation', async () => {
    const recovery = recoverableAiResult({
      ownerId, operationId, fingerprint, recoverOnly: true, deadline: performance.now() + 10_000, now: () => time,
    });
    const generate = jest.fn();
    const run = () => recovery.run(value => value, generate);

    await expect(run()).rejects.toBeInstanceOf(AiResultUnavailableError);
    expect(store.read(receiptPath).exists).toBe(false);

    const claim = await claimNew();
    await claim.save({ response: 'stored result' });

    await expect(run()).resolves.toMatchObject({ data: { response: 'stored result' } });
    expect(generate).not.toHaveBeenCalled();
    expect(store.read(accountPath).data()).toMatchObject({ usage: { aiUsed: 6 } });
  });

  it('does not repeat a committed charge after the response to the transaction was lost', async () => {
    const claim = await claimNew();
    await claim.save({ response: 'ready' });
    adminDb.runTransaction.mockImplementationOnce(async run => {
      await store.transaction(run);
      throw new Error('The transaction response was lost');
    });

    await expect(open().settle()).rejects.toThrow('The transaction response was lost');
    await expect(open().claim()).resolves.toMatchObject({ state: 'settled' });
    await expect(open().settle()).resolves.toMatchObject({ value: { response: 'ready' } });
    expect(store.read(accountPath).data()).toMatchObject({ usage: { ...oldUsage, aiUsed: 6 } });
  });

  it('does not generate again for a running operation or overwrite an already published result', async () => {
    const claim = await claimNew();
    await expect(open().claim()).resolves.toMatchObject({ state: 'running' });
    await claim.save({ response: 'first result' });
    await open().settle();

    await expect(claim.save({ response: 'late second result' })).rejects.toMatchObject({ code: 9 });
    await expect(claim.fail()).rejects.toMatchObject({ code: 9 });
    await expect(open().settle()).resolves.toMatchObject({ value: { response: 'first result' } });
    expect(store.read(accountPath).data()).toMatchObject({ usage: { ...oldUsage, aiUsed: 6 } });
  });

  it('fences an expired generation while preserving a result published before the fence', async () => {
    const expired = await claimNew();
    const stored = open({ operationId: 'test-operation-2' });
    const second = await stored.claim();
    if (second.state !== 'claimed') throw new Error('Expected a separate new operation');
    await second.save({ response: 'finished before expiry' });

    await expect(open().expireRunning(time.getTime())).resolves.toMatchObject({ state: 'failed' });
    await expect(expired.save({ response: 'late after expiry' })).rejects.toMatchObject({ code: 9 });
    await expect(stored.expireRunning(time.getTime())).resolves.toMatchObject({ state: 'ready' });
    await expect(stored.settle()).resolves.toMatchObject({ value: { response: 'finished before expiry' } });
    expect(store.read(accountPath).data()).toMatchObject({ usage: { ...oldUsage, aiUsed: 6 } });
  });

  it('leaves failed generations uncharged and refuses an attempt ID reused for other content', async () => {
    const claim = await claimNew();
    await expect(open({ fingerprint: 'edited-source' }).claim()).rejects.toBeInstanceOf(AiResultReceiptConflict);
    await expect(open({ fingerprint: 'edited-source' }).settle()).rejects.toBeInstanceOf(AiResultReceiptConflict);
    await expect(open({ ownerId: 'another-owner' }).claim()).resolves.toMatchObject({ state: 'claimed' });

    await claim.fail();
    await expect(open().claim()).resolves.toMatchObject({ state: 'failed' });
    await expect(open().settle()).rejects.toThrow('no result to settle');
    expect(store.read(accountPath).data()).toEqual({ usage: oldUsage });
  });

  it('settles an old receipt in its original period without spending the new allowance', async () => {
    const claim = await claimNew();
    await claim.save({ response: 'last month' });
    time = new Date('2026-12-01T00:00:05.000Z');
    const currentUsage = { periodStart: '2026-12-01T00:00:00.000Z', aiUsed: 2 };
    store.write(accountPath, { usage: currentUsage });

    await expect(open().settle()).resolves.toMatchObject({ value: { response: 'last month' } });
    expect(store.read(accountPath).data()).toEqual({ usage: currentUsage });
    expect(store.read(receiptPath).data()).toMatchObject({
      state: 'settled',
      chargePeriod: '2026-11-01T00:00:00.000Z',
    });
  });
});
