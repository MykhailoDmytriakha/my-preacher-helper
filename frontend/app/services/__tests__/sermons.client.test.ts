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
  addPreachDateViaClient,
  updateThoughtViaClient,
  addScratchNoteViaClient,
  applyScratchToOutlineViaClient,
  createManualThoughtViaClient,
  deletePreachDateViaClient,
  deleteScratchNoteViaClient,
  deleteThoughtViaClient,
  updatePreachDateViaClient,
  updateScratchNoteViaClient,
  updateSermonOutlineViaClient,
  updateSermonPreparationViaClient,
  updateSermonViaClient,
  updateStructureViaClient,
} from '@/services/sermons.client';

type StoredSermon = {
  userId: string;
  thoughts: { id: string; text?: string; tags?: string[]; date?: string; outlinePointId?: string | null }[];
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
  // Counter bump rides the ordinary updateDoc path (works offline).
  increment: (n: number) => ({ __increment: n }),
  // doc/getDoc/updateDoc cover the offline path; runTransaction covers the online
  // path taken by atomicUpdate. The rest are stubbed so imports resolve.
  arrayUnion: jest.fn((...v: unknown[]) => (v.length === 1 ? v[0] : { __arrayUnion: v })),
  // Marked so a test can tell a COMMUTATIVE operation from a computed array: offline
  // the difference is whether the other device's notes survive the reconnect.
  arrayRemove: jest.fn((...v: unknown[]) => ({ __arrayRemove: v })),
  deleteField: jest.fn(() => '__DELETE__'),
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

/**
 * Surgical field patches.
 *
 * Callers used to hand over a whole `Sermon` rebuilt from page state captured when
 * the page opened, so saving ONE field wrote the entire whitelist back — including
 * the nested `preparation` object. Editing a verse on a stale tab therefore
 * reverted preparation written meanwhile from another device. These lock the rule
 * that only named fields reach Firestore.
 */
describe('field patches keep untouched fields out of the write', () => {
  const SERMON_ID = 'patch-sermon';

  const fullSermon = {
    id: SERMON_ID,
    userId: 'u1',
    title: 'Stale title from this tab',
    verse: 'New verse the user just typed',
    isPreached: false,
    date: '2026-01-01',
    thoughts: [],
    preparation: { textContext: { note: 'stale copy loaded at page open' } },
  };

  beforeEach(() => {
    store[SERMON_ID] = { userId: 'u1', thoughts: [] };
  });

  it('writes ONLY the patched field, not the whole whitelist', async () => {
    await updateSermonViaClient(fullSermon as never, { verse: fullSermon.verse });

    const written = store[SERMON_ID] as unknown as Record<string, unknown>;
    expect(written.verse).toBe('New verse the user just typed');
    // The stale title and preparation must not have been pushed back.
    expect(written.title).toBeUndefined();
    expect(written.preparation).toBeUndefined();
  });

  it('still writes the whole whitelist when no patch is given (legacy callers)', async () => {
    await updateSermonViaClient(fullSermon as never);

    const written = store[SERMON_ID] as unknown as Record<string, unknown>;
    expect(written.title).toBe('Stale title from this tab');
    expect(written.preparation).toBeDefined();
  });

  it('DELETES a step the user removed, instead of quietly leaving the old one', async () => {
    // Omitting the field path leaves the old value on the server: the UI looks
    // saved and the deleted step comes back after a reload. Firestore needs the
    // deleteField sentinel to remove a nested field.
    const preparation = { textContext: undefined, exegeticalPlan: [{ id: 'x' }] };

    await updateSermonPreparationViaClient(SERMON_ID, preparation as never, ['textContext']);

    const written = store[SERMON_ID] as unknown as Record<string, unknown>;
    expect(written['preparation.textContext']).toBe('__DELETE__');
  });

  it('addresses changed preparation steps by nested path, leaving others alone', async () => {
    const preparation = {
      textContext: { note: 'edited here' },
      exegeticalPlan: [{ id: 'x', title: 'untouched on this device' }],
    };

    await updateSermonPreparationViaClient(SERMON_ID, preparation as never, ['textContext']);

    const written = store[SERMON_ID] as unknown as Record<string, unknown>;
    expect(written['preparation.textContext']).toEqual({ note: 'edited here' });
    // A whole-object write would appear as `preparation` and replace every step.
    expect(written.preparation).toBeUndefined();
    expect(written['preparation.exegeticalPlan']).toBeUndefined();
  });
});

/**
 * A guarded save must return WHAT IT COMMITTED — never a fresh read.
 *
 * Found live with a probe: immediately after the transaction commits, `getDoc`
 * still answers from the local replica, which has not caught up. It returned the
 * other device's text and the pre-commit revision, so a correct save put stale
 * data back on screen, and the stale revision made the person's own next edit get
 * refused as a conflict.
 */
describe('the guarded sermon write reports its own result', () => {
  const sermonArg = {
    id: 's-guarded',
    title: 'Old title',
    verse: 'Old verse',
    date: '2026-07-25',
    userId: 'u1',
    thoughts: [],
    outline: { introduction: [], main: [], conclusion: [] },
    rev: { core: 4, thoughts: 2 },
  } as unknown as Parameters<typeof updateSermonViaClient>[0];

  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['s-guarded'] = {
      userId: 'u1',
      thoughts: [],
      // @ts-expect-error loose fixture shape — the store is untyped storage here
      verse: 'Old verse',
      rev: { core: 4, thoughts: 2 },
    };
  });

  it('returns the written text with the COMMITTED revision', async () => {
    const result = await updateSermonViaClient(
      { ...sermonArg, verse: 'Typed here' },
      { verse: 'Typed here' },
      4
    );

    expect(result?.verse).toBe('Typed here');
    // 5, not 4: the caller's next save must state the revision that now exists,
    // otherwise its own follow-up edit is refused as stale.
    expect(result?.rev?.core).toBe(5);
    // Untouched aggregates keep their counters — no false conflicts elsewhere.
    expect(result?.rev?.thoughts).toBe(2);
  });

  it('ignores a lagging replica instead of publishing its stale answer', async () => {
    // Simulate exactly what was observed: after the commit, reads still answer with
    // the pre-commit document.
    const committedStore = JSON.parse(JSON.stringify(store['s-guarded']));
    const result = await updateSermonViaClient(
      { ...sermonArg, verse: 'Typed here' },
      { verse: 'Typed here' },
      4
    ).then((r) => {
      store['s-guarded'] = committedStore; // replica rolls back to the old view
      return r;
    });

    expect(result?.verse).toBe('Typed here');
    expect(result?.rev?.core).toBe(5);
  });
});

