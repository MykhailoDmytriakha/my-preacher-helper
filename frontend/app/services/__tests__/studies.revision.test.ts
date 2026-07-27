/**
 * The revision must actually reach the write.
 *
 * A live two-tab experiment cannot show the refusal: the freshness listener
 * delivers the newer revision within 1–3s, while autosave only fires 1.5s after
 * typing stops — so the tab is current again before it saves. Three attempts on
 * live data all ended with the write accepted (BUGS.md). That is the app working
 * as intended, but it leaves the guard itself unproven end-to-end.
 *
 * These tests prove the part that experiment cannot reach: a stated revision is
 * carried into the guarded write, and a refusal surfaces as a typed error instead
 * of being swallowed.
 */
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { updateStudyNote } from '@/services/studies.service';

const conflictSafeUpdate = jest.fn();
const updateDoc = jest.fn();

jest.mock('@/services/conflictSafeUpdate.client', () => {
  const actual = jest.requireActual('@/services/conflictSafeUpdate.client');
  return { ...actual, conflictSafeUpdate: (...args: unknown[]) => conflictSafeUpdate(...args) };
});

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

jest.mock('firebase/firestore', () => ({
  // Counter bump rides the ordinary updateDoc path (works offline).
  increment: (n: number) => ({ __increment: n }),
  doc: (_db: unknown, _c: string, id: string) => ({ __id: id }),
  collection: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  getDocs: jest.fn(),
  addDoc: jest.fn(),
  setDoc: jest.fn(),
  deleteDoc: jest.fn(),
  updateDoc: (...args: unknown[]) => updateDoc(...args),
  getDoc: async () => ({
    exists: () => true,
    id: 'note-1',
    data: () => ({
      userId: 'u1',
      title: 'server title',
      content: 'server content',
      tags: [],
      scriptureRefs: [],
      type: 'note',
      rev: { note: 4 },
    }),
  }),
}));

describe('the note write carries the revision it was built from', () => {
  beforeEach(() => {
    conflictSafeUpdate.mockReset();
    updateDoc.mockReset();
    conflictSafeUpdate.mockResolvedValue(5);
  });

  it('uses the GUARDED write and passes the stated revision', async () => {
    await updateStudyNote(
      'note-1',
      { content: 'my edit', userId: 'u1' },
      4,
      { content: 'the content this editor opened with' }
    );

    expect(conflictSafeUpdate).toHaveBeenCalledTimes(1);
    const [, patch, , options] = conflictSafeUpdate.mock.calls[0];
    // The route is what lets an OFFLINE attempt be queued as an intent and
    // replayed through this same guard, instead of becoming a blind write.
    expect(options).toEqual({
      aggregate: 'note',
      expectedRevision: 4,
      outboxRoute: { uid: 'u1', collection: 'studyNotes', docId: 'note-1', savedAt: expect.any(Number) },
      // ⚠️ THE CALLER'S baseline, verbatim — NOT anything derived from the read the
      // service just performed. Fingerprinting a fresh read compares the server
      // with itself, agrees every time, and lets the stale save through; the whole
      // protection was a no-op while it did that (adversarial review found it).
      expectedBaseline: { content: 'the content this editor opened with' },
    });
    expect(patch).toEqual(expect.objectContaining({ content: 'my edit' }));
    // The unguarded path must NOT also run.
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it('never manufactures a baseline from its own fresh read', async () => {
    // The fresh read says "server content". If the service passed THAT as the
    // baseline, the guard would compare the document with itself and always agree.
    await updateStudyNote('note-1', { content: 'my edit', userId: 'u1' }, 4);

    const [, , , options] = conflictSafeUpdate.mock.calls[0];
    expect(options.expectedBaseline).toBeNull();
  });

  it('returns the committed revision so the editor can build the next save on it', async () => {
    const saved = await updateStudyNote('note-1', { content: 'x', userId: 'u1' }, 4);
    expect(saved.revision).toBe(5);
  });

  it('lets a refusal reach the caller instead of swallowing it', async () => {
    conflictSafeUpdate.mockRejectedValue(new StaleWriteError('note', 4, 9));

    const error = await updateStudyNote('note-1', { content: 'stale', userId: 'u1' }, 4).catch(
      (e) => e
    );

    expect(error).toBeInstanceOf(StaleWriteError);
    expect(error.actualRevision).toBe(9);
  });

  it('falls back to the plain write when no revision is stated — unchanged behaviour', async () => {
    await updateStudyNote('note-1', { content: 'legacy caller', userId: 'u1' });

    expect(conflictSafeUpdate).not.toHaveBeenCalled();
    expect(updateDoc).toHaveBeenCalledTimes(1);
  });
});

describe('every writer advances the counter, even without a stated revision', () => {
  it('an UNGUARDED save still bumps the counter', async () => {
    // A writer that changes data while leaving the number alone makes the counter
    // LIE: a later stale save then looks up to date and the guard hands it
    // permission to overwrite — worse than no guard, because the app confirms it.
    await updateStudyNote('note-1', { content: 'legacy caller', userId: 'u1' });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const payload = updateDoc.mock.calls[0][1];
    expect(payload['rev.note']).toEqual({ __increment: 1 });
  });
});
