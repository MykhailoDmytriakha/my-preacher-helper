import {
  conflictSafeUpdate,
  isOfflineQueuedError,
  StaleWriteError,
} from '@/services/conflictSafeUpdate.client';
import { pendingOutboxConflicts, replayOutbox } from '@/services/outboxReplay.client';
import { listOutbox } from '@/services/writeOutbox.client';

/**
 * The last P0 of the second adversarial review: an offline save used to become an
 * unconditional last-write-wins patch that landed on reconnect and could silently
 * replace what another device had stored.
 *
 * The intent is queued instead, and replayed through the SAME compare-and-set. If
 * the server moved on, the replay is REFUSED and the text is kept for the person.
 */
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
// An intent belongs to the SIGNED-IN person, so the queue needs an authenticated
// user — without one nothing is queued, which is the cross-account protection.
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'u1' } } }));

const transaction = jest.fn();

jest.mock('firebase/firestore', () => ({
  increment: (n: number) => ({ __increment: n }),
  doc: (_db: unknown, collection: string, id: string) => ({ __path: `${collection}/${id}` }),
  runTransaction: (...args: unknown[]) => transaction(...args),
}));

const setOnline = (value: boolean) =>
  Object.defineProperty(window.navigator, 'onLine', { value, configurable: true });

const route = { uid: 'u1', collection: 'sermons', docId: 's1', savedAt: 1 };

describe('an offline save is queued, then replayed through the guard', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('writes NOTHING offline and tells the caller it is queued', async () => {
    setOnline(false);

    const error = await conflictSafeUpdate({} as never, { verse: 'typed on a train' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch((e) => e);

    expect(isOfflineQueuedError(error)).toBe(true);
    // No transaction was even attempted, and nothing was written unconditionally.
    expect(transaction).not.toHaveBeenCalled();

    const queued = listOutbox('u1');
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      patch: { verse: 'typed on a train' },
      baseRevision: 4,
      status: 'pending',
    });
  });

  it('replays with the revision it was BUILT FROM, not a fresh one', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'typed on a train' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ rev: { core: 4 } }) }),
        update: jest.fn(),
      });
    });

    const result = await replayOutbox('u1');

    expect(result).toMatchObject({ replayed: 1, conflicted: 0, failed: 0 });
    expect(listOutbox('u1')).toHaveLength(0);
  });

  it('REFUSES the replay when the server moved on, and keeps the text', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'typed on a train' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    // The other device wrote while we were away: the document is at revision 7.
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ rev: { core: 7 } }) }),
        update: jest.fn(),
      });
    });

    const result = await replayOutbox('u1');

    expect(result).toMatchObject({ replayed: 0, conflicted: 1, failed: 0 });
    // THE POINT: not written, not dropped — held for the person to decide.
    const conflicts = pendingOutboxConflicts('u1');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].patch).toEqual({ verse: 'typed on a train' });
    expect(conflicts[0].actualRevision).toBe(7);
  });

  it('keeps an entry that still cannot reach the server', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'x' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    transaction.mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' }));

    const result = await replayOutbox('u1');

    expect(result).toMatchObject({ replayed: 0, conflicted: 0, failed: 1 });
    expect(listOutbox('u1')).toHaveLength(1);
  });

  it('does not silently re-send an intent the server already refused', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'x' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({ get: async () => ({ exists: () => true, data: () => ({ rev: { core: 9 } }) }), update: jest.fn() });
    });
    await replayOutbox('u1');
    transaction.mockClear();

    // A second reconnect must NOT try again: re-sending with a fresh revision
    // would be exactly the silent overwrite this exists to prevent.
    const second = await replayOutbox('u1');

    expect(transaction).not.toHaveBeenCalled();
    expect(second).toMatchObject({ replayed: 0, conflicted: 0, failed: 0 });
  });
});

