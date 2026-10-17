import { act, renderHook } from '@testing-library/react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { awaitAcceptance } from '@/utils/recoverableWrite';
import { __resetConnectivityForTests, reportServerUnreachable } from '@/utils/connectivity';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'u', isAuthLoading: false }) }));
let mockLanguage = 'en';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }) }));
afterEach(() => { mockLanguage = 'en'; });

type Row = Record<string, unknown>;
let store: Map<string, Row>;
const note = (extra: Row = {}): Row => ({
  userId: 'u', title: 'Grace', content: 'Laptop paragraph', tags: [], scriptureRefs: [], type: 'note',
  isDraft: true, createdAt: 'c', updatedAt: 'u', rev: { note: 4 }, ...extra,
});
const actions = {
  ready: true,
  create: jest.fn(async (resource: { id: string }, value: Row) => { store.set(resource.id, value); }),
  remove: jest.fn(async (resource: { id: string }) => { store.delete(resource.id); }),
  commit: jest.fn(async (resource: { id: string }, updater: (value: Row | null) => Row | null) => {
    const next = updater(store.get(resource.id) ?? null);
    if (next) store.set(resource.id, next);
  }),
};

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockImplementation(() => ({
    state: { snapshots: [], documents: [...store].map(([id, value]) => ({ resource: { collection: 'studyNotes', id }, value })),
      complete: true, freshness: 'server', checking: false, version: 1, error: null },
    loading: false, error: null, refresh: jest.fn(),
  }) as never);
  return renderHook(() => useStudyNotesEngine(true));
}

const opened = { title: 'Grace', content: 'Laptop paragraph', tags: [], scriptureRefs: [], type: 'note' };

