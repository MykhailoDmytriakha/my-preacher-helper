import { act, renderHook, waitFor } from '@testing-library/react';

import { useStudyNotes } from '@/hooks/useStudyNotes';

import { useStudyNoteDraft } from '../useStudyNoteDraft';

import type { ContentNode, StudyNote } from '@/models/models';

jest.mock('@/hooks/useStudyNotes');

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

const mockUseStudyNotes = useStudyNotes as jest.MockedFunction<typeof useStudyNotes>;

const makeNote = (overrides: Partial<StudyNote> = {}): StudyNote => ({
    id: 'note-1',
    userId: 'user-1',
    title: 'Original title',
    content: 'Original content',
    tags: ['tag-a'],
    scriptureRefs: [{ id: 'ref-1', book: 'John', chapter: 3, fromVerse: 16 }],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    isDraft: false,
    type: 'note',
    ...overrides,
});

function mockStudyNotes(overrides: Partial<ReturnType<typeof useStudyNotes>> = {}) {
    const updateNote = jest.fn().mockResolvedValue(makeNote());
    const createNote = jest.fn().mockResolvedValue(makeNote({ id: 'created-note' }));
    const effectiveUpdateNote = overrides.updateNote ?? updateNote;
    const effectiveCreateNote = overrides.createNote ?? createNote;

    mockUseStudyNotes.mockReturnValue({
        uid: 'user-1',
        notes: [makeNote()],
        loading: false,
        error: null,
        refetch: jest.fn(),
        createNote: effectiveCreateNote,
        updating: false,
        updateNote: effectiveUpdateNote,
        deleteNote: jest.fn(),
        ...overrides,
    } as unknown as ReturnType<typeof useStudyNotes>);

    return { updateNote: effectiveUpdateNote, createNote: effectiveCreateNote };
}

async function waitForInitialized(result: { current: ReturnType<typeof useStudyNoteDraft> }) {
    await waitFor(() => expect(result.current.meta.isInitialized).toBe(true));
}

