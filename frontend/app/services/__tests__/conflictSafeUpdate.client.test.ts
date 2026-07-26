import {
  conflictSafeUpdate,
  isStaleWriteError,
  isUnreachableWriteError,
  readRevision,
  StaleWriteError,
} from '@/services/conflictSafeUpdate.client';

type Stored = { rev?: Record<string, number>; [k: string]: unknown };
const store: Record<string, Stored> = {};

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

/** Hook so a test can simulate ANOTHER DEVICE committing inside the window. */
let onAttempt: ((attempt: number) => void) | null = null;
/** Set to make the transaction fail the way Firestore fails when unreachable. */
let transactionFailure: unknown = null;
const updateDocMock = jest.fn();

jest.mock('firebase/firestore', () => ({
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
    if (transactionFailure) throw transactionFailure;
    let attempt = 0;
    // The real SDK reruns the callback when the document changed mid-flight.
    for (;;) {
      attempt += 1;
      const writes: Array<{ id: string; payload: Record<string, unknown> }> = [];
      const snapshotAt = JSON.parse(JSON.stringify(store));
      const tx = {
        get: async (ref: { __id: string }) => ({
          exists: () => snapshotAt[ref.__id] !== undefined,
          data: () => snapshotAt[ref.__id],
        }),
        update: (ref: { __id: string }, payload: Record<string, unknown>) =>
          writes.push({ id: ref.__id, payload }),
      };
      onAttempt?.(attempt);
      await fn(tx);
      // Commit only if nothing changed since we read — otherwise rerun.
      const changed = JSON.stringify(store) !== JSON.stringify(snapshotAt);
      if (changed && attempt < 5) continue;
      writes.forEach(({ id, payload }) => {
        const target = (store[id] ??= {});
        Object.entries(payload).forEach(([key, value]) => {
          if (key.startsWith('rev.')) {
            target.rev = { ...(target.rev ?? {}), [key.slice(4)]: value as number };
          } else {
            target[key] = value;
          }
        });
      });
      return;
    }
  },
  doc: (_db: unknown, _collection: string, id: string) => ({ __id: id }),
  increment: (n: number) => ({ __increment: n }),
  updateDoc: (...args: unknown[]) => updateDocMock(...args),
}));

const ref = { __id: 'note-1' } as never;

describe('conflictSafeUpdate', () => {
  beforeEach(() => {
    onAttempt = null;
    transactionFailure = null;
    updateDocMock.mockReset();
    Object.keys(store).forEach((k) => delete store[k]);
    store['note-1'] = { content: 'server text' };
  });

  it('treats a missing counter as 0, so no migration is needed', () => {
    expect(readRevision({}, 'note')).toBe(0);
    expect(readRevision({ rev: { note: 7 } }, 'note')).toBe(7);
    expect(readRevision(undefined, 'note')).toBe(0);
  });

  it('writes and bumps the revision when the caller is up to date', async () => {
    const revision = await conflictSafeUpdate(ref, { content: 'my edit' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 0,
    });

    expect(revision).toBe(1);
    expect(store['note-1'].content).toBe('my edit');
    expect(store['note-1'].rev).toEqual({ note: 1 });
  });

  it('REFUSES a stale write and leaves the document untouched', async () => {
    // The phone already saved: the server moved to revision 1.
    store['note-1'] = { content: 'edited on the phone', rev: { note: 1 } };

    // The laptop still thinks it is at revision 0.
    await expect(
      conflictSafeUpdate(ref, { content: 'stale laptop text' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 0,
      })
    ).rejects.toBeInstanceOf(StaleWriteError);

    // THE POINT: the phone's text is still there.
    expect(store['note-1'].content).toBe('edited on the phone');
    expect(store['note-1'].rev).toEqual({ note: 1 });
  });

  it('reports the conflict in a form the UI can act on', async () => {
    store['note-1'] = { content: 'newer', rev: { note: 4 } };

    const error = await conflictSafeUpdate(ref, { content: 'older' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 2,
    }).catch((e) => e);

    expect(isStaleWriteError(error)).toBe(true);
    expect(error.aggregate).toBe('note');
    expect(error.expectedRevision).toBe(2);
    expect(error.actualRevision).toBe(4);
  });

  it('does not guard when the caller cannot state a revision — unchanged behaviour', async () => {
    store['note-1'] = { content: 'edited elsewhere', rev: { note: 9 } };

    await conflictSafeUpdate(ref, { content: 'unmigrated writer' }, 'missing', {
      aggregate: 'note',
      expectedRevision: null,
    });

    expect(store['note-1'].content).toBe('unmigrated writer');
  });

  it('counts aggregates separately, so unrelated parts never collide', async () => {
    store['note-1'] = { rev: { note: 3, materials: 8 } };

    await conflictSafeUpdate(ref, { content: 'body edit' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
    });

    expect(store['note-1'].rev).toEqual({ note: 4, materials: 8 });
  });

  it('catches a competing commit that lands INSIDE the transaction window', async () => {
    let injected = false;
    onAttempt = () => {
      if (injected) return;
      injected = true;
      // Another device commits after our read but before our write.
      store['note-1'] = { content: 'from the phone', rev: { note: 1 } };
    };

    await expect(
      conflictSafeUpdate(ref, { content: 'stale' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 0,
      })
    ).rejects.toBeInstanceOf(StaleWriteError);

    expect(store['note-1'].content).toBe('from the phone');
  });

  it('surfaces a missing document instead of creating one', async () => {
    delete store['note-1'];

    await expect(
      conflictSafeUpdate(ref, { content: 'x' }, 'Study note not found', {
        aggregate: 'note',
        expectedRevision: 0,
      })
    ).rejects.toThrow('Study note not found');
  });
});