/**
 * Every writer of an aggregate must move that aggregate's counter.
 *
 * WHY THIS MATTERS EVEN THOUGH CONTENT DECIDES. The refusal is settled by the
 * fingerprint of the fields being overwritten, so a writer that forgets the
 * counter can no longer hand out permission to clobber. But the counter is still
 * the FALLBACK for callers that state no fingerprint, and the Firestore rule the
 * owner may arm compares it — a writer that leaves it frozen reports a document
 * as untouched when it was rewritten. These writers all replace a whole field
 * (the plan, the scratch list, the section arrangement, the preach dates), which
 * is exactly where a stale editor silently wins.
 *
 * The mock stores the payload verbatim, so `increment(1)` lands as the literal
 * dotted key with `{ __increment: 1 }`.
 */
describe('whole-field sermon writers advance their own counter', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-rev'] = {
      userId: 'user-1',
      thoughts: [],
      scratch: [{ id: 's1', text: 'one', createdAt: '2026-01-01T00:00:00.000Z' }],
      outline: { introduction: [], main: [{ id: 'p1', text: 'point' }], conclusion: [] },
      preachDates: [{ id: 'd1', date: '2026-02-01', status: 'planned', createdAt: '2026-01-01T00:00:00.000Z' }],
    } as never;
  });

  const bumped = (aggregate: string) =>
    (store['sermon-rev'] as unknown as Record<string, unknown>)[`rev.${aggregate}`];

  it('the plan writer moves rev.outline', async () => {
    await updateSermonOutlineViaClient('sermon-rev', {
      introduction: [],
      main: [{ id: 'p1', text: 'edited' }],
      conclusion: [],
    } as never);
    expect(bumped('outline')).toEqual({ __increment: 1 });
  });

  it('applying scratch to the plan moves BOTH rev.outline and rev.scratch', async () => {
    await applyScratchToOutlineViaClient(
      'sermon-rev',
      { introduction: [], main: [{ id: 'p1', text: 'point' }], conclusion: [] } as never,
      []
    );
    expect(bumped('outline')).toEqual({ __increment: 1 });
    expect(bumped('scratch')).toEqual({ __increment: 1 });
  });

  it('the scratch writer moves rev.scratch', async () => {
    // These writers take the WHOLE recomputed list (that is precisely why they
    // are dangerous from a stale editor) — the counter has to move with it.
    await addScratchNoteViaClient('sermon-rev', [
      { id: 's1', text: 'one', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 's2', text: 'two', createdAt: '2026-01-02T00:00:00.000Z' },
    ] as never);
    expect(bumped('scratch')).toEqual({ __increment: 1 });
  });

  it('the section-arrangement writer moves rev.thoughts, mirroring the server route', async () => {
    await updateStructureViaClient('sermon-rev', { introduction: [], main: ['t1'], conclusion: [], ambiguous: [] } as never);
    expect(bumped('thoughts')).toEqual({ __increment: 1 });
  });

  it('the preparation writer moves rev.preparation', async () => {
    await updateSermonPreparationViaClient('sermon-rev', { spiritual: { done: true } } as never);
    expect(bumped('preparation')).toEqual({ __increment: 1 });
  });

  it('CREATING and DELETING a thought moves rev.thoughts too', async () => {
    // The earlier claim "every client writer bumps" was true for whole-field
    // rewrites and FALSE for the create/delete branches, which go through the
    // transactional path. A create that leaves the number alone makes it lie.
    await createManualThoughtViaClient('sermon-rev', {
      id: 'local-new',
      text: 'a thought typed on the laptop',
      tags: [],
      date: '2026-01-03T00:00:00.000Z',
    } as never);
    expect(bumped('thoughts')).toEqual({ __increment: 1 });
  });

  it('a preach date ADDED moves rev.preachDates', async () => {
    await addPreachDateViaClient('sermon-rev', { date: '2026-03-01', status: 'planned' } as never);
    expect(bumped('preachDates')).toEqual({ __increment: 1 });
  });

  it('a preach date EDITED moves rev.preachDates', async () => {
    await updatePreachDateViaClient('sermon-rev', 'd1', { status: 'preached' } as never);
    expect(bumped('preachDates')).toEqual({ __increment: 1 });
  });
});

