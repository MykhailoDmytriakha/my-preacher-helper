import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';

import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';

import { useNoteAutoSave } from '../useNoteAutoSave';

import type { NoteDraftPayload } from '../noteDraft';
import type { StudyNote } from '@/models/models';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * A NEW NOTE MUST NEVER BE WITHOUT A DURABLE COPY.
 *
 * It is drafted under the placeholder id "new". The create resolves OPTIMISTICALLY —
 * a client id, no server confirmation — so the record has to be CARRIED to the real
 * id, not deleted. Reporting the save first broke exactly that: `markSaved` retires
 * the draft under the key the draft hook still holds ("new"), so the move found
 * nothing left to carry and the text was unprotected while the write was in flight.
 */
const payload: NoteDraftPayload = {
  title: 'Half a thought',
  content: 'typed but not confirmed',
  tags: [],
  scriptureRefs: [],
  type: 'note',
};

function useHarness(createNote: jest.Mock, onSaved: (saved: NoteDraftPayload) => void) {
  const baselineRef = useRef<NoteDraftPayload | null>(null);
  const revisionRef = useRef<number | null>(null);
  const deliberateOverwriteRef = useRef(false);
  return useNoteAutoSave({
    noteId: 'new',
    isNew: true,
    isInitialized: true,
    title: payload.title,
    content: payload.content,
    tags: payload.tags,
    scriptureRefs: payload.scriptureRefs,
    type: payload.type,
    updateNote: jest.fn(),
    createNote: createNote as never,
    uid: 'u1',
    setCreatedNoteId: jest.fn(),
    t: ((key: string) => key) as never,
    baselineRef,
    revisionRef,
    deliberateOverwriteRef,
    resaveNonce: 0,
    saveBlocked: false,
    onConflict: jest.fn(),
    onSaved,
  });
}

describe('creating a note keeps the durable draft at all times', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('carries the draft to the real id BEFORE reporting the save', async () => {
    saveDraft(draftKey('u1', 'new', 'note'), payload);
    const createNote = jest.fn().mockResolvedValue({ id: 'real-id' } as StudyNote);
    // This is what the page passes: the draft hook's `markSaved`, which retires the
    // draft under the key it currently holds — still "new" at this moment.
    const onSaved = jest.fn(() => {
      window.localStorage.removeItem(draftKey('u1', 'new', 'note'));
    });

    renderHook(() => useHarness(createNote, onSaved));
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    await waitFor(() => expect(createNote).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    // The text is durable under the REAL id — the only thing that matters if the tab
    // closes before the server confirms.
    expect(readDraft(draftKey('u1', 'real-id', 'note'))?.value).toEqual(payload);
  });
});
