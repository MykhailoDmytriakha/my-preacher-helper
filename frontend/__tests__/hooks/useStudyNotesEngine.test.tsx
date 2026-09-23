import { act, renderHook } from '@testing-library/react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { awaitAcceptance } from '@/utils/recoverableWrite';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'u', isAuthLoading: false }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

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

  it('reports an offline save as queued, never as saved', async () => {
    const { result } = render();
    const online = jest.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      let acceptance: unknown;
      await act(async () => {
        acceptance = await awaitAcceptance(result.current.updateNote({ id: 'n1', updates: { content: 'Typed offline' }, expectedBaseline: opened }), () => undefined);
      });
      expect(acceptance).toEqual(expect.objectContaining({ kind: 'queued' }));
    } finally { online.mockRestore(); }
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