/**
 * THE WIRING, not just the pure function.
 *
 * A merge that exists in `utils/` and is never reached from the writer is a green
 * test over a dead feature — the trap this codebase has hit before. This one goes
 * through the real client function and asserts what actually gets written.
 */
describe('the scratch writer MERGES by note id instead of replacing the array', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-merge'] = {
      userId: 'user-1',
      thoughts: [],
      // What the OTHER device stored while this screen was working.
      scratch: [
        { id: 'kept', text: 'from the laptop', createdAt: '2026-07-01T00:00:00.000Z' },
        { id: 'phone', text: 'captured on the phone', createdAt: '2026-07-02T00:00:00.000Z' },
      ],
    } as never;
  });

  it('keeps the note added on the phone while saving this screen\'s own list', async () => {
    // This screen started from ONE note and added another; it never saw 'phone'.
    const base = [{ id: 'kept', text: 'from the laptop', createdAt: '2026-07-01T00:00:00.000Z' }];
    const mine = [
      ...base,
      { id: 'mine', text: 'typed on the laptop', createdAt: '2026-07-03T00:00:00.000Z' },
    ];

    const committed = await addScratchNoteViaClient('sermon-merge', mine as never, base as never);

    const ids = (committed as Array<{ id: string }>).map((n) => n.id).sort();
    expect(ids).toEqual(['kept', 'mine', 'phone']);
    // And that is what actually landed in the document.
    const storedIds = ((store['sermon-merge'] as unknown as { scratch: Array<{ id: string }> }).scratch ?? [])
      .map((n) => n.id)
      .sort();
    expect(storedIds).toEqual(['kept', 'mine', 'phone']);
  });

  it('still honours a deletion made here', async () => {
    const base = [
      { id: 'kept', text: 'from the laptop', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'phone', text: 'captured on the phone', createdAt: '2026-07-02T00:00:00.000Z' },
    ];
    const mine = [base[0]];

    const committed = await deleteScratchNoteViaClient('sermon-merge', mine as never, base as never);

    expect((committed as Array<{ id: string }>).map((n) => n.id)).toEqual(['kept']);
  });
});