/**
 * The same primitive now backs four services. These lock the contract they share:
 * a stated revision guards the write, an absent one leaves behaviour untouched.
 * (Notes are covered end-to-end in studies.revision.test.ts.)
 */
describe('the guard is shared, not copy-pasted per screen', () => {
  it('each aggregate advances on its own, so unrelated editors never collide', async () => {
    store['note-1'] = { rev: { core: 2, thoughts: 9, outline: 4 } };

    await conflictSafeUpdate(ref, { title: 'new title' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 2,
    });

    expect(store['note-1'].rev).toEqual({ core: 3, thoughts: 9, outline: 4 });
  });

  it('a second writer on a DIFFERENT aggregate is not blocked by the first', async () => {
    store['note-1'] = { rev: { core: 1, outline: 1 } };

    await conflictSafeUpdate(ref, { title: 'x' }, 'missing', { aggregate: 'core', expectedRevision: 1 });
    await conflictSafeUpdate(ref, { outline: 'y' }, 'missing', { aggregate: 'outline', expectedRevision: 1 });

    expect(store['note-1'].rev).toEqual({ core: 2, outline: 2 });
  });
});

/**
 * THE INVARIANT THE INTEGRATION MUST HOLD (found broken by review):
 * `expectedRevision` describes the text BEING SAVED — not the newest revision the
 * client has heard about. Advancing it from a listener while the editor still
 * shows the old text hands stale text a valid ticket, and the guard then destroys
 * the newer version it exists to protect.
 */
describe('a revision must describe the text being saved', () => {
  it('accepts when the stated revision matches — text and revision moved together', async () => {
    store['note-1'] = { content: 'R', rev: { note: 1 } };

    await conflictSafeUpdate(ref, { content: 'R + my edit' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 1,
    });

    expect(store['note-1'].content).toBe('R + my edit');
    expect(store['note-1'].rev).toEqual({ note: 2 });
  });

  it('REFUSES when the editor still holds text from an older revision', async () => {
    // The phone wrote R (rev 1). This tab never applied R — it still shows text
    // built from rev 0. Stating 0 is the honest answer, and it must be refused.
    store['note-1'] = { content: 'R from the phone', rev: { note: 1 } };

    await expect(
      conflictSafeUpdate(ref, { content: 'stale local text' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 0,
      })
    ).rejects.toBeInstanceOf(StaleWriteError);

    expect(store['note-1'].content).toBe('R from the phone');
  });
});