describe('study notes on the engine', () => {
  beforeEach(() => { jest.clearAllMocks(); store = new Map([['n1', note()]]); });

  it('keeps a tag added on the phone when the laptop saves a paragraph', async () => {
    const { result } = render();
    store.set('n1', note({ tags: ['grace'] }));
    let saved: unknown;
    await act(async () => {
      const submission = result.current.updateNote({ id: 'n1', updates: { content: 'New paragraph' }, expectedRevision: 4, expectedBaseline: opened });
      await awaitAcceptance(submission, () => undefined);
      saved = await submission.result;
    });
    expect(store.get('n1')).toEqual(expect.objectContaining({ content: 'New paragraph', tags: ['grace'], rev: { note: 4 } }));
    expect(saved).toEqual(expect.objectContaining({ id: 'n1', content: 'New paragraph', revision: 5 }));
  });

  it('refuses a paragraph rewritten elsewhere with the other text, and a deliberate overwrite then writes', async () => {
    const { result } = render();
    store.set('n1', note({ content: 'Phone paragraph', rev: { note: 5 } }));
    let error: unknown;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: { content: 'Laptop rewrite' }, expectedRevision: 4, expectedBaseline: opened }), () => undefined)
        .then(() => null, caught => caught);
    });
    expect(isStaleWriteError(error)).toBe(true);
    expect((error as { serverValues?: Row }).serverValues).toEqual({ content: 'Phone paragraph' });
    expect(store.get('n1')!.content).toBe('Phone paragraph');
    await act(async () => {
      await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: { content: 'Laptop rewrite' }, expectedRevision: 5, expectedBaseline: null }), () => undefined);
    });
    expect(store.get('n1')!.content).toBe('Laptop rewrite');
  });

  // BUG-20261012-psalm-verse-numbering-not-mapped: "Пс 50:12" typed in Russian was stored as
  // Psalms 51:12 — the chapter moved, the verse not. The note is read with its Bible named, so an
  // English screen and the AI get Ps 51:10, and editing it is not mistaken for a change elsewhere.
  it('reads an old reference in the language of its author’s interface, and an edit of it is not a change made elsewhere', async () => {
    // A note is read in the app by its author alone: the interface's language is theirs (Russian here).
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Покаяние', content: 'Сердце чистое', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] }));
    const { result } = render();
    const read = result.current.notes[0];
    expect(read.scriptureRefs).toEqual([{ id: 'r1', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }]);

    const added = [...read.scriptureRefs, { id: 'r2', bible: 'rst' as const, book: 'Psalms', chapter: 22 }];
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: added }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeNull();
    expect(store.get('n1')!.scriptureRefs).toEqual(added);
  });

  // Codex, 2026-10-17: the editor keeps the note as it read it; switching the interface's language reads
  // an old reference in another Bible, and the save took that for another device's change.
  it('does not take a language switch for a change made elsewhere', async () => {
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] }));
    const { result, rerender } = render();
    const read = result.current.notes[0];
    expect(read.scriptureRefs).toEqual([{ id: 'r1', bible: 'rst', book: 'Psalms', chapter: 50, fromVerse: 12 }]);
    mockLanguage = 'en';
    rerender();
    const added = [...read.scriptureRefs, { id: 'r2', bible: 'rst' as const, book: 'Psalms', chapter: 22 }];
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: added }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeNull();
    expect(store.get('n1')!.scriptureRefs).toEqual(added);
  });

  // Codex, 2026-10-17: an older app on another device still writes a reference without its Bible. Read in
  // a language this editor never showed, it matched the editor's baseline, and the other device's verse
  // was overwritten without a word.
  it('still sees a change elsewhere written in the old form, read in the language the editor shows', async () => {
    mockLanguage = 'ru';
    // Quick input puts the Bible last, as the old form read in a language gets it.
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12, bible: 'kjv' }] }));
    const { result } = render();
    const read = result.current.notes[0];
    // Another device, on an older app, wrote Russian 50:12 the old way.
    store.set('n1', { ...store.get('n1')!, scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] });
    const added = [...read.scriptureRefs, { id: 'r2', bible: 'rst' as const, book: 'Psalms', chapter: 22 }];
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: added }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeInstanceOf(Error);
    expect(store.get('n1')!.scriptureRefs).toEqual([{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }]);
  });

  // Codex, 2026-10-17, round 3: after a language switch the old form was read in every language shown, and
  // the English reading of another device's old-form write passed for the baseline read in Russian.
  it('sees another device’s old-form write after a language switch', async () => {
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12, bible: 'kjv' }] }));
    const { result, rerender } = render();
    const read = result.current.notes[0];
    mockLanguage = 'en';
    rerender();
    store.set('n1', { ...store.get('n1')!, scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] });
    const added = [...read.scriptureRefs, { id: 'r2', bible: 'rst' as const, book: 'Psalms', chapter: 22 }];
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: added }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeInstanceOf(Error);
    expect(store.get('n1')!.scriptureRefs).toEqual([{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }]);
  });

  // Codex, 2026-10-17, round 4: after its own save the editor's baseline is the list it sent — one the
  // engine never handed out. Read in the interface's language by then, another device's old-form write
  // matched it and was overwritten.
  it('compares the stored list as it is with a baseline the editor wrote itself', async () => {
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [] }));
    const { result, rerender } = render();
    // What the editor saved before: its own list, with the Bible named.
    const savedByEditor = [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12, bible: 'kjv' as const }];
    store.set('n1', { ...store.get('n1')!, scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }] });
    mockLanguage = 'en';
    rerender();
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: [...savedByEditor, { id: 'r2', bible: 'rst', book: 'Psalms', chapter: 22 }] }, expectedRevision: 4,
        expectedBaseline: { title: 'Мы любим', content: '', tags: [], scriptureRefs: savedByEditor, type: 'note' },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeInstanceOf(Error);
    expect(store.get('n1')!.scriptureRefs).toEqual([{ id: 'r1', book: 'Psalms', chapter: 51, fromVerse: 12 }]);
  });

  // Codex, 2026-10-17, round 5: undoing the old Psalm shift reads the old "9" and "10" both as Synodal 9.
  // An older app changing 9 to 10 on another device read the same as the baseline, and was overwritten.
  it('sees a change elsewhere that reading would hide: old Psalm 9 changed to 10', async () => {
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 9, fromVerse: 1 }] }));
    const { result } = render();
    const read = result.current.notes[0];
    store.set('n1', { ...store.get('n1')!, scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 10, fromVerse: 1 }] });
    let error: unknown = null;
    await act(async () => {
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: [...read.scriptureRefs, { id: 'r2', bible: 'rst', book: 'John', chapter: 3 }] }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeInstanceOf(Error);
    expect(store.get('n1')!.scriptureRefs).toEqual([{ id: 'r1', book: 'Psalms', chapter: 10, fromVerse: 1 }]);
  });

  // Codex, 2026-10-17, round 6: "the stored note already is what I write" was judged on a reading — the
  // old "10:1" read as Synodal 9:1, the very list being written, and another device's 9→10 was overwritten.
  it('lets a save through as already done only when the stored list is that very list', async () => {
    mockLanguage = 'ru';
    store.set('n1', note({ title: 'Мы любим', content: '', scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 9, fromVerse: 1 }, { id: 'r2', bible: 'kjv', book: 'John', chapter: 3, fromVerse: 16 }] }));
    const { result } = render();
    const read = result.current.notes[0];
    // Another device, on an older app: Psalm 9 → 10, and John removed.
    store.set('n1', { ...store.get('n1')!, scriptureRefs: [{ id: 'r1', book: 'Psalms', chapter: 10, fromVerse: 1 }] });
    let error: unknown = null;
    await act(async () => {
      // This editor removes John: its list reads as the other device's does.
      error = await awaitAcceptance(result.current.updateNote({
        id: 'n1', updates: { scriptureRefs: [read.scriptureRefs[0]] }, expectedRevision: 4,
        expectedBaseline: { title: read.title, content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: read.type },
      }), () => undefined).then(() => null, caught => caught);
    });
    expect(error).toBeInstanceOf(Error);
    expect(store.get('n1')!.scriptureRefs).toEqual([{ id: 'r1', book: 'Psalms', chapter: 10, fromVerse: 1 }]);
  });

  it('never writes relations or unknown fields from an edit, and recomputes the draft flag', async () => {
    const { result } = render();
    await act(async () => {
      await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: {
        tags: ['grace'], scriptureRefs: [{ book: 'John', chapter: 1, fromVerse: 14 }], materialIds: ['m1'], userId: 'other',
      } as never, expectedBaseline: opened }), () => undefined);
    });
    expect(store.get('n1')).toEqual(expect.objectContaining({ userId: 'u', isDraft: false }));
    expect(store.get('n1')).not.toHaveProperty('materialIds');
  });

  it('reports a save made while there is no connection as queued, never as saved', async () => {
    // The engine holds delivery while the last request did not reach the server, so the label follows
    // that same answer — a phone flag saying "online" over café Wi-Fi must not make it "saved".
    const { result } = render();
    reportServerUnreachable();
    try {
      let acceptance: unknown;
      await act(async () => {
        acceptance = await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: { content: 'Typed offline' }, expectedBaseline: opened }), () => undefined);
      });
      expect(acceptance).toEqual(expect.objectContaining({ kind: 'queued' }));
    } finally { __resetConnectivityForTests(); }
  });

  it('surfaces a stale refusal offline even when the local commit answers late', async () => {
    const { result } = render();
    store.set('n1', note({ content: 'Phone paragraph', rev: { note: 5 } }));
    // IndexedDB answers after several tasks, not in the same microtask.
    actions.commit.mockImplementationOnce(async (resource: { id: string }, updater: (value: Row | null) => Row | null) => {
      await new Promise(resolve => setTimeout(resolve, 20));
      const next = updater(store.get(resource.id) ?? null);
      if (next) store.set(resource.id, next);
    });
    const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      let outcome: unknown;
      await act(async () => {
        outcome = await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: { content: 'Laptop rewrite' }, expectedBaseline: opened }), () => undefined)
          .then(acceptance => acceptance, error => error);
      });
      expect(isStaleWriteError(outcome)).toBe(true);
    } finally { online.mockRestore(); }
  });

  it('creates a note without relations and deletes through the engine', async () => {
    const { result } = render();
    let id = '';
    await act(async () => {
      const submission = result.current.createNote({ userId: 'u', title: 'Hope', content: 'Text', tags: [], scriptureRefs: [], type: 'note', materialIds: ['m1'], relatedSermonIds: [] });
      id = submission.note.id;
      expect(await awaitAcceptance(submission, () => undefined)).toEqual({ kind: 'persisted' });
    });
    expect(store.get(id)).toEqual(expect.objectContaining({ userId: 'u', title: 'Hope', isDraft: true }));
    expect(store.get(id)).not.toHaveProperty('materialIds');
    await act(async () => { await awaitAcceptance(result.current.deleteNote('n1'), () => undefined); });
    expect(actions.remove).toHaveBeenCalledWith({ collection: 'studyNotes', id: 'n1' });
  });
});