describe('the preparation writer merges per STEP', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-prep'] = {
      userId: 'user-1',
      thoughts: [],
      // Filled in on the phone this morning.
      preparation: { spiritual: { done: true }, exegetical: { notes: 'from the phone' } },
    } as never;
  });

  it('keeps a step this screen never saw while saving its own', async () => {
    // The whole-object branch used to hand over the caller's snapshot entire, so the
    // phone's step disappeared the moment the laptop saved a different one.
    const committed = await updateSermonPreparationViaClient('sermon-prep', {
      spiritual: { done: false },
    } as never);

    expect(committed).toEqual(
      expect.objectContaining({
        spiritual: { done: false },
        exegetical: { notes: 'from the phone' },
      })
    );
    const stored = (store['sermon-prep'] as unknown as { preparation: Record<string, unknown> })
      .preparation;
    expect(stored).toEqual(
      expect.objectContaining({ exegetical: { notes: 'from the phone' } })
    );
  });
});

describe('applying scratch to the plan merges BOTH fields', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-apply'] = {
      userId: 'user-1',
      thoughts: [],
      // The other device added a plan point AND a note while this screen worked.
      outline: { introduction: [], main: [{ id: 'phone-point', text: 'added on the phone' }], conclusion: [] },
      scratch: [{ id: 'phone-note', text: 'captured on the phone', createdAt: '2026-07-02T00:00:00.000Z' }],
    } as never;
  });

  it('keeps the phone\'s point AND its note while consuming the local ones', async () => {
    // This single write touches the two things most likely to have changed
    // elsewhere; replacing both together is how an apply erased them.
    const base = {
      outline: { introduction: [], main: [], conclusion: [] },
      scratch: [{ id: 'local', text: 'to be consumed', createdAt: '2026-07-01T00:00:00.000Z' }],
    };
    const applied = {
      introduction: [],
      main: [{ id: 'from-local', text: 'to be consumed' }],
      conclusion: [],
    };

    const result = await applyScratchToOutlineViaClient(
      'sermon-apply',
      applied as never,
      [] as never,
      base as never
    );

    expect(result.outline.main.map((p) => p.id).sort()).toEqual(['from-local', 'phone-point']);
    expect(result.scratch.map((n) => n.id)).toEqual(['phone-note']);
  });
});

describe('the section-arrangement writer keeps thoughts it never heard of', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-structure'] = {
      userId: 'user-1',
      thoughts: [],
      thoughtsBySection: { introduction: ['t1'], main: [], conclusion: ['from-the-phone'] },
    } as never;
  });

  it('preserves a thought created elsewhere while saving this screen\'s arrangement', async () => {
    // The laptop's map is built from the sermon it loaded, so 'from-the-phone' is
    // simply not in it. Writing the map whole dropped that thought out of every
    // section — it stopped being shown anywhere until someone re-sorted by hand.
    await updateStructureViaClient('sermon-structure', {
      introduction: [],
      main: ['t1'],
      conclusion: [],
    } as never);

    const stored = (store['sermon-structure'] as unknown as {
      thoughtsBySection: { main: string[]; conclusion: string[] };
    }).thoughtsBySection;
    expect(stored.main).toEqual(['t1']);
    expect(stored.conclusion).toEqual(['from-the-phone']);
  });
});

/**
 * OFFLINE is where the merge used to vanish: a transaction cannot run without a
 * server, so the write degraded to "compute the whole array from cache and queue
 * it", and on reconnect that array replaced whatever the other device had stored.
 * This is the owner's own scenario — notes on a train, phone at home, laptop
 * reconnects later.
 */