/** Guard against an accidental import cycle regressing to a stale-write path. */
describe('StaleWriteError still carries what the UI needs', () => {
  it('reports both revisions', () => {
    const error = new StaleWriteError('core', 4, 7);
    expect(error.expectedRevision).toBe(4);
    expect(error.actualRevision).toBe(7);
  });
});

/**
 * A person offline saves the same document twice — the title, then the verse.
 * Both intents carry the same base revision, so a literal replay commits the
 * first and refuses the rest AGAINST THE PERSON'S OWN SAVE seconds earlier. That
 * false conflict is worse than useless: it teaches people to click through.
 */
describe('a person\'s own queued edits do not conflict with each other', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  it('rebases each follow-up intent onto what this run just committed', async () => {
    setOnline(false);
    for (const patch of [{ title: 'first' }, { verse: 'second' }]) {
      await conflictSafeUpdate({} as never, patch, 'missing', {
        aggregate: 'core',
        expectedRevision: 4,
        outboxRoute: route,
      }).catch(() => {});
    }
    expect(listOutbox('u1')).toHaveLength(2);

    setOnline(true);
    // The document really advances as each intent commits.
    let stored = 4;
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ rev: { core: stored } }) }),
        update: jest.fn(),
      });
      stored += 1;
    });

    const result = await replayOutbox('u1');

    // BOTH land. Without rebasing, the second would come back as a conflict.
    expect(result).toMatchObject({ replayed: 2, conflicted: 0, failed: 0 });
    expect(listOutbox('u1')).toHaveLength(0);
  });

  it('keeps protecting a field the phone rewrote while an earlier intent rebased', async () => {
    // THE HUMAN CASE. On a train the laptop saves the title and then the verse —
    // two intents, same aggregate, same base revision. At home, before the laptop
    // reconnects, the phone rewrites the verse. On reconnect the title commits and
    // moves the revision; the verse intent is rebased onto that new number, which is
    // right. What must NOT happen is losing its content check along the way: it then
    // overwrites the phone's verse without a word. Only the fields THIS run wrote
    // (the title) may skip the check.
    setOnline(false);
    for (const patch of [{ title: 'title typed on the train' }, { verse: 'verse typed on the train' }]) {
      await conflictSafeUpdate({} as never, patch, 'missing', {
        aggregate: 'core',
        expectedRevision: 4,
        outboxRoute: route,
        expectedBaseline: { title: 'title as it was', verse: 'verse as it was' },
      }).catch(() => {});
    }

    setOnline(true);
    let stored: Record<string, unknown> = {
      title: 'title as it was',
      // The phone rewrote the verse while the laptop was on the train.
      verse: 'verse rewritten on the phone',
      rev: { core: 5 },
    };
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => stored }),
        update: (_ref: unknown, patch: Record<string, unknown>) => {
          stored = { ...stored, ...patch, rev: { core: (stored.rev as { core: number }).core + 1 } };
        },
      });
    });

    const result = await replayOutbox('u1');

    // The title lands (nobody else touched it); the verse is REFUSED and kept.
    expect(result).toMatchObject({ replayed: 1, conflicted: 1 });
    expect(stored.verse).toBe('verse rewritten on the phone');
    const left = listOutbox('u1');
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ patch: { verse: 'verse typed on the train' }, status: 'conflicted' });
  });

  it('still refuses when the OTHER device moved the document', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { title: 'mine' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ rev: { core: 9 } }) }),
        update: jest.fn(),
      });
    });

    expect(await replayOutbox('u1')).toMatchObject({ replayed: 0, conflicted: 1, failed: 0 });
  });
});

/**
 * Two things a person WILL hit, hours or days after the fact.
 */
