import { act, renderHook } from '@testing-library/react';
import { useMemo, useRef } from 'react';

import { useNoteAutoSave } from '@/(pages)/(private)/studies/[id]/useNoteAutoSave';
import { useDataCollection, useDocumentActions, type DocumentAction } from '@/data-engine/react.client';
import { useStudyNotesEngine } from '@/hooks/useStudyNotesEngine';
import { __resetConnectivityForTests, reportServerUnreachable } from '@/utils/connectivity';

import type { NoteDraftPayload } from '@/(pages)/(private)/studies/[id]/noteDraft';
import type { ScriptureReference } from '@/models/models';

afterEach(() => { jest.useRealTimers(); __resetConnectivityForTests(); });
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(), useDocumentActions: jest.fn(),
}));
jest.mock('@/hooks/useResolvedUid', () => ({ useResolvedUid: () => ({ uid: 'u', isAuthLoading: false }) }));
let mockLanguage = 'ru';
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: mockLanguage } }) }));

type Row = Record<string, unknown>;
type Copy = 'none' | 'picker' | 'json';
let stored: Row;
const onConflict = jest.fn();
const onSaved = jest.fn();
const actions = {
  ready: true, create: jest.fn(), remove: jest.fn(),
  submit: jest.fn(async (resource: { collection: string; id: string }, action: DocumentAction) => {
    if (action.kind !== 'update') throw new Error('Unexpected action in reference-provenance fixture');
    await actions.commit(resource, action.update as (value: Row) => Row);
    return { kind: 'submitted' as const, requestId: 'reference-fixture', persistence: Promise.resolve({ resource,
      value: { ...stored, rev: { note: ((stored.rev as { note?: number })?.note ?? 0) + 1 } },
      metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
    } as import('@/data-engine/types').ResourceSnapshot) };
  }),
  commit: jest.fn(async (_resource: unknown, updater: (value: Row) => Row) => { stored = updater(stored); }),
};
const added: ScriptureReference = { id: 'added', bible: 'rst', book: 'John', chapter: 3, fromVerse: 16 };
function useHarness({ copy, changedContent = false, addReference = false }: {
  copy: Copy; changedContent?: boolean; addReference?: boolean;
}) {
  const engine = useStudyNotesEngine(true);
  const opened = useRef<NoteDraftPayload | null>(null);
  if (!opened.current) {
    const note = engine.notes[0];
    opened.current = { title: note.title || '', content: note.content, tags: note.tags,
      scriptureRefs: note.scriptureRefs, type: note.type ?? 'note' };
  }
  const initial = opened.current;
  const copied = useMemo(() => copy === 'none' ? initial.scriptureRefs
    : copy === 'json' ? JSON.parse(JSON.stringify(initial.scriptureRefs)) as ScriptureReference[]
      : initial.scriptureRefs.map(ref => ({ ...ref })), [copy, initial]);
  const refs = useMemo(() => addReference ? [...copied, added] : copied, [copied, addReference]);
  const baselineRef = useRef<NoteDraftPayload | null>(initial);
  const revisionRef = useRef<number | null>(4);
  const deliberateOverwriteRef = useRef(false);
  const autosave = useNoteAutoSave({
    noteId: 'n1', isNew: false, isInitialized: true, uid: 'u',
    title: initial.title, content: changedContent ? 'Own changed paragraph' : initial.content,
    tags: initial.tags, scriptureRefs: refs, type: initial.type,
    updateNote: engine.updateNote, createNote: engine.createNote, setCreatedNoteId: jest.fn(),
    baselineRef, revisionRef, deliberateOverwriteRef, resaveNonce: 0, saveBlocked: false,
    onConflict, onSaved, t: ((key: string) => key) as never,
  });
  return { autosave, baselineRef };
}
async function tick() { await act(async () => { jest.advanceTimersByTime(1800); }); }

