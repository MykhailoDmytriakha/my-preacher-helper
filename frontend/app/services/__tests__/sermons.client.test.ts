/**
 * Idempotency guard for createManualThoughtViaClient.
 *
 * The migration moved manual-thought creates onto the client Firestore SDK, which
 * natively queues an offline write. If a create is ever sent twice — the native
 * offline queue committing the original write AND a reload-recovered retry, both
 * replaying the SAME optimistic id — the result must be ONE thought, not a
 * duplicate. This locks that invariant (the same collision class dissolved for
 * preach-dates by client-id insert-if-absent). See [[feedback_dissolve_collisions_with_idempotency]].
 *
 * NB: first test in the codebase to mock the client Firestore SDK directly. The
 * stateful `store` makes getDoc reflect a prior updateDoc, mirroring Firestore's
 * read-modify-write across the two sends.
 */
import {
  addScratchNoteViaClient,
  applyScratchToOutlineViaClient,
  createManualThoughtViaClient,
  deletePreachDateViaClient,
  deleteScratchNoteViaClient,
  deleteThoughtViaClient,
  updatePreachDateViaClient,
  updateScratchNoteViaClient,
} from '@/services/sermons.client';

type StoredSermon = {
  userId: string;
  thoughts: { id: string }[];
  scratch?: { id: string; text: string; createdAt: string; section?: string }[];
  outline?: {
    introduction: { id: string; text: string }[];
    main: { id: string; text: string }[];
    conclusion: { id: string; text: string }[];
  };
  updatedAt?: string;
};
const store: Record<string, StoredSermon> = {};

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

// Hook the test can install to simulate ANOTHER DEVICE writing between the
// transaction's read and its commit (what real Firestore retries on).
let onTransactionAttempt: ((attempt: number) => void) | null = null;

jest.mock('firebase/firestore', () => ({
  // doc/getDoc/updateDoc cover the offline path; runTransaction covers the online
  // path taken by atomicUpdate. The rest are stubbed so imports resolve.
  arrayUnion: jest.fn((v: unknown) => v),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  doc: (_db: unknown, _collection: string, id: string) => ({ __id: id }),
  getDoc: async (ref: { __id: string }) => ({
    exists: () => store[ref.__id] !== undefined,
    data: () => store[ref.__id],
  }),
  updateDoc: async (ref: { __id: string }, payload: Record<string, unknown>) => {
    store[ref.__id] = { ...store[ref.__id], ...(payload as Partial<StoredSermon>) } as StoredSermon;
  },
  // Mirrors the real contract: the callback reads through the transaction and may
  // be RE-RUN against fresh data when the doc changed mid-flight.
  runTransaction: async (
    _db: unknown,
    fn: (tx: {
      get: (ref: { __id: string }) => Promise<{ exists: () => boolean; data: () => unknown }>;
      update: (ref: { __id: string }, payload: Record<string, unknown>) => void;
    }) => Promise<void>
  ) => {
    let attempt = 0;
    // Retry loop, like the SDK's: a concurrent write invalidates the read set.
    for (;;) {
      attempt += 1;
      const readAt: Record<string, StoredSermon | undefined> = {};
      const pending: { ref: { __id: string }; payload: Record<string, unknown> }[] = [];
      await fn({
        get: async (ref) => {
          readAt[ref.__id] = store[ref.__id];
          return {
            exists: () => store[ref.__id] !== undefined,
            data: () => store[ref.__id],
          };
        },
        update: (ref, payload) => pending.push({ ref, payload }),
      });
      onTransactionAttempt?.(attempt);
      // If anything we read changed while the callback ran, discard and re-run.
      const stale = Object.keys(readAt).some((id) => store[id] !== readAt[id]);
      if (stale && attempt < 5) continue;
      for (const w of pending) {
        store[w.ref.__id] = {
          ...store[w.ref.__id],
          ...(w.payload as Partial<StoredSermon>),
        } as StoredSermon;
      }
      return;
    }
  },
}));

