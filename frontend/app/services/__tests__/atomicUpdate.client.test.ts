/**
 * Durability floor for atomicUpdate.
 *
 * The transaction path needs the server and never enters Firestore's durable
 * mutation queue. `navigator.onLine` lies (captive portal, flaky wifi), so the
 * transaction path can be taken while the server is unreachable. If that
 * rejection propagated, callers would roll back their optimistic state and the
 * user's typed edit would be GONE — strictly worse than the pre-transaction
 * behaviour, where updateDoc was queued locally and replayed on reconnect.
 * These tests lock the fallback, and lock that real errors still surface.
 */
const store: Record<string, { thoughts: { id: string }[] }> = {};
let transactionError: (Error & { code?: string }) | null = null;
const updateDocCalls: { id: string; payload: Record<string, unknown> }[] = [];

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

jest.mock('firebase/firestore', () => ({
  getDoc: async (ref: { __id: string }) => ({
    exists: () => store[ref.__id] !== undefined,
    data: () => store[ref.__id],
  }),
  updateDoc: async (ref: { __id: string }, payload: Record<string, unknown>) => {
    updateDocCalls.push({ id: ref.__id, payload });
    store[ref.__id] = {
      ...store[ref.__id],
      ...(payload as { thoughts: { id: string }[] }),
    };
  },
  runTransaction: async (
    _db: unknown,
    fn: (tx: {
      get: (ref: { __id: string }) => Promise<unknown>;
      update: (ref: { __id: string }, payload: Record<string, unknown>) => void;
    }) => Promise<void>
  ) => {
    if (transactionError) throw transactionError;
    return fn({
      get: async (ref) => ({
        exists: () => store[ref.__id] !== undefined,
        data: () => store[ref.__id],
      }),
      update: (ref, payload) => {
        store[ref.__id] = {
      ...store[ref.__id],
      ...(payload as { thoughts: { id: string }[] }),
    };
      },
    });
  },
}));

import { atomicUpdate } from '@/services/atomicUpdate.client';

const ref = { __id: 's1' } as never;
const appendThought = (id: string) => (doc: { thoughts?: { id: string }[] }) => ({
  thoughts: [...(doc.thoughts ?? []), { id }],
});

const firestoreError = (code: string) => {
  const e = new Error(`simulated ${code}`) as Error & { code?: string };
  e.code = code;
  return e;
};

describe('atomicUpdate durability floor', () => {
  const setVisibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  };

  beforeEach(() => {
    setVisibility('visible');
    for (const k of Object.keys(store)) delete store[k];
    store.s1 = { thoughts: [] };
    updateDocCalls.length = 0;
    transactionError = null;
  });

  it('commits through the transaction when the server is reachable', async () => {
    await atomicUpdate(ref, appendThought('a'), 'missing');
    expect(store.s1.thoughts.map((t) => t.id)).toEqual(['a']);
    expect(updateDocCalls).toHaveLength(0); // no queued write needed
  });

  it.each(['unavailable', 'deadline-exceeded'])(
    'retries as a queued write on transient failure (%s) when the caller OPTS IN',
    async (code) => {
      transactionError = firestoreError(code);

      await expect(
        atomicUpdate(ref, appendThought('typed-by-user'), 'missing', {
          retryTransientAsQueuedWrite: true,
        })
      ).resolves.toBeUndefined();

      // The write reached the durable path instead of vanishing.
      expect(updateDocCalls).toHaveLength(1);
      expect(store.s1.thoughts.map((t) => t.id)).toEqual(['typed-by-user']);
    }
  );

  // A transient error does NOT mean "did not commit": `deadline-exceeded` can
  // arrive after a successful write. Replaying a replace/merge would then bring
  // back stale field values over a newer edit, so retry is OPT-IN and off here.
  it.each(['unavailable', 'deadline-exceeded'])(
    'does NOT replay a transient failure (%s) by default — no silent overwrite path',
    async (code) => {
      transactionError = firestoreError(code);

      await expect(atomicUpdate(ref, appendThought('x'), 'missing')).rejects.toThrow(
        `simulated ${code}`
      );
      expect(updateDocCalls).toHaveLength(0);
    }
  );

  // `internal` means a broken backend/SDK invariant — degrading to a weaker write
  // would hide a real defect, so it must surface like any application error.
  it.each(['permission-denied', 'aborted', 'failed-precondition', 'internal'])(
    'does NOT swallow a real error (%s) — callers must see it',
    async (code) => {
      transactionError = firestoreError(code);

      await expect(atomicUpdate(ref, appendThought('x'), 'missing')).rejects.toThrow(`simulated ${code}`);
      expect(updateDocCalls).toHaveLength(0);
    }
  );

  it('propagates an application error thrown inside the mutator', async () => {
    await expect(
      atomicUpdate(ref, () => {
        throw new Error('Thought not found in sermon');
      }, 'missing')
    ).rejects.toThrow('Thought not found in sermon');
  });

  it('throws the not-found message when the document is absent', async () => {
    delete (store as Record<string, unknown>).s1;
    await expect(atomicUpdate(ref, appendThought('a'), 'Sermon not found')).rejects.toThrow(
      'Sermon not found'
    );
  });

  it('writes nothing when the mutator returns null (replay no-op)', async () => {
    await atomicUpdate(ref, () => null, 'missing');
    expect(store.s1.thoughts).toEqual([]);
    expect(updateDocCalls).toHaveLength(0);
  });
  // Page visibility must NOT weaken the write path: `hidden` also means
  // "background tab" or "locked screen", so bypassing the transaction there would
  // silently reopen the lost-update race for anyone who switches tabs while a
  // debounced save is pending. Durability for a killed page needs a durable
  // intent (outbox), which is tracked as still-open work.
  it('keeps using the transaction while the page is HIDDEN (no weaker write)', async () => {
    setVisibility('hidden');

    await atomicUpdate(ref, appendThought('typed-in-background'), 'missing');

    expect(updateDocCalls).toHaveLength(0); // transaction used, not the queued path
    expect(store.s1.thoughts.map((t) => t.id)).toEqual(['typed-in-background']);
  });

});
