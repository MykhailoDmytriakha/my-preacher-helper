import { adminDb } from '@/config/firebaseAdminConfig';
import { removeTagFromSermons } from '@/data-engine/serverEdit.server';

/**
 * DELETING A TAG MUST NOT SWALLOW A THOUGHT DICTATED MEANWHILE.
 *
 * The cascade lists every sermon of the user, then strips the tag from each one. Sermons are
 * engine-owned on every deployment, so each sermon is rewritten by an ordinary engine update
 * command (editOwnedDocument), whose three-way merge keeps whatever a device stored between the
 * cascade's read and its write — a single tag deletion in Settings must not erase a thought
 * captured on the phone a second earlier.
 *
 * The engine also advances the `thoughts` counter, so a later save built on older text is not
 * handed permission to overwrite.
 *
 * Only the engine's transport (readDocument / processCommand) is replaced by an in-memory store;
 * the command is judged by the real applyCommand, so the merge under test is the production one.
 */

type StoredSermon = { userId: string; thoughts: Array<{ id: string; text: string; date: string; tags: string[] }>; rev?: Record<string, number> };
const store: Record<string, StoredSermon> = {};
const revisions: Record<string, number> = {};

/** What a device stored AFTER the cascade took its snapshot of a sermon. */
let landsAfterRead: (() => void) | null = null;

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn() },
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

jest.mock('@/data-engine/server', () => ({
  readDocument: async (_owner: string, resource: { collection: string; id: string }) => {
    const stored = store[resource.id];
    // FROZEN HERE, deliberately: a lazy read would quietly pick up the other device's write and
    // the race this test exists to prove would never happen.
    const snapshot = {
      resource,
      value: stored ? clone(stored) : null,
      metadata: stored ? { protocol: 1, generation: 'g', revision: revisions[resource.id] ?? 1, deleted: false } : null,
    };
    // The other device commits right after this read.
    const landing = landsAfterRead; landsAfterRead = null; landing?.();
    return snapshot;
  },
  processCommand: async (_owner: string, command: { resource: { collection: string; id: string } }) => {
    const { applyCommand } = jest.requireActual('@/data-engine/protocol') as typeof import('@/data-engine/protocol');
    const id = command.resource.id;
    const result = applyCommand(command as never, {
      resource: command.resource, value: clone(store[id]) as never,
      metadata: { protocol: 1, generation: 'g', revision: revisions[id] ?? 1, deleted: false },
    });
    if (result.kind === 'acknowledged' && result.snapshot.value) {
      store[id] = result.snapshot.value as unknown as StoredSermon;
      revisions[id] = (revisions[id] ?? 1) + 1;
    }
    return result;
  },
}));

function wireAdminDb() {
  (adminDb.collection as jest.Mock).mockImplementation(() => ({
    // The one read outside the engine: the cascade lists the owner's sermons before it writes.
    where: () => ({
      get: async () => ({
        docs: Object.entries(store).map(([id, data]) => {
          const frozen = clone(data);
          return { id, data: () => frozen };
        }),
      }),
    }),
  }));
}

describe('deleting a tag cascades without eating concurrent work', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(store).forEach((key) => delete store[key]);
    Object.keys(revisions).forEach((key) => delete revisions[key]);
    store['sermon-1'] = {
      userId: 'u1',
      thoughts: [{ id: 't1', text: 'First', date: '2026-01-01', tags: ['Examples', 'Introduction'] }],
    };
    landsAfterRead = null;
    wireAdminDb();
  });

  it('keeps a thought stored after the cascade read its snapshot', async () => {
    landsAfterRead = () => {
      // Dictated on the phone one second after Settings started deleting the tag.
      store['sermon-1'].thoughts.push({ id: 't-phone', text: 'Phone', date: '2026-01-02', tags: ['Introduction'] });
    };

    expect(await removeTagFromSermons('u1', 'Examples')).toEqual({ changed: 1, failed: 0 });

    const ids = store['sermon-1'].thoughts.map((thought) => thought.id);
    expect(ids).toContain('t-phone');
    // …and the tag really is gone from the thought that had it.
    expect(store['sermon-1'].thoughts.find((t) => t.id === 't1')?.tags).not.toContain('Examples');
  });

  it('advances the thoughts counter, so the guard is not handed a lie', async () => {
    await removeTagFromSermons('u1', 'Examples');

    expect(store['sermon-1'].rev?.thoughts).toBe(1);
  });
});
