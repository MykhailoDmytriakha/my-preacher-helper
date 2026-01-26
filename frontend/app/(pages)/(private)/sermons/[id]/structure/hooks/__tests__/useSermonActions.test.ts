import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';
import { useSermonActions } from '../useSermonActions';
import { updateStructure } from '@/services/structure.service';
import { updateThought, createManualThought } from '@/services/thought.service';
import { Sermon, Item } from '@/models/models';

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

    const pendingActions = {
        createPendingThought: jest.fn().mockReturnValue({ localId: 'local-1' }),
        updatePendingThought: jest.fn(),
        markPendingStatus: jest.fn(),
        removePendingThought: jest.fn(),
        replacePendingThought: jest.fn(),
        updateItemSyncStatus: jest.fn(),
        getPendingById: jest.fn(),
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
        pendingActions,
    };

    beforeEach(() => {
        jest.clearAllMocks();
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
            expect(pendingActions.replacePendingThought).toHaveBeenCalled();
            expect(pendingActions.removePendingThought).toHaveBeenCalled();
            expect(mockUpdateStructure).toHaveBeenCalled();
            expect(result.current.editingItem).toBeNull();
        });

        it('handles errors during creation', async () => {
            mockCreateManualThought.mockRejectedValue(new Error('Failed'));
            const { result } = renderHook(() => useSermonActions(defaultProps));

            act(() => {
                result.current.handleAddThoughtToSection('introduction');
            });

            await act(async () => {
                await result.current.handleSaveEdit('New Content', [], undefined);
            });

            expect(mockToast.error).toHaveBeenCalledWith('errors.failedToAddThought');
            expect(pendingActions.markPendingStatus).toHaveBeenCalled();
            expect(result.current.editingItem).toBeNull();
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

            expect(mockUpdateThought).toHaveBeenCalled();
            expect(defaultProps.setSermon).toHaveBeenCalled();
            expect(defaultProps.setContainers).toHaveBeenCalled();
        });

        it('handles update errors gracefully', async () => {
            mockUpdateThought.mockRejectedValue(new Error('Update failed'));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => { });

            const { result } = renderHook(() => useSermonActions(defaultProps));
            act(() => {
                result.current.handleEdit(mockItem);
            });

            await act(async () => {
                await result.current.handleSaveEdit('text', [], undefined);
            });

            expect(consoleErrorSpy).toHaveBeenCalled();
            expect(result.current.editingItem).toBeNull();
            consoleErrorSpy.mockRestore();
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
                expect.objectContaining({ outlinePointId: null })
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
});
