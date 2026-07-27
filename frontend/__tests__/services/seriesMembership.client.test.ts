export {}; // isolate module scope

const mockDb = { app: 'client-db' };
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockGetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const batchUpdate = jest.fn();
const batchCommit = jest.fn().mockResolvedValue(undefined);
const mockWriteBatch = jest.fn(() => ({ update: batchUpdate, commit: batchCommit }));
const mockGetClientDb = jest.fn(() => mockDb);

async function importClient() {
  jest.resetModules();
  jest.doMock('@/config/firebaseClientDb', () => ({ getClientDb: mockGetClientDb }));
  // The queue is per OWNER now — a shared key let one account's stuck operation
  // block another's forever, so an operation without a signed-in owner is refused.
  jest.doMock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'u1' } } }));
  jest.doMock('firebase/firestore', () => ({
    doc: mockDoc,
    getDoc: mockGetDoc,
    updateDoc: mockUpdateDoc,
    writeBatch: mockWriteBatch,
    // Counter bump rides the ordinary write payload.
    increment: (n: number) => ({ __increment: n }),
    // ONLINE the commit runs inside one transaction: read every target, then
    // write. Mirrors the real contract closely enough to assert on the writes.
    runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      if (mockTransactionFailure) throw mockTransactionFailure;
      const tx = {
        get: (ref: unknown) => mockGetDoc(ref),
        update: (ref: unknown, payload: unknown) => mockTxUpdate(ref, payload),
      };
      await fn(tx);
    },
  }));
  return import('@/services/seriesMembership.client');
}

const mockTxUpdate = jest.fn();
let mockTransactionFailure: unknown = null;

const snap = (id: string, data: Record<string, unknown> | null) => ({
  id,
  exists: () => data !== null,
  data: () => data,
});

// item helper for fixtures
const sermonItem = (refId: string, position = 1) => ({
  id: `sermon-${refId}`,
  type: 'sermon' as const,
  refId,
  position,
});

describe('seriesMembership.client — commitSeriesBatch', () => {
  beforeEach(() => {
    mockTxUpdate.mockReset();
    // The offline membership queue is durable, so it leaks between tests.
    localStorage.clear();
    mockTransactionFailure = null;
    jest.clearAllMocks();
  });

  it('MOVE is ONE atomic transaction and leaves the ref in EXACTLY one series (DESYNC guard)', async () => {
    // target has nothing; source currently holds s1. A move must add to target and
    // remove from source in a single batch.
    mockGetDoc.mockImplementation((ref: { id: string }) => {
      if (ref.id === 'target') return Promise.resolve(snap('target', { items: [], sermonIds: [] }));
      if (ref.id === 'source') {
        return Promise.resolve(snap('source', { items: [sermonItem('s1')], sermonIds: ['s1'] }));
      }
      return Promise.resolve(snap(ref.id, null));
    });

    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
      { seriesId: 'source', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
    ]);

    // ONE transaction, both docs written inside it. Read-then-batch used to leave
    // a window where a concurrent transform was silently dropped.
    expect(mockTxUpdate).toHaveBeenCalledTimes(2);
    expect(batchCommit).not.toHaveBeenCalled();

    // Assert "≤1 series contains s1" DIRECTLY on the written raw items (not via derive).
    const writtenBySeries = new Map<string, { items: Array<{ refId: string }> }>();
    for (const call of mockTxUpdate.mock.calls) {
      const ref = call[0] as { id: string };
      const payload = call[1] as { items: Array<{ refId: string }> };
      writtenBySeries.set(ref.id, payload);
    }
    const holders = [...writtenBySeries.entries()].filter(([, payload]) =>
      payload.items.some((item) => item.refId === 's1')
    );
    expect(holders).toHaveLength(1);
    expect(holders[0][0]).toBe('target');
    // recomputed sibling fields stay consistent in the SAME write
    expect(writtenBySeries.get('target')).toEqual(
      expect.objectContaining({ sermonIds: ['s1'], seriesKind: 'sermon' })
    );
    expect(writtenBySeries.get('source')?.items).toEqual([]);
  });

  it('tolerates a concurrently-deleted series doc (skips it, commits the rest)', async () => {
    mockGetDoc.mockImplementation((ref: { id: string }) => {
      if (ref.id === 'gone') return Promise.resolve(snap('gone', null));
      return Promise.resolve(snap('target', { items: [], sermonIds: [] }));
    });

    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'gone', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
    ]);

    expect(mockTxUpdate).toHaveBeenCalledTimes(1); // only 'target' written; 'gone' skipped
  });

  it('OFFLINE queues the OPERATION, never a precomputed array', async () => {
    // The old offline path read the cache, built the whole new item list from it and
    // queued THAT. Hours later it landed and silently deleted whatever the other
    // device had added meanwhile — a sermon added from the train erased one added
    // from the phone. Storing the operation lets replay apply it to what is
    // actually stored.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    mockGetDoc.mockImplementation(() => Promise.resolve(snap('target', { items: [], sermonIds: [] })));

    try {
      const client = await importClient();
      await client.commitSeriesBatch([
        { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
      ]);

      // Nothing written at all — and the operation is remembered verbatim.
      expect(batchCommit).not.toHaveBeenCalled();
      expect(mockTxUpdate).not.toHaveBeenCalled();
      expect(client.listMembershipTransforms('u1')).toEqual([
        { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
      ]);
    } finally {
      delete (window.navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('replay applies the queued operation to what is ACTUALLY stored', async () => {
    // The other device added D while we were offline: replay must keep it.
    mockGetDoc.mockImplementation(() =>
      Promise.resolve(snap('target', { items: [sermonItem('D', 1)], sermonIds: ['D'] }))
    );
    const client = await importClient();
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'C' }] },
    ]);
    delete (window.navigator as unknown as Record<string, unknown>).onLine;

    await client.replayMembershipOutbox('u1');

    const [, payload] = mockTxUpdate.mock.calls[0] as [unknown, { items: Array<{ refId: string }> }];
    const refs = payload.items.map((item) => item.refId);
    expect(refs).toContain('C');
    expect(refs).toContain('D');
    expect(client.listMembershipTransforms('u1')).toEqual([]);
  });


  it('does NOT rebuild from a cached read when navigator.onLine lies', async () => {
    // A captive portal reports online and the transaction cannot reach Firestore.
    // Falling back to the batch here looked helpful and was destructive: it
    // rebuilds the whole item list from a CACHED read, so if the server already
    // holds an entry this device has not seen, the queued array DELETES it.
    // Failing loudly is the honest outcome for a rare, manual action.
    mockTransactionFailure = Object.assign(new Error('backend unavailable'), {
      code: 'unavailable',
    });
    mockGetDoc.mockImplementation(() => Promise.resolve(snap('target', { items: [], sermonIds: [] })));

    const client = await importClient();
    await expect(
      client.commitSeriesBatch([{ seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] }])
    ).rejects.toThrow('backend unavailable');

    expect(batchCommit).not.toHaveBeenCalled();
  });

  it('does NOT swallow a real failure behind the fallback', async () => {
    mockTransactionFailure = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });
    mockGetDoc.mockImplementation(() => Promise.resolve(snap('target', { items: [], sermonIds: [] })));

    const client = await importClient();
    await expect(
      client.commitSeriesBatch([{ seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] }])
    ).rejects.toThrow('Missing or insufficient permissions.');
    expect(batchCommit).not.toHaveBeenCalled();
  });

  it('no-ops (no batch) when given an empty transform list', async () => {
    const client = await importClient();
    await client.commitSeriesBatch([]);
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(batchCommit).not.toHaveBeenCalled();
  });
});