describe('study note reference provenance through actual autosave', () => {
  beforeEach(() => {
    jest.useFakeTimers(); jest.clearAllMocks(); mockLanguage = 'ru'; __resetConnectivityForTests();
    stored = { userId: 'u', title: 'Old note', content: 'Original paragraph', tags: [], type: 'note',
      scriptureRefs: [{ id: 'old', book: 'Psalms', chapter: 51, fromVerse: 12 }],
      createdAt: 'c', updatedAt: 'u', rev: { note: 4 }, materialIds: [], isDraft: true };
    jest.mocked(useDocumentActions).mockReturnValue(actions as never);
    jest.mocked(useDataCollection).mockImplementation(() => ({
      state: { snapshots: [], documents: [{ resource: { collection: 'studyNotes', id: 'n1' }, value: stored }],
        complete: true, freshness: 'server', checking: false, version: 1, error: null },
      loading: false, error: null, refresh: jest.fn(),
    }) as never);
  });

  it.each<[Copy, boolean]>([['picker', false], ['json', false], ['picker', true], ['json', true]])('saves a reference after an unchanged %s copy and an own content save (queued=%s)', async (copy, queued) => {
    if (queued) reportServerUnreachable();
    const { rerender } = renderHook(useHarness, { initialProps: { copy, changedContent: false, addReference: false } });
    await tick();
    expect(actions.commit).not.toHaveBeenCalled();
    rerender({ copy, changedContent: true, addReference: false });
    await tick();
    expect(stored.content).toBe('Own changed paragraph');
    expect(onConflict).not.toHaveBeenCalled();
    if (copy === 'json') mockLanguage = 'en';
    rerender({ copy, changedContent: true, addReference: true });
    await tick();
    expect(onConflict).not.toHaveBeenCalled();
    expect(stored.scriptureRefs).toEqual(expect.arrayContaining([added]));
    expect(stored.content).toBe('Own changed paragraph');
  });

  it('keeps an ordinary reference edit working without an intervening copy', async () => {
    const { rerender } = renderHook(useHarness, { initialProps: { copy: 'none' as Copy, changedContent: false, addReference: false } });
    rerender({ copy: 'none', changedContent: true, addReference: false });
    await tick();
    rerender({ copy: 'none', changedContent: true, addReference: true });
    await tick();
    expect(onConflict).not.toHaveBeenCalled();
    expect(stored.scriptureRefs).toEqual(expect.arrayContaining([added]));
  });

  it('does not adopt unseen references from a successful content-only save', async () => {
    stored.scriptureRefs = [{ id: 'old', book: 'Psalms', chapter: 9, fromVerse: 1 }];
    const { rerender } = renderHook(useHarness, { initialProps: { copy: 'picker' as Copy, changedContent: false, addReference: false } });
    stored = { ...stored, scriptureRefs: [{ id: 'old', book: 'Psalms', chapter: 10, fromVerse: 1 }], rev: { note: 5 } };
    rerender({ copy: 'picker', changedContent: true, addReference: false });
    await tick();
    expect(stored.content).toBe('Own changed paragraph');
    expect(onConflict).not.toHaveBeenCalled();
    rerender({ copy: 'picker', changedContent: true, addReference: true });
    await tick();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(stored.scriptureRefs).toEqual([{ id: 'old', book: 'Psalms', chapter: 10, fromVerse: 1 }]);
    expect(stored.content).toBe('Own changed paragraph');
  });

  it('still refuses a genuine old-form Psalm change hidden by the reading projection', async () => {
    stored.scriptureRefs = [{ id: 'old', book: 'Psalms', chapter: 9, fromVerse: 1 }];
    const { rerender } = renderHook(useHarness, { initialProps: { copy: 'picker' as Copy, changedContent: false, addReference: false } });
    rerender({ copy: 'picker', changedContent: true, addReference: false });
    await tick();
    stored = { ...stored, scriptureRefs: [{ id: 'old', book: 'Psalms', chapter: 10, fromVerse: 1 }], rev: { note: 5 } };
    rerender({ copy: 'picker', changedContent: true, addReference: true });
    await tick();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(stored.scriptureRefs).toEqual([{ id: 'old', book: 'Psalms', chapter: 10, fromVerse: 1 }]);
    expect(stored.content).toBe('Own changed paragraph');
  });
});
