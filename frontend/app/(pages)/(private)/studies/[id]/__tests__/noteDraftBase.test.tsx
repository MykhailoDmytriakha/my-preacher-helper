import { act, renderHook } from '@testing-library/react';

import { engineNote, storedReferences } from '@/hooks/useStudyNotesEngine';
import { draftKey, readDraft } from '@/utils/durableDraft';
import { queuedMutation } from '@/utils/recoverableWrite';

import { keepMineBaseline, noteDraftBase, resumedNoteBaseline } from '../noteDraftBase';
import { useNoteAutoSave } from '../useNoteAutoSave';

import type { NoteDraftPayload } from '../noteDraft';
import type { StudyNote } from '@/models/models';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

// "Ps 50:12" typed in a Russian interface before references kept their Bible: stored without one.
const oldReference = { id: 'old-1', book: 'Psalms', chapter: 51, fromVerse: 12 };

describe('what a note draft keeps as its base', () => {
  it('keeps an old reference as the stored list and reads it back so the check compares stored data', () => {
    const read = engineNote({ userId: 'u1', title: 'Покаяние', content: 'Сердце чистое', tags: [], scriptureRefs: [oldReference] } as never, 'n1', 'ru');
    const baseline: NoteDraftPayload = { title: read.title ?? '', content: read.content, tags: read.tags, scriptureRefs: read.scriptureRefs, type: 'note' };
    // The screen reads the old reference with a Bible; the stored data has none.
    expect(baseline.scriptureRefs[0]).toHaveProperty('bible');

    const kept = JSON.parse(JSON.stringify(noteDraftBase(baseline)));
    expect(kept.scriptureRefs).toEqual([oldReference]);

    const resumed = resumedNoteBaseline(kept, baseline, null, 'n1', 'ru');
    expect(resumed.scriptureRefs).toEqual(baseline.scriptureRefs);
    expect(storedReferences(resumed.scriptureRefs)).toEqual([oldReference]);
  });

  it('gives a copy without a readable base an unknown base only for the fields it would change', () => {
    const shown: NoteDraftPayload = { title: 'Phone title', content: 'Stored words', tags: ['kept'], scriptureRefs: [], type: 'note' };
    const restored: NoteDraftPayload = { ...shown, title: 'Old title', content: 'Old words' };
    for (const kept of [undefined, { content: 'one field only' }, 'not a payload', { ...shown, tags: 'not a list' }]) {
      expect(resumedNoteBaseline(kept, restored, shown, 'n1', 'en')).toEqual({ ...shown, title: null, content: null });
    }
  });

  it('resumes a kept base as it was written, unknown fields included', () => {
    const kept = { title: null, content: 'Built on these words', tags: [], scriptureRefs: [], type: 'note' };
    const restored: NoteDraftPayload = { title: 'Anything', content: 'Built on these words, and more', tags: [], scriptureRefs: [], type: 'note' };
    expect(resumedNoteBaseline(kept, restored, null, 'n1', 'en')).toEqual(kept);
  });
});

describe('what «keep my text» makes the base', () => {
  it('the refused version for the fields the check compared, references read back as the screen reads them', () => {
    const shown: NoteDraftPayload = { title: 'Opened title', content: 'Opened words', tags: ['kept'], scriptureRefs: [], type: 'note' };
    // What the check reports is stored data: the old reference without its Bible.
    const kept = keepMineBaseline(shown, { content: 'Phone words', scriptureRefs: [oldReference] }, 'n1', 'ru');
    expect(kept).toEqual({ ...shown, content: 'Phone words', scriptureRefs: kept.scriptureRefs });
    expect(kept.scriptureRefs[0]).toHaveProperty('bible');
    expect(storedReferences(kept.scriptureRefs)).toEqual([oldReference]);
  });

  it('leaves the shown base for every field the check did not compare, and takes no field the editor does not own', () => {
    const shown: NoteDraftPayload = { title: 'Opened title', content: 'Opened words', tags: ['kept'], scriptureRefs: [], type: 'note' };
    // A note stored without words is reported as null, which the check reads as that absence.
    expect(keepMineBaseline(shown, { content: null, analysis: { book: 'x' } }, 'n1', 'en')).toEqual({ ...shown, content: null });
  });
});

describe('the note autosave keeps the base in every copy it writes itself', () => {
  beforeEach(() => { jest.useFakeTimers(); window.localStorage.clear(); });
  afterEach(() => { jest.useRealTimers(); });
  const common = { uid: 'u1', setCreatedNoteId: jest.fn(), t: ((key: string) => key) as never, revisionRef: { current: 1 as number | null },
    resaveNonce: 0, saveBlocked: false, onConflict: jest.fn(), draftWriterId: 'opening' };
  const never = () => new Promise<never>(() => undefined);

  it('the immediate backup of an update keeps the baseline that very update is checked against', async () => {
    const baseline: NoteDraftPayload = { title: 'Title', content: 'Opened words', tags: [], scriptureRefs: [], type: 'note' };
    let backup: unknown, checkedAgainst: unknown;
    const updateNote = jest.fn(({ expectedBaseline }: { expectedBaseline?: unknown }) => {
      backup = readDraft(draftKey('u1', 'n1', 'note', 'opening'));
      checkedAgainst = expectedBaseline;
      return { ...queuedMutation('update', never()), result: never() };
    });
    const view = renderHook(() => useNoteAutoSave({ ...common, noteId: 'n1', isNew: false, isInitialized: true, ...baseline,
      content: 'Opened words and typed', baselineRef: { current: baseline }, updateNote: updateNote as never, createNote: jest.fn() as never }));
    await act(async () => { jest.advanceTimersByTime(1600); });
    expect(updateNote).toHaveBeenCalledTimes(1);
    expect(checkedAgainst).toEqual(baseline);
    expect(backup).toEqual(expect.objectContaining({ value: { ...baseline, content: 'Opened words and typed' }, base: baseline }));
    view.unmount();
  });

  it('the create backup keeps the new note opening, and the copy carried to the created note keeps it too', async () => {
    const opening: NoteDraftPayload = { title: '', content: '', tags: [], scriptureRefs: [], type: 'note' };
    const typed: NoteDraftPayload = { ...opening, content: 'First words' };
    let backup: unknown;
    const createNote = jest.fn(() => {
      backup = readDraft(draftKey('u1', 'new~created', 'note', 'opening'));
      return { ...queuedMutation('create', never()), note: { id: 'created' } as StudyNote };
    });
    const view = renderHook(() => useNoteAutoSave({ ...common, noteId: 'new', isNew: true, isInitialized: true, creationId: 'created',
      draftDocId: 'new~created', ...typed, baselineRef: { current: opening }, updateNote: jest.fn() as never, createNote: createNote as never }));
    await act(async () => { jest.advanceTimersByTime(1600); });
    expect(createNote).toHaveBeenCalledTimes(1);
    expect(backup).toEqual(expect.objectContaining({ value: typed, base: opening, creationTargetId: 'created' }));
    expect(readDraft(draftKey('u1', 'created', 'note', 'opening'))).toEqual(expect.objectContaining({ value: typed, base: opening }));
    view.unmount();
  });
});