describe('offline scratch writes send a COMMUTATIVE operation, not a computed array', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-offline'] = {
      userId: 'user-1',
      thoughts: [],
      scratch: [{ id: 'a', text: 'already there', createdAt: '2026-07-01T00:00:00.000Z' }],
    } as never;
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('adds with arrayUnion so a note stored elsewhere survives the reconnect', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const base = [{ id: 'a', text: 'already there', createdAt: '2026-07-01T00:00:00.000Z' }];
    const mine = [
      ...base,
      { id: 'new', text: 'typed on the train', createdAt: '2026-07-02T00:00:00.000Z' },
    ];

    await addScratchNoteViaClient('sermon-offline', mine as never, base as never);

    // What landed is the ADDED note alone (the union sentinel), not the caller's
    // two-item list — so at reconnect the server adds it to whatever it holds.
    const written = (store['sermon-offline'] as unknown as { scratch: { id?: string } }).scratch;
    expect(written).toEqual(expect.objectContaining({ id: 'new' }));
  });

  it('removes with arrayRemove instead of writing the remaining list', async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    const base = [
      { id: 'a', text: 'already there', createdAt: '2026-07-01T00:00:00.000Z' },
      { id: 'gone', text: 'to remove', createdAt: '2026-07-02T00:00:00.000Z' },
    ];
    const mine = [base[0]];

    await deleteScratchNoteViaClient('sermon-offline', mine as never, base as never);

    const written = (store['sermon-offline'] as unknown as { scratch: unknown }).scratch;
    // A REMOVE operation naming the deleted note — not the remaining list.
    expect(written).toEqual({ __arrayRemove: [expect.objectContaining({ id: 'gone' })] });
  });
});

describe('offline preparation writes address STEPS, not the whole map', () => {
  beforeEach(() => {
    Object.keys(store).forEach((k) => delete store[k]);
    store['sermon-prep-offline'] = {
      userId: 'user-1',
      thoughts: [],
      preparation: { exegetical: { notes: 'from the phone' } },
    } as never;
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('sends nested field paths so the server keeps steps this screen never mentioned', async () => {
    // Offline the transactional merge cannot run, and a queued whole-object write
    // replaces the map at reconnect. Nested paths are merged by Firestore itself.
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });

    await updateSermonPreparationViaClient('sermon-prep-offline', {
      spiritual: { done: true },
    } as never);

    const written = store['sermon-prep-offline'] as unknown as Record<string, unknown>;
    expect(written['preparation.spiritual']).toEqual({ done: true });
    // The whole-map key was NOT written — that is what would have erased the phone.
    expect(written.preparation).toEqual({ exegetical: { notes: 'from the phone' } });
  });
});

/**
 * ONE PERSON, TWO DEVICES, HOURS APART — the case the whole mechanism exists for.
 *
 * The edit reaches the write as a WHOLE thought, so every field the person did not
 * touch travels along as whatever this screen happened to hold when it opened. Drag a
 * thought to another plan point on the laptop at noon and the laptop also re-sends the
 * text it read at eight — over the paragraph rewritten on the phone at nine. The
 * transaction does not help: it merges SIBLINGS correctly and then writes this stale
 * text as if it were an edit.
 */
describe('updateThoughtViaClient — an untouched field must not travel', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    store.s1 = {
      userId: 'u1',
      thoughts: [
        {
          id: 't1',
          // Rewritten on the phone at nine, after this screen opened.
          text: 'Rewritten on the phone, three paragraphs long',
          tags: ['mytag'],
          date: '2026-06-09T00:00:00.000Z',
        },
      ],
    };
  });

  const asOpened = {
    id: 't1',
    text: 'The old wording this screen opened with',
    tags: ['mytag'],
    date: '2026-06-09T00:00:00.000Z',
  };

  it('keeps the phone\'s text when this screen only moved the thought', async () => {
    // The person changed ONE thing: which plan point it belongs to.
    await updateThoughtViaClient(
      's1',
      { ...asOpened, outlinePointId: 'point-2' } as never,
      asOpened as never
    );

    expect(store.s1.thoughts[0].text).toBe('Rewritten on the phone, three paragraphs long');
    expect(store.s1.thoughts[0].outlinePointId).toBe('point-2');
  });

  it('still writes the text when the text is what changed', async () => {
    await updateThoughtViaClient(
      's1',
      { ...asOpened, text: 'Written here, deliberately' } as never,
      asOpened as never
    );

    expect(store.s1.thoughts[0].text).toBe('Written here, deliberately');
  });

  it('with an explicit null opening value behaves exactly as before', async () => {
    // No baseline means we cannot tell what the person touched; sending everything
    // is the old behaviour and must stay reachable, or callers that cannot supply a
    // baseline would silently stop saving. Stating `null` is how a caller asks for
    // it — the parameter is required precisely so this cannot happen by omission.
    await updateThoughtViaClient('s1', { ...asOpened, outlinePointId: 'point-2' } as never, null);

    expect(store.s1.thoughts[0].text).toBe('The old wording this screen opened with');
  });
});