const optimisticThought = () => ({
  id: 'local-abc-123',
  text: 'a manual thought',
  tags: ['mytag'],
  date: '2026-06-09T00:00:00.000Z',
});

describe('createManualThoughtViaClient — idempotent by client id', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    store.s1 = { userId: 'u1', thoughts: [] };
  });

  it('sending the same optimistic id twice yields ONE thought (insert-if-absent)', async () => {
    await createManualThoughtViaClient('s1', optimisticThought() as never);
    await createManualThoughtViaClient('s1', optimisticThought() as never);

    expect(store.s1.thoughts).toHaveLength(1);
    expect(store.s1.thoughts[0].id).toBe('abc-123'); // optimistic "local-" prefix stripped
  });

  it('strips the optimistic local- prefix so the saved thought reads as real', async () => {
    const saved = await createManualThoughtViaClient(
      's1',
      { id: 'local-xyz', text: 't', tags: ['mytag'], date: 'd' } as never
    );
    expect(saved.id).toBe('xyz');
  });

  it('distinct optimistic ids append distinct thoughts', async () => {
    await createManualThoughtViaClient('s1', { id: 'local-a', text: 't', tags: ['mytag'], date: 'd' } as never);
    await createManualThoughtViaClient('s1', { id: 'local-b', text: 't', tags: ['mytag'], date: 'd' } as never);

    expect(store.s1.thoughts).toHaveLength(2);
  });
});

describe('scratch note client writes', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    store.s1 = { userId: 'u1', thoughts: [{ id: 'thought-1' }] };
  });

  it('writes only the computed scratch array plus updatedAt and removes undefined fields', async () => {
    await addScratchNoteViaClient('s1', [
      { id: 'n1', text: 'first', createdAt: '2026-07-04T00:00:00.000Z', section: undefined },
    ] as never);

    expect(store.s1.thoughts).toEqual([{ id: 'thought-1' }]);
    expect(store.s1.scratch).toEqual([
      { id: 'n1', text: 'first', createdAt: '2026-07-04T00:00:00.000Z' },
    ]);
    expect(store.s1.updatedAt).toEqual(expect.any(String));

    await updateScratchNoteViaClient('s1', [
      { id: 'n1', text: 'first edited', createdAt: '2026-07-04T00:00:00.000Z', section: 'main' },
    ] as never);
    expect(store.s1.scratch).toEqual([
      { id: 'n1', text: 'first edited', createdAt: '2026-07-04T00:00:00.000Z', section: 'main' },
    ]);

    await deleteScratchNoteViaClient('s1', []);
    expect(store.s1.scratch).toEqual([]);
  });

  it('applies scratch to outline with one sermon-doc update containing outline and remaining scratch', async () => {
    await applyScratchToOutlineViaClient(
      's1',
      {
        introduction: [],
        main: [{ id: 'p1', text: 'Applied point' }],
        conclusion: [],
      },
      [{ id: 'n2', text: 'leftover', createdAt: '2026-07-04T00:01:00.000Z', section: undefined }] as never
    );

    expect(store.s1.thoughts).toEqual([{ id: 'thought-1' }]);
    expect(store.s1.outline).toEqual({
      introduction: [],
      main: [{ id: 'p1', text: 'Applied point' }],
      conclusion: [],
    });
    expect(store.s1.scratch).toEqual([
      { id: 'n2', text: 'leftover', createdAt: '2026-07-04T00:01:00.000Z' },
    ]);
    expect(store.s1.updatedAt).toEqual(expect.any(String));
  });
});

