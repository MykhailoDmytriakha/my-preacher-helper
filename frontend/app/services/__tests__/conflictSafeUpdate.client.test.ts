import {
  conflictSafeUpdate,
  isStaleWriteError,
  isUnreachableWriteError,
  isWriteRefusedError,
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

    const error = await conflictSafeUpdate(ref, { content: 'x' }, 'Study note not found', {
      aggregate: 'note',
      expectedRevision: 0,
    }).catch((caught) => caught);

    expect(error).toMatchObject({
      message: 'Study note not found',
      code: 'not-found',
    });
    expect(isWriteRefusedError(error)).toBe(true);
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

  it('writes NOTHING and lets the transaction fail when it has no outbox route', async () => {
    // Without a route there is nothing to replay under, so the write must simply
    // not happen. It must NEVER become an unconditional queued patch: that would
    // land on reconnect and could replace what another device stored.
    setOnline(false);
    transactionFailure = Object.assign(new Error('client is offline'), { code: 'unavailable' });

    await expect(
      conflictSafeUpdate(ref, { content: 'typed on a train' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 3,
      })
    ).rejects.toThrow(/offline/i);

    expect(updateDocMock).not.toHaveBeenCalled();
    expect(store['note-1'].content).toBe('server text');
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

/**
 * THE COUNTER IS ONLY AS HONEST AS ITS WRITERS.
 *
 * An old build still installed on someone's phone changes content and leaves the
 * number alone. The comparison above then sees "nobody moved" and hands a stale
 * save permission to overwrite. Enforcing the counter in Security Rules would lock
 * those clients out — a rollout decision. Comparing the CONTENT closes the same
 * hole from this side, needing nobody's cooperation.
 */
describe('the guard also asks the content, not only the counter', () => {
  beforeEach(() => {
    onAttempt = null;
    transactionFailure = null;
    updateDocMock.mockReset();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('REFUSES when the field changed without the counter moving', () => {
    // Revision still 3 — but the text is not what this caller started from.
    store['note-1'] = { content: 'written by an old build', rev: { note: 3 } };

    return expect(
      conflictSafeUpdate(ref, { content: 'my stale text' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 3,
        expectedBaseline: { content: 'what I opened with' },
      })
    ).rejects.toBeInstanceOf(StaleWriteError);
  });

  it('writes when the content is exactly what the caller started from', async () => {
    store['note-1'] = { content: 'what I opened with', rev: { note: 3 } };

    await conflictSafeUpdate(ref, { content: 'my edit' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
      expectedBaseline: { content: 'what I opened with' },
    });

    expect(store['note-1'].content).toBe('my edit');
  });

  it('does not manufacture a conflict from an UNRELATED field', async () => {
    // The verse changed elsewhere; we are writing the title. False conflicts train
    // people to click through the dialog, so only the written fields are compared.
    store['note-1'] = { title: 'same title', verse: 'changed elsewhere', rev: { note: 3 } };

    await conflictSafeUpdate(ref, { title: 'my new title' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
      expectedBaseline: { title: 'same title' },
    });

    expect(store['note-1'].title).toBe('my new title');
  });

  it('checks only the counter when no fingerprint is supplied — unchanged behaviour', async () => {
    store['note-1'] = { content: 'changed by an old build', rev: { note: 3 } };

    await conflictSafeUpdate(ref, { content: 'my text' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 3,
    });

    expect(store['note-1'].content).toBe('my text');
  });
});

/**
 * FALSE CONFLICTS ARE A REAL HARM, not a cosmetic one: a person who meets two or
 * three of them learns to press "keep mine" without reading, and then presses it
 * through the one that mattered. The counter covers the whole aggregate, so it
 * moves when ANY field changes — including fields this write never touches.
 */
describe('an unrelated change in the same aggregate must not refuse the write', () => {
  beforeEach(() => {
    onAttempt = null;
    transactionFailure = null;
    updateDocMock.mockReset();
    Object.keys(store).forEach((k) => delete store[k]);
  });

  it('writes when the counter MOVED but our own field is untouched', async () => {
    // The phone toggled `isPreached`: rev.core 4 → 5. We are saving the title,
    // which nobody has touched.
    store['note-1'] = { title: 'as I found it', isPreached: true, rev: { note: 5 } };

    await conflictSafeUpdate(ref, { title: 'my new title' }, 'missing', {
      aggregate: 'note',
      expectedRevision: 4,
      expectedBaseline: { title: 'as I found it' },
    });

    expect(store['note-1'].title).toBe('my new title');
    // The other device's change survives untouched.
    expect(store['note-1'].isPreached).toBe(true);
  });

  it('still REFUSES when our own field is the one that changed', async () => {
    store['note-1'] = { title: 'rewritten on the phone', rev: { note: 5 } };

    await expect(
      conflictSafeUpdate(ref, { title: 'my stale title' }, 'missing', {
        aggregate: 'note',
        expectedRevision: 4,
        expectedBaseline: { title: 'as I found it' },
      })
    ).rejects.toBeInstanceOf(StaleWriteError);

    expect(store['note-1'].title).toBe('rewritten on the phone');
  });
});
