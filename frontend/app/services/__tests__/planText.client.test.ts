import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { savePlanTextViaClient } from '@/services/sermons.client';

/**
 * TWO INVARIANTS, AND THE PLAN'S TEXT IS ONLY SAFE WITH BOTH.
 *
 * LEAF PATHS. `planText.<nodeId>` merges into the stored map, leaving every other node alone —
 * that is what stops one card's save from erasing another. Write `planText` as a whole object
 * even once and the property is gone: the map is replaced and the other nodes go with it. The
 * mistake looks harmless in review — one object instead of several keys — so it is pinned here.
 *
 * A STATED BASELINE. Separate keys were briefly mistaken for safety, and they are not: two
 * devices editing THE SAME node still race, and the later write won with nothing reported. So
 * each node's save says what it found there, and the guard refuses when the server disagrees.
 * Per NODE and not per aggregate, because the plan's counter moves whenever any point is
 * saved — judging by it would refuse an edit to point two because point one was saved on the
 * phone, and false conflicts teach people to click through the real one.
 */

/** Ordinary writes: `updateDoc`. Guarded ones land in `transactionWrites`. */
const writes: Record<string, unknown>[] = [];
const transactionWrites: Record<string, unknown>[] = [];
let storedDocument: Record<string, unknown> = {};

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, _collection: string, id: string) => ({ __id: id }),
  updateDoc: async (_ref: unknown, payload: Record<string, unknown>) => {
    writes.push(payload);
  },
  runTransaction: async (
    _db: unknown,
    body: (tx: {
      get: (ref: unknown) => Promise<{ exists: () => boolean; data: () => Record<string, unknown> }>;
      update: (ref: unknown, payload: Record<string, unknown>) => void;
    }) => Promise<void>
  ) => {
    await body({
      get: async () => ({ exists: () => true, data: () => storedDocument }),
      update: (_ref, payload) => { transactionWrites.push(payload); },
    });
  },
  deleteField: () => '__DELETE__',
  increment: (n: number) => ({ __increment: n }),
  arrayUnion: jest.fn(),
  arrayRemove: jest.fn(),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  getDoc: jest.fn(),
  serverTimestamp: () => '__NOW__',
}));

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('@/services/firebaseAuth.service', () => ({ auth: { currentUser: { uid: 'user-1' } } }));

describe('savePlanTextViaClient', () => {
  beforeEach(() => {
    writes.length = 0;
    transactionWrites.length = 0;
    storedDocument = {};
  });

  it('addresses each node on its own key, never the whole map', async () => {
    await savePlanTextViaClient('sermon-1', { p1: 'Body one', s1: 'Sub body' });

    expect(transactionWrites).toHaveLength(1);
    const payload = transactionWrites[0];

    expect(payload['planText.p1']).toBe('Body one');
    expect(payload['planText.s1']).toBe('Sub body');

    // The guard: writing the map itself would replace every other node's text.
    expect(Object.keys(payload)).not.toContain('planText');
  });

  it('leaves untouched nodes entirely unmentioned', async () => {
    await savePlanTextViaClient('sermon-1', { p1: 'Only this one' });

    const keys = Object.keys(transactionWrites[0]).filter((key) => key.startsWith('planText'));
    expect(keys).toEqual(['planText.p1']);
  });

  it('advances the plan revision counter so staleness stays detectable', async () => {
    storedDocument = { rev: { plan: 4 } };

    await savePlanTextViaClient('sermon-1', { p1: 'Body' });

    expect(transactionWrites[0]['rev.plan']).toBe(5);
  });

  it('writes emptiness as emptiness — clearing a cell is a real edit', async () => {
    await savePlanTextViaClient('sermon-1', { p1: '' });

    expect(transactionWrites[0]['planText.p1']).toBe('');
  });

  describe('the stated baseline', () => {
    it('writes when the server still holds what the screen started from', async () => {
      storedDocument = { planText: { p1: 'as opened' } };

      await savePlanTextViaClient('sermon-1', { p1: 'my edit' }, [], {
        baselineByNodeId: { p1: 'as opened' },
      });

      expect(transactionWrites[0]['planText.p1']).toBe('my edit');
    });

    /**
     * THE WHOLE POINT. Without the field-path reader in `conflictSafeUpdate` this passes for
     * the wrong reason: `stored['planText.p1']` finds nothing, so both sides compare as null
     * and every save is either always refused or never — a guard in name only.
     */
    it('refuses a save built from text the server no longer holds', async () => {
      storedDocument = { planText: { p1: 'written on the phone' } };

      const error = await savePlanTextViaClient('sermon-1', { p1: 'laptop copy' }, [], {
        baselineByNodeId: { p1: 'as opened' },
      }).catch((caught) => caught);

      expect(isStaleWriteError(error)).toBe(true);
      expect(transactionWrites).toHaveLength(0);
    });

    it('treats a node created elsewhere as a difference, not as a match', async () => {
      storedDocument = { planText: { p1: 'appeared while we were away' } };

      const error = await savePlanTextViaClient('sermon-1', { p1: 'my first words' }, [], {
        // Nothing was there when this screen opened.
        baselineByNodeId: {},
      }).catch((caught) => caught);

      expect(isStaleWriteError(error)).toBe(true);
    });

    /**
     * A SIBLING'S EDIT IS NOT THIS NODE'S CONFLICT. The counter has moved — the phone saved
     * point one — but point two is untouched, and refusing here would be the false conflict
     * that trains people to dismiss the real one.
     */
    it('lets one point be saved while another was edited elsewhere', async () => {
      storedDocument = {
        rev: { plan: 9 },
        planText: { p1: 'rewritten on the phone', p2: 'as opened' },
      };

      await savePlanTextViaClient('sermon-1', { p2: 'my edit' }, [], {
        baselineByNodeId: { p2: 'as opened' },
      });

      expect(transactionWrites[0]['planText.p2']).toBe('my edit');
    });

    it('writes unguarded when the caller cannot say what it started from', async () => {
      storedDocument = { planText: { p1: 'anything at all' } };

      await savePlanTextViaClient('sermon-1', { p1: 'no baseline stated' });

      expect(transactionWrites[0]['planText.p1']).toBe('no baseline stated');
    });
  });

  describe('removing the text of a deleted node', () => {
    it('removes the key outright instead of blanking it', async () => {
      await savePlanTextViaClient('sermon-1', {}, ['gone-1', 'gone-2']);

      const payload = writes[0];
      expect(payload['planText.gone-1']).toBe('__DELETE__');
      expect(payload['planText.gone-2']).toBe('__DELETE__');
      expect(payload['rev.plan']).toEqual({ __increment: 1 });
    });

    /**
     * CLEANUP TRAVELS ON ITS OWN, and it has to.
     *
     * An offline guarded write is stored in the outbox as JSON, and `deleteField()` is a
     * sentinel OBJECT: it survives `JSON.stringify` as an ordinary map and would replay as
     * "write this junk here" rather than "remove this". Refusing it would also be wrong — the
     * node is already gone from the structure and nothing reads its text.
     */
    it('never rides inside the guarded write', async () => {
      await savePlanTextViaClient('sermon-1', { p1: 'kept' }, ['gone-1'], {
        baselineByNodeId: { p1: null },
      });

      expect(Object.keys(transactionWrites[0])).not.toContain('planText.gone-1');
      expect(writes[0]['planText.gone-1']).toBe('__DELETE__');
    });
  });
});