// The two-device overwrite bug this guards: the naive pattern read thoughts[],
// rebuilt it locally, then wrote the WHOLE array back — so anything another
// device added between our read and our write was destroyed. atomicUpdate runs
// the mutation inside a transaction, which re-runs it against fresh data.
describe('concurrent edits from another device are NOT clobbered', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    onTransactionAttempt = null;
  });

  afterEach(() => {
    onTransactionAttempt = null;
  });

  it('a thought added elsewhere mid-write survives (add path)', async () => {
    store.s1 = { userId: 'u1', thoughts: [] };

    // Another device appends its own thought while our transaction is in flight.
    onTransactionAttempt = (attempt) => {
      if (attempt === 1) {
        store.s1 = {
          ...store.s1,
          thoughts: [...(store.s1.thoughts ?? []), { id: 'from-phone' } as never],
        };
      }
    };

    await createManualThoughtViaClient('s1', {
      id: 'from-desktop',
      text: 'typed on desktop',
      tags: ['t'],
      date: '2026-07-24T00:00:00.000Z',
    } as never);

    const ids = (store.s1.thoughts ?? []).map((t: { id: string }) => t.id);
    expect(ids).toContain('from-phone'); // would be missing under read-modify-write
    expect(ids).toContain('from-desktop');
  });

  it('a thought added elsewhere mid-write survives a delete of a DIFFERENT thought', async () => {
    store.s1 = {
      userId: 'u1',
      thoughts: [{ id: 'old' } as never, { id: 'doomed' } as never],
    };

    onTransactionAttempt = (attempt) => {
      if (attempt === 1) {
        store.s1 = {
          ...store.s1,
          thoughts: [...(store.s1.thoughts ?? []), { id: 'from-phone' } as never],
        };
      }
    };

    await deleteThoughtViaClient('s1', { id: 'doomed' } as never);

    const ids = (store.s1.thoughts ?? []).map((t: { id: string }) => t.id);
    expect(ids).toEqual(['old', 'from-phone']); // deletion applied, phone edit kept
  });

  it('a preach date added elsewhere mid-write survives a delete (preachDates path)', async () => {
    store.s1 = {
      userId: 'u1',
      thoughts: [],
      preachDates: [{ id: 'doomed', date: '2026-07-01' }],
    } as never;

    onTransactionAttempt = (attempt) => {
      if (attempt === 1) {
        const current = store.s1 as unknown as { preachDates: { id: string }[] };
        store.s1 = {
          ...store.s1,
          preachDates: [...current.preachDates, { id: 'from-phone', date: '2026-07-09' }],
        } as never;
      }
    };

    await deletePreachDateViaClient('s1', 'doomed');

    const dates = (store.s1 as unknown as { preachDates: { id: string }[] }).preachDates;
    expect(dates.map((d) => d.id)).toEqual(['from-phone']);
  });
});

// THE POST-COMMIT-DEADLINE TRAP (found by independent review).
// A transient error does NOT prove the write failed: `deadline-exceeded` can be
// returned AFTER the commit succeeded. If a create replayed as a REPLACE, it
// would resurrect its own stale copy over an edit that landed in between. Create
// is therefore insert-if-absent, so the replay is a genuine no-op.
describe('replay after an indeterminate transient failure does not overwrite newer data', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    onTransactionAttempt = null;
  });

  it('create is insert-if-absent: replaying it keeps the NEWER edit of that thought', async () => {
    // The first attempt already committed thought t1, and a later edit changed it.
    store.s1 = {
      userId: 'u1',
      thoughts: [{ id: 't1', text: 'edited AFTER the first commit' } as never],
    };

    await createManualThoughtViaClient('s1', {
      id: 't1',
      text: 'original text from the first attempt',
      tags: ['mytag'],
      date: '2026-07-25T00:00:00.000Z',
    } as never);

    const stored = store.s1.thoughts as unknown as { id: string; text: string }[];
    expect(stored).toHaveLength(1); // no duplicate
    expect(stored[0].text).toBe('edited AFTER the first commit'); // newer edit survives
  });

  it('a replayed create RETURNS the stored value, so the UI does not flash the stale copy', async () => {
    store.s1 = {
      userId: 'u1',
      thoughts: [{ id: 't1', text: 'newer text already saved' } as never],
    };

    const returned = await createManualThoughtViaClient('s1', {
      id: 't1',
      text: 'stale text from the replayed attempt',
      tags: ['mytag'],
      date: '2026-07-25T00:00:00.000Z',
    } as never);

    expect(returned.text).toBe('newer text already saved');
  });

  it('delete recomputed on fresh data removes only its target and keeps concurrent additions', async () => {
    store.s1 = {
      userId: 'u1',
      thoughts: [{ id: 'doomed' } as never, { id: 'added-meanwhile' } as never],
    };

    await deleteThoughtViaClient('s1', { id: 'doomed' } as never);
    // A replay of the same removal must stay a no-op.
    await deleteThoughtViaClient('s1', { id: 'doomed' } as never);

    expect((store.s1.thoughts ?? []).map((t: { id: string }) => t.id)).toEqual(['added-meanwhile']);
  });
});

