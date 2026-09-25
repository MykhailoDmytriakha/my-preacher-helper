import { adminDb } from '@/config/firebaseAdminConfig';
import { deleteTag } from '@clients/firestore.client';

/**
 * DELETING A TAG MUST NOT SWALLOW A THOUGHT DICTATED MEANWHILE.
 *
 * The cascade reads every sermon of the user, strips the tag in memory and writes the
 * WHOLE `thoughts` array back. Everything stored between that read and that write is
 * replaced — and this one runs across ALL of the person's sermons at once, so a single
 * tag deletion in Settings can erase a thought captured on the phone a second earlier.
 *
 * It also left `rev.thoughts` alone, so the counter lied: a later save built on older
 * text still looked up to date and was granted permission to overwrite.
 *
 * Stripping a tag is idempotent — repeating it changes nothing — so a transaction is
 * safe here: the SDK may re-run the callback, and each run recomputes from fresh data.
 */

const store: Record<string, { userId: string; thoughts: Array<{ id: string; tags: string[] }>; rev?: Record<string, number> }> = {};

/** What a device stored AFTER the cascade took its snapshot. */
let landsAfterRead: (() => void) | null = null;

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
    batch: jest.fn(),
    runTransaction: jest.fn(),
  },
}));

const sermonRef = (id: string) => ({ id, __id: id });

function wireAdminDb() {
  (adminDb.collection as jest.Mock).mockImplementation((name: string) => {
    if (name === 'tags') {
      const doc = jest.fn(() => ({ delete: jest.fn().mockResolvedValue(undefined) }));
      const get = jest.fn().mockResolvedValue({ empty: false, docs: [{ id: 'tag-1' }] });
      return { where: () => ({ where: () => ({ limit: () => ({ __kind: 'tags', get }) }) }), doc };
    }
    // sermons — read as `where().limit()` inside a transaction or `where().get()` outside one
    const read = { __kind: 'sermons', get: jest.fn(async () => {
          const docs = Object.entries(store).map(([id, data]) => {
            // FROZEN HERE, deliberately. Returning a lazy `data()` would read the
            // store at call time and quietly pick up the other device's write — the
            // test would pass while the race it exists to prove never happened.
            const frozen = JSON.parse(JSON.stringify(data));
            return { id, ref: sermonRef(id), data: () => frozen };
          });
          // The other device commits right after this read.
          landsAfterRead?.();
          return { empty: docs.length === 0, forEach: (fn: (d: unknown) => void) => docs.forEach(fn), docs };
        }) };
    return {
      where: () => ({ limit: () => read, get: read.get }),
      doc: (id: string) => sermonRef(id),
    };
  });

  (adminDb.batch as jest.Mock).mockImplementation(() => {
    const writes: Array<{ id: string; payload: Record<string, unknown> }> = [];
    return {
      update: (ref: { __id: string }, payload: Record<string, unknown>) =>
        writes.push({ id: ref.__id, payload }),
      commit: jest.fn(async () => {
        writes.forEach(({ id, payload }) => applyPayload(id, payload));
      }),
    };
  });

  (adminDb.runTransaction as jest.Mock).mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      let raced = false;
      let updates: Array<{ ref: { __id: string }; payload: Record<string, unknown> }> = [];
      const tx = {
        get: async (ref: { __id?: string; __kind?: string }) => {
          if (ref.__kind === 'tags') return { empty: false, docs: [{ id: 'tag-1', ref: sermonRef('tag-1'), data: () => ({ userId: 'u1', name: 'Examples', required: false }) }] };
          if (ref.__kind === 'sermons') {
            const docs = Object.entries(store).map(([id, data]) => {
              const frozen = JSON.parse(JSON.stringify(data)); return { id, ref: sermonRef(id), data: () => frozen };
            });
            if (landsAfterRead) { raced = true; landsAfterRead(); }
            return { empty: docs.length === 0, docs };
          }
          return { exists: Boolean(ref.__id && store[ref.__id]), data: () => JSON.parse(JSON.stringify(ref.__id ? store[ref.__id] : undefined)), ref };
        },
        update: (ref: { __id: string }, payload: Record<string, unknown>) => updates.push({ ref, payload }),
        delete: (_ref: { __id?: string }) => undefined,
      };
      await fn(tx);
      // Firestore reruns a transaction whose query read raced a concurrent write.
      // Discard the first attempt's staged writes so the retry reads the new thought.
      if (raced) { updates = []; raced = false; await fn(tx); }
      updates.forEach(({ ref, payload }) => applyPayload(ref.__id, payload));
    }
  );
}

function applyPayload(id: string, payload: Record<string, unknown>) {
  const target = store[id];
  Object.entries(payload).forEach(([key, value]) => {
    if (key.startsWith('rev.')) {
      const field = key.slice(4);
      const increment = (value as { __increment?: number })?.__increment ?? 1;
      target.rev = { ...(target.rev ?? {}), [field]: (target.rev?.[field] ?? 0) + increment };
    } else {
      (target as Record<string, unknown>)[key] = value;
    }
  });
}

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { increment: (n: number) => ({ __increment: n }) },
}));

describe('deleting a tag cascades without eating concurrent work', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(store).forEach((key) => delete store[key]);
    store['sermon-1'] = {
      userId: 'u1',
      thoughts: [{ id: 't1', tags: ['Examples', 'Introduction'] }],
    };
    landsAfterRead = null;
    wireAdminDb();
  });

  it('keeps a thought stored after the cascade read its snapshot', async () => {
    landsAfterRead = () => {
      // Dictated on the phone one second after Settings started deleting the tag.
      store['sermon-1'].thoughts.push({ id: 't-phone', tags: ['Introduction'] });
      landsAfterRead = null;
    };

    await deleteTag('u1', 'Examples');

    const ids = store['sermon-1'].thoughts.map((thought) => thought.id);
    expect(ids).toContain('t-phone');
    // …and the tag really is gone from the thought that had it.
    expect(store['sermon-1'].thoughts.find((t) => t.id === 't1')?.tags).not.toContain('Examples');
  });

  it('advances the thoughts counter, so the guard is not handed a lie', async () => {
    await deleteTag('u1', 'Examples');

    expect(store['sermon-1'].rev?.thoughts).toBe(1);
  });
});