describe('replay is honest about time and about dead documents', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  it('stamps a FRESH updatedAt instead of replaying a days-old one', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'x', updatedAt: '2020-01-01T00:00:00.000Z' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    let written: Record<string, unknown> = {};
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ rev: { core: 4 } }) }),
        update: (_ref: unknown, payload: Record<string, unknown>) => {
          written = payload;
        },
      });
    });

    await replayOutbox('u1');

    // Monday's timestamp would bury the document at the bottom of "recent".
    expect(written.updatedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('turns a DELETED document into a visible choice, not an endless retry', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'written on the train' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
    }).catch(() => {});

    setOnline(true);
    // The other device deleted the sermon while this edit waited.
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({ get: async () => ({ exists: () => false, data: () => undefined }), update: jest.fn() });
    });

    const first = await replayOutbox('u1');
    expect(first).toMatchObject({ replayed: 0, conflicted: 1, failed: 0 });

    // And it does NOT keep hammering a dead target every minute.
    transaction.mockClear();
    await replayOutbox('u1');
    expect(transaction).not.toHaveBeenCalled();

    // The text is still there for the person.
    expect(pendingOutboxConflicts('u1')[0].patch).toEqual({ verse: 'written on the train' });
  });
});

/**
 * Near the storage quota the conflict record — slightly larger than the pending one —
 * could fail to save while the caller assumed it had worked. The entry then stayed
 * pending and was refused again every minute, never becoming a choice.
 */
describe('a refusal that cannot be recorded is not reported as resolved', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('drops the opening values to make the conflict record fit', async () => {
    setOnline(false);
    await conflictSafeUpdate({} as never, { verse: 'typed on a train' }, 'missing', {
      aggregate: 'core',
      expectedRevision: 4,
      outboxRoute: route,
      expectedBaseline: { verse: 'a very long opening value '.repeat(40) },
    }).catch(() => {});

    setOnline(true);
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => ({ verse: 'phone wrote this', rev: { core: 9 } }) }),
        update: jest.fn(),
      });
    });

    // The FULL conflict record is refused; the compact one (without the opening
    // values) is accepted.
    const realSetItem = Storage.prototype.setItem;
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function (this: Storage, key: string, value: string) {
        if (value.includes('a very long opening value') && value.includes('conflicted')) {
          throw new Error('QuotaExceededError');
        }
        realSetItem.call(this, key, value);
      });

    try {
      const result = await replayOutbox('u1');
      expect(result).toMatchObject({ conflicted: 1, failed: 0 });
    } finally {
      setItem.mockRestore();
    }

    const left = listOutbox('u1');
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe('conflicted');
    // The TEXT is still there; only the opening values were sacrificed.
    expect(left[0].patch).toEqual({ verse: 'typed on a train' });
  });
});

/**
 * THE PLAN IS ORDERED, so no commutative Firestore operation can protect it offline.
 * The writer therefore queues the OPERATION plus what the editor started from, and
 * the replay redoes the merge against whatever the server holds by then.
 */
describe('a queued plan intent is REPLAYED as a merge, not as a patch', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('re-runs the merge so a point added elsewhere survives the reconnect', async () => {
    const { updateSermonOutlineViaClient } = await import('@/services/sermons.client');
    setOnline(false);

    // On the train: the laptop edits its own point, starting from a one-point plan.
    await updateSermonOutlineViaClient(
      's1',
      { introduction: [], main: [{ id: 'p1', text: 'edited on the train' }], conclusion: [] },
      { baseOutline: { introduction: [], main: [{ id: 'p1', text: 'Grace' }], conclusion: [] } }
    );

    const queued = listOutbox('u1');
    expect(queued).toHaveLength(1);
    expect(queued[0].merge?.kind).toBe('outline');

    // At home the phone added a point. Now the laptop reconnects.
    setOnline(true);
    let stored: Record<string, unknown> = {
      outline: {
        introduction: [],
        main: [{ id: 'p1', text: 'Grace' }, { id: 'phone', text: 'added on the phone' }],
        conclusion: [],
      },
      rev: { outline: 1 },
    };
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => stored }),
        update: (_ref: unknown, patch: Record<string, unknown>) => {
          stored = { ...stored, ...patch };
        },
      });
    });

    const result = await replayOutbox('u1');

    expect(result.replayed).toBe(1);
    const merged = (stored.outline as { main: Array<{ id: string }> }).main.map((p) => p.id).sort();
    // BOTH survive: the laptop's edit and the point it never saw.
    expect(merged).toEqual(['p1', 'phone']);
    expect(listOutbox('u1')).toHaveLength(0);
  });
});