// KNOWN, INHERITED LIMIT (documented as open in BUGS.md #0): a replayed ADD cannot
// tell "never added" from "added, then deleted elsewhere", so it re-inserts. HEAD
// had the same hole AND additionally clobbered concurrent additions, so this is a
// narrowing rather than a regression. Locked here so the behaviour is a known
// state rather than a surprise, and so a future tombstone/ledger fix has a test to
// flip deliberately.
describe('KNOWN LIMIT: replayed add re-inserts an item deleted elsewhere', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    onTransactionAttempt = null;
    store.s1 = { userId: 'u1', thoughts: [{ id: 'kept' } as never] };
  });

  it('re-inserts because insert-if-absent cannot see a tombstone (only its OWN item, not the whole array)', async () => {
    // Simulates: our add committed, its response was lost, the item was deleted
    // elsewhere, and the mutation is replayed against a fresh snapshot.
    await createManualThoughtViaClient('s1', {
      id: 'replayed',
      text: 'came back',
      tags: ['mytag'],
      date: '2026-07-25T00:00:00.000Z',
    } as never);

    const ids = (store.s1.thoughts ?? []).map((t: { id: string }) => t.id);
    expect(ids).toContain('replayed'); // the known resurrection
    // The replay touches ONLY its own item. (HEAD also preserves an item that
    // existed before its read — what HEAD additionally loses is an item written
    // AFTER its getDoc and before its whole-array updateDoc, which the
    // transaction's fresh recompute cannot lose.)
    expect(ids).toContain('kept');
  });
});

// Error PRECEDENCE, restored to HEAD's order after a review caught it drifting:
// the document read and the id lookup must happen BEFORE date validation, so a
// missing sermon or a missing date reports not-found rather than a format error.
describe('updatePreachDateViaClient error precedence matches HEAD', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    onTransactionAttempt = null;
  });

  it('reports SERMON not found (not "invalid date") when the sermon is missing and the date is invalid', async () => {
    await expect(
      updatePreachDateViaClient('missing-sermon', 'd1', { date: 'not-a-date' })
    ).rejects.toThrow('Sermon not found');
  });

  it('reports PREACH DATE not found (not "invalid date") when the id is unknown and the date is invalid', async () => {
    store.s1 = { userId: 'u1', thoughts: [], preachDates: [{ id: 'other', date: '2026-07-01' }] } as never;

    await expect(
      updatePreachDateViaClient('s1', 'unknown-id', { date: 'not-a-date' })
    ).rejects.toThrow('Preach date not found');
  });

  it('still rejects an invalid date once the sermon and date DO exist', async () => {
    store.s1 = { userId: 'u1', thoughts: [], preachDates: [{ id: 'd1', date: '2026-07-01' }] } as never;

    await expect(
      updatePreachDateViaClient('s1', 'd1', { date: 'not-a-date' })
    ).rejects.toThrow('Invalid preach date format');
  });
});
