import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { useSermonActions } from '../useSermonActions';
import { updateStructure } from '@/services/structure.service';
import { updateThought, createManualThought, deleteThought } from '@/services/thought.service';
import { Sermon, Item } from '@/models/models';
import type { WriteSubmission } from '@/utils/recoverableWrite';

let mockSnapshotNext: ((snapshot: {
    exists: () => boolean;
    // Whatever the document holds — the test feeds real Thought objects here, and a
    // plain index signature does not accept an interface with declared fields.
    data: () => { thoughts: unknown[] };
}) => void) | null = null;
const mockUnsubscribe = jest.fn();

jest.mock('firebase/firestore', () => ({
    doc: jest.fn((_db: unknown, collectionName: string, id: string) => ({ collectionName, id })),
    onSnapshot: jest.fn((_ref: unknown, _options: unknown, next: typeof mockSnapshotNext) => {
        mockSnapshotNext = next;
        return mockUnsubscribe;
    }),
}));
jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));

// Mock dependencies
jest.mock('sonner');
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));
jest.mock('@/services/structure.service');
jest.mock('@/services/thought.service');

const mockUpdateStructure = updateStructure as jest.MockedFunction<typeof updateStructure>;
const mockUpdateThought = updateThought as jest.MockedFunction<typeof updateThought>;
const mockCreateManualThought = createManualThought as jest.MockedFunction<typeof createManualThought>;
const mockDeleteThought = deleteThought as jest.MockedFunction<typeof deleteThought>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('useSermonActions', () => {
    const mockSermon: Sermon = {
        id: 'sermon-1',
        title: 'Test Sermon',
        verse: 'John 3:16',
        date: '2024-01-01',
        thoughts: [
            { id: 'thought-1', text: 'Existing Thought', tags: ['intro'], date: '2024-01-01' }
        ],
        outline: {
            introduction: [{ id: 'point-1', text: 'Point 1' }],
            main: [],
            conclusion: []
        },
        userId: 'user-1'
    };

    const mockItem: Item = {
        id: 'thought-1',
        content: 'Existing Thought',
        requiredTags: ['intro'],
        customTagNames: [],
        outlinePointId: 'point-1'
    };

    const defaultProps = {
        sermon: mockSermon,
        setSermon: jest.fn(),
        containers: {
            introduction: [mockItem],
            main: [],
            conclusion: [],
            ambiguous: []
        },
        setContainers: jest.fn(),
        containersRef: { current: { introduction: [mockItem], main: [], conclusion: [], ambiguous: [] } },
        allowedTags: [{ name: 'intro', color: '#ff0000' }],
        debouncedSaveThought: jest.fn(),
        debouncedSaveStructure: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockSnapshotNext = null;
    });

    it('handles edit and close edit', () => {
        const { result } = renderHook(() => useSermonActions(defaultProps));

        act(() => {
            result.current.handleEdit(mockItem);
        });
        expect(result.current.editingItem).toEqual(mockItem);

        act(() => {
            result.current.handleCloseEdit();
        });
        expect(result.current.editingItem).toBeNull();
    });

    it('handles add thought to section', () => {
        const { result } = renderHook(() => useSermonActions(defaultProps));

        act(() => {
            result.current.handleAddThoughtToSection('introduction', 'point-1');
        });

        expect(result.current.editingItem?.id).toMatch(/^temp-/);
        expect(result.current.addingThoughtToSection).toBe('introduction');
    });

    describe('handleSaveEdit - New Thought', () => {
        it('creates a new manual thought and updates state', async () => {
            const addedThought = { ...mockSermon.thoughts[0], id: 'new-id' };
            mockCreateManualThought.mockResolvedValue(addedThought);
            mockUpdateStructure.mockResolvedValue({});

            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleAddThoughtToSection('introduction', 'point-1');
            });

            await act(async () => {
                await result.current.handleSaveEdit('New Content', ['tag1'], 'point-1');
            });

            expect(mockCreateManualThought).toHaveBeenCalled();
            expect(defaultProps.setSermon).toHaveBeenCalled();
            expect(mockUpdateStructure).toHaveBeenCalled();
            expect(result.current.editingItem).not.toBeNull();
            act(() => result.current.handleCloseEdit());
            expect(result.current.editingItem).toBeNull();
        });

        it('closes normally after a successful retry — no stale copy comes back', async () => {
            /**
             * The sequence the earlier version could not survive: create is refused while
             * its editor is open, the person fixes it and saves successfully, then closes.
             * With the refusal queued, closing pulled the stale rejected copy back into
             * the editor, so a save that WORKED looked like it had failed — and saving
             * again would have duplicated the thought.
             */
            mockCreateManualThought.mockRejectedValueOnce(
                Object.assign(new Error('Failed'), { code: 'permission-denied' })
            );
            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleAddThoughtToSection('introduction');
            });

            let refused!: WriteSubmission;
            act(() => {
                refused = result.current.handleSaveEdit('New Content', [], undefined) as WriteSubmission;
            });
            await expect(refused.acceptance).rejects.toMatchObject({ code: 'permission-denied' });
            await expect(refused.persistence).rejects.toThrow('Failed');

            // The person corrects and saves again — this time it works.
            mockCreateManualThought.mockResolvedValueOnce({
                id: 'thought-new',
                text: 'Fixed content',
                tags: [],
                date: '2026-08-14',
            });
            let accepted!: WriteSubmission;
            await act(async () => {
                accepted = result.current.handleSaveEdit('Fixed content', [], undefined) as WriteSubmission;
                await accepted.persistence.catch(() => undefined);
            });

            act(() => {
                result.current.handleCloseEdit();
            });

            expect(result.current.editingItem).toBeNull();
        });

        it('handles errors during creation', async () => {
            const refusal = Object.assign(new Error('Failed'), { code: 'permission-denied' });
            mockCreateManualThought.mockRejectedValue(refusal);
            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleAddThoughtToSection('introduction');
            });

            let submission!: WriteSubmission;
            act(() => {
                submission = result.current.handleSaveEdit('New Content', [], undefined) as typeof submission;
            });

            await expect(submission.acceptance).rejects.toMatchObject({ code: 'permission-denied' });
            await expect(submission.persistence).rejects.toThrow('Failed');
            /**
             * The editor that STARTED this create is still open and holding the text, so
             * it explains the refusal itself — one refusal, one reporter. Nothing is
             * queued either: a queued copy made the editor un-closable, and a successful
             * retry then looked like a failure.
             */
            expect(mockToast.error).not.toHaveBeenCalled();
            expect(result.current.editingItem).not.toBeNull();
        });

        it('accepts a queued create from the exact local replica and stays silent', async () => {
            mockCreateManualThought.mockReturnValue(new Promise(() => undefined));
            const { result } = renderHook(() => useSermonActions(defaultProps));
            act(() => result.current.handleAddThoughtToSection('introduction'));

            let submission!: WriteSubmission;
            act(() => {
                submission = result.current.handleSaveEdit('Queued create', [], undefined) as typeof submission;
            });
            await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });

            expect(mockToast.error).not.toHaveBeenCalled();
            expect(mockUnsubscribe).not.toHaveBeenCalled();
        });

        it('reopens a late rejected create and reuses its client id on retry', async () => {
            let rejectPersistence!: (error: Error) => void;
            mockCreateManualThought.mockReturnValue(new Promise((_resolve, reject) => {
                rejectPersistence = reject;
            }));
            const { result } = renderHook(() => useSermonActions(defaultProps));
            act(() => result.current.handleAddThoughtToSection('introduction'));

            let submission!: WriteSubmission;
            act(() => {
                submission = result.current.handleSaveEdit('Recover this create', [], undefined) as typeof submission;
            });
            const firstId = mockCreateManualThought.mock.calls[0][1].id;
            await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });
            act(() => result.current.handleCloseEdit());
            expect(result.current.editingItem).toBeNull();

            await act(async () => {
                rejectPersistence(Object.assign(new Error('Permission denied'), { code: 'permission-denied' }));
                await expect(submission.persistence).rejects.toThrow('Permission denied');
            });
            expect(result.current.editingItem?.content).toBe('Recover this create');

            mockCreateManualThought.mockReturnValue(new Promise(() => undefined));
            act(() => {
                result.current.handleSaveEdit('Recover this create', [], undefined);
            });
            expect(mockCreateManualThought.mock.calls[1][1].id).toBe(firstId);
        });

        it('returns early if sermon is missing', async () => {
            const { result } = renderHook(() => useSermonActions({ ...defaultProps, sermon: null }));
            await result.current.handleSaveEdit('text', [], undefined);
            expect(mockCreateManualThought).not.toHaveBeenCalled();
        });
    });

    describe('handleSaveEdit - Update Thought', () => {
        it('updates an existing thought', async () => {
            const updatedThought = { ...mockSermon.thoughts[0], text: 'Updated' };
            mockUpdateThought.mockResolvedValue(updatedThought);

            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleEdit(mockItem);
            });

            await act(async () => {
                await result.current.handleSaveEdit('Updated Text', ['Tag A'], 'point-1');
            });

            expect(mockUpdateThought).toHaveBeenCalledWith(
                'sermon-1',
                expect.objectContaining({
                    id: 'thought-1',
                    text: 'Updated Text',
                    tags: ['intro', 'Tag A'],
                    outlinePointId: 'point-1',
                }),
                // AND the thought AS IT WAS BEFORE the modal: without it the write
                // claims every field, so an untouched one carries this screen's
                // hours-old copy over whatever another device stored.
                expect.objectContaining({ id: 'thought-1', text: 'Existing Thought' })
            );
            expect(defaultProps.setSermon).toHaveBeenCalled();
            expect(defaultProps.setContainers).toHaveBeenCalled();
        });

        it('handles update errors gracefully', async () => {
            const refusal = Object.assign(new Error('Update failed'), { code: 'permission-denied' });
            mockUpdateThought.mockRejectedValue(refusal);
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const { result } = renderHook(() => useSermonActions(defaultProps));
            act(() => {
                result.current.handleEdit(mockItem);
            });

            let submission!: WriteSubmission;
            act(() => {
                submission = result.current.handleSaveEdit('text', [], undefined) as typeof submission;
            });

            await expect(submission.acceptance).rejects.toMatchObject({ code: 'permission-denied' });
            await expect(submission.persistence).rejects.toThrow('Update failed');
            expect(consoleErrorSpy).toHaveBeenCalled();
            // The editor for THIS thought is still open, so IT explains the refusal
            // inline and holds the text — one refusal, one reporter. The restore path
            // speaks only when that editor is gone.
            expect(mockToast.error).not.toHaveBeenCalled();
            expect(result.current.editingItem).not.toBeNull();
            consoleErrorSpy.mockRestore();
        });

        it('waits for the online transaction before accepting an update', async () => {
            mockUpdateThought.mockResolvedValue({ ...mockSermon.thoughts[0], text: 'Saved online' });
            const { result } = renderHook(() => useSermonActions(defaultProps));
            act(() => result.current.handleEdit(mockItem));

            let submission!: WriteSubmission;
            act(() => {
                submission = result.current.handleSaveEdit('Queued update', [], 'point-1') as typeof submission;
            });
            await expect(submission.acceptance).resolves.toEqual({ kind: 'persisted' });
            expect(mockToast.error).not.toHaveBeenCalled();
        });

        it('reopens the exact edit when an accepted update later fails terminally', async () => {
            let rejectPersistence!: (error: Error) => void;
            mockUpdateThought.mockReturnValue(new Promise((_resolve, reject) => {
                rejectPersistence = reject;
            }));
            const originalOnline = navigator.onLine;
            Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
            try {
                const { result } = renderHook(() => useSermonActions(defaultProps));
                act(() => result.current.handleEdit(mockItem));

                let submission!: WriteSubmission;
                act(() => {
                    submission = result.current.handleSaveEdit('Recover this edit', [], 'point-1') as typeof submission;
                });
                await expect(submission.acceptance).resolves.toMatchObject({ kind: 'queued' });
                act(() => result.current.handleCloseEdit());

                await act(async () => {
                    rejectPersistence(Object.assign(new Error('Permission denied'), { code: 'permission-denied' }));
                    await expect(submission.persistence).rejects.toThrow('Permission denied');
                });
                expect(result.current.editingItem?.content).toBe('Recover this edit');
                // Reopened AND explained — reopening in silence read as a glitch.
                expect(mockToast.error).toHaveBeenCalledTimes(1);
                expect(mockToast.error.mock.calls[0][1]).toMatchObject({ description: 'Recover this edit' });
            } finally {
                Object.defineProperty(navigator, 'onLine', { configurable: true, value: originalOnline });
            }
        });
    });

    describe('handleMoveToAmbiguous', () => {
        it('moves item and clears outline point', () => {
            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleMoveToAmbiguous('thought-1', 'introduction');
            });

            expect(defaultProps.setContainers).toHaveBeenCalled();
            expect(defaultProps.debouncedSaveThought).toHaveBeenCalledWith(
                'sermon-1',
                expect.objectContaining({ outlinePointId: null }),
                // `expect.anything()` rejects null, so this asserts a baseline was
                // actually STATED — without one the write claims every field and a
                // move republishes this screen's copy of the text.
                expect.anything()
            );
            expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();
        });

        it('ignores if source section is not structural', () => {
            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleMoveToAmbiguous('thought-1', 'ambiguous');
            });

            expect(defaultProps.setContainers).not.toHaveBeenCalled();
        });
    });

    describe('handleDeleteThought', () => {
        it('deletes an existing thought', async () => {
            mockDeleteThought.mockResolvedValue(undefined as never);
            mockUpdateStructure.mockResolvedValue({});

            const { result } = renderHook(() => useSermonActions(defaultProps));

            await act(async () => {
                await result.current.handleDeleteThought('thought-1');
            });

            expect(mockDeleteThought).toHaveBeenCalled();
            expect(defaultProps.setContainers).toHaveBeenCalled();
            expect(defaultProps.setSermon).toHaveBeenCalled();
        });
    });
});