describe('useStudyNoteDraft', () => {
    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it('hydrates the draft from an existing note', async () => {
        const rootNode: ContentNode = {
            id: 'root',
            header: 'Root header',
            text: 'Root body',
        };
        const note = makeNote({
            title: 'Hydrated title',
            content: 'Hydrated content',
            tags: ['faith', 'hope'],
            scriptureRefs: [{ id: 'ref-2', book: 'Romans', chapter: 8 }],
            type: 'question',
            rootNode,
        });
        mockStudyNotes({ notes: [note] });

        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        expect(result.current.draft).toEqual({
            title: 'Hydrated title',
            content: 'Hydrated content',
            tags: ['faith', 'hope'],
            scriptureRefs: [{ id: 'ref-2', book: 'Romans', chapter: 8 }],
            type: 'question',
            rootNode,
        });
        expect(result.current.meta.existingNote).toBe(note);
        expect(result.current.meta.isNew).toBe(false);
        expect(result.current.meta.uid).toBe('user-1');
    });

    it('updates draft state through the exported setters', async () => {
        mockStudyNotes({ notes: [] });
        const nextRootNode: ContentNode = { id: 'root', text: 'Node text', children: [] };

        const { result } = renderHook(() => useStudyNoteDraft('new'));

        await waitForInitialized(result);

        act(() => {
            result.current.autoSave.setAutoSaveEnabled(false);
            result.current.setters.setTitle('Setter title');
            result.current.setters.setContent('Setter content');
            result.current.setters.setTags(['tag-b']);
            result.current.setters.setScriptureRefs([{ id: 'ref-3', book: 'Psalms', chapter: 23 }]);
            result.current.setters.setType('question');
            result.current.setters.setRootNode(nextRootNode);
        });

        expect(result.current.draft).toEqual({
            title: 'Setter title',
            content: 'Setter content',
            tags: ['tag-b'],
            scriptureRefs: [{ id: 'ref-3', book: 'Psalms', chapter: 23 }],
            type: 'question',
            rootNode: nextRootNode,
        });
    });

    it('returns a Promise from flushSave', async () => {
        mockStudyNotes();
        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        const flushResult = result.current.autoSave.flushSave();

        expect(flushResult).toEqual(expect.any(Promise));
        await act(async () => {
            await flushResult;
        });
    });

    it('creates a new note on flushSave and exposes it through meta', async () => {
        const createdNote = makeNote({
            id: 'created-note',
            title: 'Draft title',
            content: 'Draft body',
            tags: [],
            scriptureRefs: [],
        });
        const { createNote } = mockStudyNotes({
            notes: [],
            createNote: jest.fn().mockResolvedValue(createdNote),
        });
        const { result } = renderHook(() => useStudyNoteDraft('new'));

        await waitForInitialized(result);

        act(() => {
            result.current.autoSave.setAutoSaveEnabled(false);
            result.current.setters.setTitle('Draft title');
            result.current.setters.setContent('Draft body');
        });

        await act(async () => {
            await result.current.autoSave.flushSave();
        });

        expect(createNote).toHaveBeenCalledWith({
            title: 'Draft title',
            content: 'Draft body',
            tags: [],
            scriptureRefs: [],
            type: 'note',
            userId: 'user-1',
            materialIds: [],
            relatedSermonIds: [],
        });
        expect(result.current.meta.existingNote).toBe(createdNote);
        expect(result.current.meta.isNew).toBe(false);
    });

    it('preserves edits typed while a new note create request is still in flight', async () => {
        jest.useFakeTimers();
        const createNote = jest.fn().mockImplementation((payload: Omit<StudyNote, 'id' | 'createdAt' | 'updatedAt' | 'isDraft'>) =>
            new Promise<StudyNote>((resolve) => {
                setTimeout(() => {
                    resolve(makeNote({
                        id: 'created-note',
                        title: payload.title,
                        content: payload.content,
                        tags: payload.tags,
                        scriptureRefs: payload.scriptureRefs,
                    }));
                }, 1500);
            })
        );
        mockStudyNotes({ notes: [], createNote });
        const { result } = renderHook(() => useStudyNoteDraft('new'));

        await waitForInitialized(result);

        act(() => {
            result.current.autoSave.setAutoSaveEnabled(false);
            result.current.setters.setTitle('A');
        });

        let flushPromise: Promise<void> = Promise.resolve();
        act(() => {
            flushPromise = result.current.autoSave.flushSave();
        });

        act(() => {
            result.current.setters.setTitle('ABCD');
        });

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await flushPromise;
        });

        expect(createNote).toHaveBeenCalledWith({
            title: 'A',
            content: '',
            tags: [],
            scriptureRefs: [],
            type: 'note',
            userId: 'user-1',
            materialIds: [],
            relatedSermonIds: [],
        });
        expect(result.current.draft.title).toBe('ABCD');
        expect(result.current.meta.existingNote?.id).toBe('created-note');
    });

    it('toggles hasUnsavedChanges after an edit and clears it after flushSave', async () => {
        const note = makeNote();
        const { updateNote } = mockStudyNotes({
            notes: [note],
            updateNote: jest.fn().mockResolvedValue({ ...note, content: 'Changed content' }),
        });
        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        expect(result.current.autoSave.hasUnsavedChanges).toBe(false);

        act(() => {
            result.current.autoSave.setAutoSaveEnabled(false);
            result.current.setters.setContent('Changed content');
        });

        expect(result.current.autoSave.hasUnsavedChanges).toBe(true);

        await act(async () => {
            await result.current.autoSave.flushSave();
        });

        expect(updateNote).toHaveBeenCalledWith({
            id: 'note-1',
            updates: {
                title: 'Original title',
                content: 'Changed content',
                tags: ['tag-a'],
                scriptureRefs: [{ id: 'ref-1', book: 'John', chapter: 3, fromVerse: 16 }],
                type: 'note',
            },
        });
        expect(result.current.autoSave.hasUnsavedChanges).toBe(false);
    });

    it('flushSave cancels a pending debounced autosave so the update runs once', async () => {
        jest.useFakeTimers();
        const note = makeNote();
        const { updateNote } = mockStudyNotes({
            notes: [note],
            updateNote: jest.fn().mockResolvedValue({ ...note, content: 'Changed content' }),
        });
        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        act(() => {
            result.current.setters.setContent('Changed content');
        });

        await act(async () => {
            await result.current.autoSave.flushSave();
        });

        expect(updateNote).toHaveBeenCalledTimes(1);

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        expect(updateNote).toHaveBeenCalledTimes(1);
    });

    it('does not update when a refetch returns a structurally equal rootNode object', async () => {
        const localRootNode: ContentNode = {
            id: 'root',
            children: [{ id: 'child', header: 'Same', text: 'Body' }],
        };
        const refetchedRootNode: ContentNode = {
            id: 'root',
            children: [{ id: 'child', header: 'Same', text: 'Body' }],
        };
        const initialNote = makeNote({ rootNode: { id: 'root', children: [] }, content: '' });
        const refetchedNote = makeNote({
            rootNode: refetchedRootNode,
            content: '# Same\n\nBody',
            tags: initialNote.tags,
            scriptureRefs: initialNote.scriptureRefs,
        });
        const { updateNote } = mockStudyNotes({
            notes: [initialNote],
            updateNote: jest.fn().mockResolvedValue(refetchedNote),
        });
        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        act(() => {
            result.current.autoSave.setAutoSaveEnabled(false);
            result.current.setters.setRootNode(localRootNode);
        });

        mockStudyNotes({
            notes: [refetchedNote],
            updateNote,
        });
        rerender();

        await act(async () => {
            await result.current.autoSave.flushSave();
        });

        expect(updateNote).not.toHaveBeenCalled();
        expect(result.current.autoSave.hasUnsavedChanges).toBe(false);
    });

    it('retrySave triggers a save and clears error status after success', async () => {
        jest.useFakeTimers();
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const note = makeNote();
        const saveError = new Error('network unavailable');
        const updateNote = jest
            .fn()
            .mockRejectedValueOnce(saveError)
            .mockResolvedValueOnce({ ...note, content: 'Changed content' });
        mockStudyNotes({ notes: [note], updateNote });
        const { result, rerender } = renderHook(() => useStudyNoteDraft('note-1'));

        await waitForInitialized(result);
        rerender();

        act(() => {
            result.current.setters.setContent('Changed content');
        });

        await act(async () => {
            jest.advanceTimersByTime(1500);
            await Promise.resolve();
        });

        expect(updateNote).toHaveBeenCalledTimes(1);
        expect(result.current.autoSave.saveStatus).toBe('error');
        expect(result.current.autoSave.saveError).toBe('common.saveError');
        expect(result.current.autoSave.hasUnsavedChanges).toBe(true);

        await act(async () => {
            await result.current.autoSave.retrySave();
        });

        expect(updateNote).toHaveBeenCalledTimes(2);
        expect(result.current.autoSave.saveStatus).toBe('saved');
        expect(result.current.autoSave.saveError).toBeNull();
        expect(result.current.autoSave.hasUnsavedChanges).toBe(false);

        consoleErrorSpy.mockRestore();
    });
});