/**
 * OFFLINE. Transactions cannot run without the server, so a guarded save FAILS —
 * and that must stay a failure.
 *
 * An earlier version degraded to an ordinary queued `updateDoc` and reported
 * success. Adversarial review killed it: that patch was unconditional
 * last-write-wins, so on reconnect it overwrote whatever the other device had
 * stored, and because the caller saw "saved" it retired the durable draft for a
 * write the server had never seen. These tests now pin the SAFE behaviour —
 * nothing written, error surfaced — so the unsafe fallback cannot come back
 * unnoticed.
 */
describe('when the server cannot be reached', () => {
  beforeEach(() => {
    onAttempt = null;
    transactionFailure = null;
    updateDocMock.mockReset();
    Object.keys(store).forEach((k) => delete store[k]);
    store['note-1'] = { content: 'server text', rev: { note: 3 } };
  });

  it('does NOT write anything behind the guard', async () => {
    transactionFailure = Object.assign(
      new Error('Failed to get document because the client is offline'),
      { code: 'unavailable' }
    );

    await expect(
      conflictSafeUpdate(ref, { content: 'typed on a train' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 3,
      })
    ).rejects.toThrow(/offline/i);

    // THE POINT: no queued last-write-wins patch. On reconnect there is nothing
    // waiting to overwrite the other device.
    expect(updateDocMock).not.toHaveBeenCalled();
    expect(store['note-1'].content).toBe('server text');
  });

  it('reports unreachability distinctly, so the UI can say "no connection"', async () => {
    transactionFailure = Object.assign(new Error('backend unavailable'), { code: 'unavailable' });

    const error = await conflictSafeUpdate(ref, { content: 'x' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
    }).catch((e) => e);

    expect(isUnreachableWriteError(error)).toBe(true);
    // Not a conflict — the caller must not show a conflict choice for this.
    expect(isStaleWriteError(error)).toBe(false);
  });

  it('never turns a REFUSAL into a write', async () => {
    store['note-1'] = { content: 'from the phone', rev: { note: 9 } };

    await expect(
      conflictSafeUpdate(ref, { content: 'stale' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 3,
      })
    ).rejects.toBeInstanceOf(StaleWriteError);

    expect(updateDocMock).not.toHaveBeenCalled();
    expect(store['note-1'].content).toBe('from the phone');
  });

  it('lets a real failure surface unchanged', async () => {
    transactionFailure = Object.assign(new Error('Missing or insufficient permissions.'), {
      code: 'permission-denied',
    });

    await expect(
      conflictSafeUpdate(ref, { content: 'x' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 3,
      })
    ).rejects.toThrow('Missing or insufficient permissions.');

    expect(updateDocMock).not.toHaveBeenCalled();
  });
});

/**
 * OFFLINE, KNOWN IN ADVANCE. `navigator.onLine === false` means a transaction is
 * impossible, so we take the PRE-GUARD path on purpose: an ordinary write that
 * Firestore queues. It is awaited, so offline it simply does not settle — the
 * caller cannot mistake it for a completed save and cannot retire its draft.
 */
describe('when the browser already knows it is offline', () => {
  const originalOnLine = Object.getOwnPropertyDescriptor(Navigator.prototype, 'onLine');

  const setOnline = (value: boolean) =>
    Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });

  beforeEach(() => {
    onAttempt = null;
    transactionFailure = null;
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue(undefined);
    Object.keys(store).forEach((k) => delete store[k]);
    store['note-1'] = { content: 'server text', rev: { note: 3 } };
  });

  afterEach(() => {
    if (originalOnLine) Object.defineProperty(Navigator.prototype, 'onLine', originalOnLine);
  });

  it('queues the edit through the ordinary write instead of failing', async () => {
    setOnline(false);

    await conflictSafeUpdate(ref, { content: 'typed on a train' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
    });

    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, payload] = updateDocMock.mock.calls[0];
    expect(payload).toEqual({ content: 'typed on a train', 'rev.note': { __increment: 1 } });
  });

  it('goes back to the guarded transaction as soon as the browser is online', async () => {
    setOnline(true);

    await conflictSafeUpdate(ref, { content: 'typed at home' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
    });

    expect(updateDocMock).not.toHaveBeenCalled();
    expect(store['note-1'].content).toBe('typed at home');
    expect(store['note-1'].rev).toEqual({ note: 4 });
  });
});
