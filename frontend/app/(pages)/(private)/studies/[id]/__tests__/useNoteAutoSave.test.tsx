import { act, renderHook, waitFor } from '@testing-library/react';
import { useRef } from 'react';

import { draftKey, readDraft, saveDraft } from '@/utils/durableDraft';
import { persistedWrite, queuedMutation } from '@/utils/recoverableWrite';

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

const refusal = () => Object.assign(new Error('Missing or insufficient permissions.'), {
  code: 'permission-denied',
  name: 'FirebaseError',
});

describe('creating a note keeps the durable draft at all times', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it('carries the draft to the real id but does not mark it saved until persistence', async () => {
    saveDraft(draftKey('u1', 'new', 'note'), payload);
    let resolvePersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      resolvePersistence = resolve;
    });
    const createNote = jest.fn(() => ({
      ...queuedMutation('study-note:create:real-id', persistence),
      note: { id: 'real-id' } as StudyNote,
    }));
    const onSaved = jest.fn();

    const { result } = renderHook(() => useHarness(createNote, onSaved));
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    await waitFor(() => expect(createNote).toHaveBeenCalled());
    // `queued` means the outbox owns the write, not that it saved. The durable copy
    // therefore remains under the real id and the editor must not show Saved.
    expect(result.current.lastSaved).toBeNull();
    expect(readDraft(draftKey('u1', 'real-id', 'note'))?.value).toEqual(payload);

    await act(async () => {
      resolvePersistence();
      await persistence;
    });
    // This submission was accepted as `queued`, so even its eventual persistence
    // must not turn the queued outcome into a Saved announcement.
    expect(result.current.lastSaved).toBeNull();
    expect(readDraft(draftKey('u1', 'real-id', 'note'))).toBeNull();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('keeps the new-note draft and flags the save as not gone through', async () => {
    saveDraft(draftKey('u1', 'new', 'note'), payload);
    const createNote = jest.fn(() => ({
      ...persistedWrite(Promise.reject(refusal())),
      note: { id: 'real-id' } as StudyNote,
    }));

    const { result } = renderHook(() => useHarness(createNote, jest.fn()));
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    // A STATUS key, translated by the screen — the explanation itself belongs to the
    // note's recovery descriptor, so this must not carry a second wording.
    await waitFor(() => expect(result.current.saveError).toBe('common.saveError'));
    expect(result.current.lastSaved).toBeNull();
    // The stable client id was assigned before acceptance to prevent duplicate
    // creates; refusal therefore retains the durable copy at that real-id key.
    expect(readDraft(draftKey('u1', 'real-id', 'note'))?.value).toEqual(payload);
  });

  it('shows Saved only when an online create is persisted', async () => {
    saveDraft(draftKey('u1', 'new', 'note'), payload);
    const createNote = jest.fn(() => ({
      ...persistedWrite(Promise.resolve()),
      note: { id: 'real-id' } as StudyNote,
    }));

    const { result } = renderHook(() => useHarness(createNote, jest.fn()));
    await act(async () => {
      jest.advanceTimersByTime(1600);
    });

    await waitFor(() => expect(result.current.lastSaved).not.toBeNull());
    expect(readDraft(draftKey('u1', 'real-id', 'note'))).toBeNull();
  });

  it('moves the baseline on a QUEUED update, so the same note is not enqueued forever', async () => {
    /**
     * Nominally online, Firestore unreachable: the update goes to the durable outbox and
     * comes back as `queued`. The status stays quiet — nothing is on the server — but the
     * BASELINE has to move. It did not, so the autosave effect re-ran every 1.5 seconds and
     * stored the identical note again under a fresh id, filling the outbox with copies of
     * one note and threatening the storage later typing depends on.
     */
    const baselineRef = { current: null as NoteDraftPayload | null };
    const revisionRef = { current: 1 as number | null };
    const deliberateOverwriteRef = { current: false };
    const updateNote = jest.fn(() => {
      const submission = queuedMutation('outbox:study-note:update:n1', Promise.resolve());
      return { ...submission, result: new Promise(() => undefined) };
    });

    const updated: NoteDraftPayload = { ...payload, content: 'typed while unreachable' };

    renderHook(() =>
      useNoteAutoSave({
        noteId: 'n1',
        isNew: false,
        isInitialized: true,
        existingNote: { id: 'n1', ...payload } as unknown as StudyNote,
        title: updated.title,
        content: updated.content,
        tags: updated.tags,
        scriptureRefs: updated.scriptureRefs,
        type: updated.type,
        updateNote: updateNote as never,
        createNote: jest.fn() as never,
        uid: 'u1',
        setCreatedNoteId: jest.fn(),
        t: ((key: string) => key) as never,
        baselineRef: baselineRef as never,
        revisionRef: revisionRef as never,
        deliberateOverwriteRef: deliberateOverwriteRef as never,
        resaveNonce: 0,
        saveBlocked: false,
        onConflict: jest.fn(),
        onSaved: jest.fn(),
      })
    );

    // The autosave is debounced (~1.5s), so both waits get room.
    await waitFor(() => expect(updateNote).toHaveBeenCalledTimes(1), { timeout: 4000 });
    await waitFor(() => expect(baselineRef.current).toEqual(updated), { timeout: 4000 });
  });
});