describe('the arrangement is queued as an intent too', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('re-runs the section merge so a thought created elsewhere is not dropped', async () => {
    const { updateStructureViaClient } = await import('@/services/sermons.client');
    setOnline(false);

    await updateStructureViaClient('s1', {
      introduction: [],
      main: ['t1'],
      conclusion: [],
    } as never);

    const queued = listOutbox('u1');
    expect(queued).toHaveLength(1);
    expect(queued[0].merge?.kind).toBe('structure');

    setOnline(true);
    let stored: Record<string, unknown> = {
      thoughtsBySection: { introduction: ['t1'], main: [], conclusion: ['from-the-phone'] },
      rev: { thoughts: 1 },
    };
    transaction.mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<void>) => {
      await fn({
        get: async () => ({ exists: () => true, data: () => stored }),
        update: (_ref: unknown, patch: Record<string, unknown>) => {
          stored = { ...stored, ...patch };
        },
      });
    });

    expect((await replayOutbox('u1')).replayed).toBe(1);

    const merged = stored.thoughtsBySection as { main: string[]; conclusion: string[] };
    expect(merged.main).toEqual(['t1']);
    // The thought this screen never knew about is still placed.
    expect(merged.conclusion).toEqual(['from-the-phone']);
  });
});

/**
 * The three failure paths that used to fall back to writing a COMPUTED value: known
 * offline, transport dead while the browser thinks it is online, and no room in the
 * queue. All three now save the OPERATION or fail visibly — never a cached merge.
 */
describe('every failure path saves the operation, never the computed value', () => {
  beforeEach(() => {
    localStorage.clear();
    transaction.mockReset();
  });

  afterEach(() => {
    delete (window.navigator as unknown as Record<string, unknown>).onLine;
  });

  it('a TEXT EDIT of a note offline becomes an intent, not a whole-array write', async () => {
    const { addScratchNoteViaClient } = await import('@/services/sermons.client');
    setOnline(false);
    const base = [{ id: 'a', text: 'original', createdAt: '2026-07-01T00:00:00.000Z' }];
    const mine = [{ id: 'a', text: 'edited on the train', createdAt: '2026-07-01T00:00:00.000Z' }];

    await addScratchNoteViaClient('s1', mine as never, base as never);

    const queued = listOutbox('u1');
    expect(queued).toHaveLength(1);
    expect(queued[0].merge?.kind).toBe('scratch');
  });

  it('a captive portal queues the plan OPERATION instead of a cached merge', async () => {
    const { updateSermonOutlineViaClient } = await import('@/services/sermons.client');
    // The browser believes it is online; the transaction cannot reach the server.
    setOnline(true);
    transaction.mockImplementation(() => {
      throw Object.assign(new Error('backend unavailable'), { code: 'unavailable' });
    });

    await updateSermonOutlineViaClient(
      's1',
      { introduction: [], main: [{ id: 'p1', text: 'typed behind a portal' }], conclusion: [] },
      { baseOutline: { introduction: [], main: [], conclusion: [] } }
    );

    const queued = listOutbox('u1');
    expect(queued).toHaveLength(1);
    expect(queued[0].merge?.kind).toBe('outline');
  });

  it('says the save did not happen when the queue has no room', async () => {
    const { updateSermonOutlineViaClient, isUnsavedMergeError } = await import(
      '@/services/sermons.client'
    );
    setOnline(false);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    try {
      const error = await updateSermonOutlineViaClient(
        's1',
        { introduction: [], main: [], conclusion: [] },
        { baseOutline: null }
      ).catch((e) => e);
      // NOT a computed write queued behind the person's back.
      expect(isUnsavedMergeError(error)).toBe(true);
    } finally {
      setItem.mockRestore();
    }
  });
});
