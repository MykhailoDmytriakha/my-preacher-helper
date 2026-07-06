/**
 * Idempotency guard for createManualThoughtViaClient.
 *
 * The migration moved manual-thought creates onto the client Firestore SDK, which
 * natively queues an offline write. If a create is ever sent twice — the native
 * offline queue committing the original write AND a reload-recovered retry, both
 * replaying the SAME optimistic id — the result must be ONE thought, not a
 * duplicate. This locks that invariant (the same collision class dissolved for
 * preach-dates by client-id upsert). See [[feedback_dissolve_collisions_with_idempotency]].
 *
 * NB: first test in the codebase to mock the client Firestore SDK directly. The
 * stateful `store` makes getDoc reflect a prior updateDoc, mirroring Firestore's
 * read-modify-write across the two sends.
 */
import {
  addScratchNoteViaClient,
  applyScratchToOutlineViaClient,
  createManualThoughtViaClient,
  deleteScratchNoteViaClient,
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

jest.mock('firebase/firestore', () => ({
  // Only doc/getDoc/updateDoc are exercised by createManualThoughtViaClient; the
  // rest are stubbed so the module's top-level imports resolve.
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

  it('sending the same optimistic id twice yields ONE thought (upsert by id)', async () => {
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