/**
 * The queue itself. Every one of these was a real defect: the shape used to be a
 * single mutable array under one key, shared by every account, whose storage
 * failures were caught and ignored.
 */
describe('the offline membership queue keeps its promises', () => {
  beforeEach(() => {
    localStorage.clear();
    mockTxUpdate.mockReset();
    mockGetDoc.mockReset();
    mockTransactionFailure = null;
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('does NOT refuse the save when storage refuses the intent — it falls back to a durable write', async () => {
    // The earlier version threw here, and the ninth review called that a hard-law
    // regression: HEAD stored this offline with a Firestore batched write, and batched
    // writes DO execute offline. Denying a legitimate membership change is strictly
    // worse than the known weakness of that fallback.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    mockGetDoc.mockImplementation(() => Promise.resolve(snap('target', { items: [], sermonIds: [] })));

    try {
      const client = await importClient();
      await expect(
        client.commitSeriesBatch([
          { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
        ])
      ).resolves.toBeUndefined();
      expect(batchCommit).toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });
  it('keeps an operation queued while the replay commit is in flight', async () => {
    // A person taps "add to series" again — or another tab does — while the replay
    // transaction is still going. Removing the whole key on success threw that
    // second operation away unsubmitted.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'first' }] },
    ]);
    delete (window.navigator as unknown as Record<string, unknown>).onLine;

    mockGetDoc.mockImplementation(() => Promise.resolve(snap('target', { items: [], sermonIds: [] })));
    let queuedDuringCommit = false;
    mockTxUpdate.mockImplementation(() => {
      if (queuedDuringCommit) return;
      queuedDuringCommit = true;
      // Arrives while the commit is running.
      localStorage.setItem(
        'membershipOutbox:v2:late',
        JSON.stringify({
          id: 'late',
          uid: 'u1',
          transform: { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'late' }] },
          savedAt: Date.now() + 1000,
        })
      );
    });

    await client.replayMembershipOutbox('u1');

    expect(client.listMembershipTransforms('u1')).toEqual([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'late' }] },
    ]);
  });

  it('keeps BOTH offline additions to the SAME series', async () => {
    // Each queued operation now replays on its OWN commit (one dead operation must not
    // poison the others), so the second must see what the first stored. The harness is
    // stateful for exactly that reason: a fixed snapshot would model a document that
    // never changes, which is not the world this code lives in.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'A' }] },
    ]);
    await client.commitSeriesBatch([
      { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 'B' }] },
    ]);
    delete (window.navigator as unknown as Record<string, unknown>).onLine;

    let liveItems: Array<{ id: string; type: string; refId: string; position: number }> = [];
    mockGetDoc.mockImplementation(() =>
      Promise.resolve(
        snap('target', { items: [...liveItems], sermonIds: liveItems.map((i) => i.refId) })
      )
    );
    mockTxUpdate.mockImplementation((_ref: unknown, payload: { items?: typeof liveItems }) => {
      if (payload.items) liveItems = payload.items;
    });

    await client.replayMembershipOutbox('u1');

    expect(liveItems.map((item) => item.refId).sort()).toEqual(['A', 'B']);
    expect(client.listMembershipTransforms('u1')).toEqual([]);
  });
  it('rolls the half-written MOVE back out of the queue, and still saves it', async () => {
    // Rollback keeps the queue consistent (no half-move replayed later); the change
    // itself then goes out through the durable batched write rather than being denied.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const client = await importClient();
    mockGetDoc.mockImplementation(() => Promise.resolve(snap('any', { items: [], sermonIds: [] })));

    const realSetItem = Storage.prototype.setItem;
    let writes = 0;
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        writes += 1;
        if (writes === 2) throw new Error('QuotaExceededError');
        realSetItem.call(this, key, value);
      });

    try {
      await expect(
        client.commitSeriesBatch([
          { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
          { seriesId: 'source', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
        ])
      ).resolves.toBeUndefined();
    } finally {
      setItem.mockRestore();
    }

    expect(client.listMembershipTransforms('u1')).toEqual([]);
    expect(batchCommit).toHaveBeenCalled();
  });
  it('ABORTS when the target series is gone, instead of committing half a move', async () => {
    // Phone deleted the target series; a stale laptop moves a sermon there. Skipping
    // the missing target while committing the source removal reported success and
    // left the sermon in NEITHER series.
    mockGetDoc.mockImplementation((ref: { id?: string; path?: string } | undefined) => {
      const id = (ref as { id?: string })?.id;
      if (id === 'target') return Promise.resolve(snap('target', null));
      return Promise.resolve(snap('source', { items: [sermonItem('s1', 1)], sermonIds: ['s1'] }));
    });

    const client = await importClient();
    await expect(
      client.commitSeriesBatch([
        { seriesId: 'target', op: 'add', refs: [{ type: 'sermon', refId: 's1' }] },
        { seriesId: 'source', op: 'remove', refs: [{ type: 'sermon', refId: 's1' }] },
      ])
    ).rejects.toThrow(/not found/i);

    // And the source was NOT written.
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('one DEAD operation does not block the live ones', async () => {
    // The hard-law regression the ninth review found: replaying the whole queue as one
    // batch meant a deleted target made the commit throw, rolling back a perfectly
    // good addition to a DIFFERENT series — and repeating that poisoned batch every
    // minute, forever. HEAD skipped the missing document, so the good one landed.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const client = await importClient();
    await client.commitSeriesBatch([
      { seriesId: 'deleted-elsewhere', op: 'add', refs: [{ type: 'sermon', refId: 'S' }] },
    ]);
    await client.commitSeriesBatch([
      { seriesId: 'alive', op: 'add', refs: [{ type: 'sermon', refId: 'T' }] },
    ]);
    delete (window.navigator as unknown as Record<string, unknown>).onLine;

    mockGetDoc.mockImplementation((ref: unknown) => {
      const id = (ref as { id?: string })?.id;
      if (id === 'deleted-elsewhere') return Promise.resolve(snap('deleted-elsewhere', null));
      return Promise.resolve(snap('alive', { items: [], sermonIds: [] }));
    });

    const replayed = await client.replayMembershipOutbox('u1');

    // The live one landed…
    expect(replayed).toBe(1);
    expect(mockTxUpdate).toHaveBeenCalled();
    // …and only the dead one is still waiting.
    const left = client.listMembershipTransforms('u1');
    expect(left).toHaveLength(1);
    expect(left[0].seriesId).toBe('deleted-elsewhere');
  });

  it('never replays another account\'s operation', async () => {
    // One shared key could deadlock both people: each replay tried to write the
    // other account's document, which answers permission-denied, so neither
    // person's own change ever drained.
    const client = await importClient();
    localStorage.setItem(
      'membershipOutbox:v2:theirs',
      JSON.stringify({
        id: 'theirs',
        uid: 'someone-else',
        transform: { seriesId: 'their-series', op: 'add', refs: [{ type: 'sermon', refId: 'x' }] },
        savedAt: 1,
      })
    );

    expect(client.listMembershipTransforms('u1')).toEqual([]);
    expect(await client.replayMembershipOutbox('u1')).toBe(0);
    // And it is still there for its owner — not deleted by a stranger.
    expect(client.listMembershipTransforms('someone-else')).toHaveLength(1);
  });
});
