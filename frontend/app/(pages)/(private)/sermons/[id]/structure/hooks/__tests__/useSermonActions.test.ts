import { renderHook as rtlRenderHook, act } from '@testing-library/react';
import React from 'react';
import { useSermonActions } from '../useSermonActions';
import { StructureWriterContext, type StructureWriter } from '@/components/sermon/structureWriter';
import { Sermon, Item } from '@/models/models';
import { awaitWriteOperation, type WriteOperation } from '@/utils/recoverableWrite';

jest.mock('sonner');
jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

/** Every write the hook makes goes through the structure writer; these are its recording stand-ins. */
const mockUpdateStructure = jest.fn();
const mockUpdateThought = jest.fn();
const mockCreateManualThought = jest.fn();
const mockDeleteThought = jest.fn();
const mockWriter: StructureWriter = {
  updateStructure: mockUpdateStructure,
  updateThought: mockUpdateThought,
  deleteThought: mockDeleteThought,
  createManualThought: mockCreateManualThought,
  updateSermonOutline: jest.fn(),
};

const renderHook = <T,>(callback: () => T) =>
  rtlRenderHook(callback, {
    wrapper: ({ children }) =>
      React.createElement(StructureWriterContext.Provider, { value: mockWriter }, children),
  });

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

    describe('handleMoveToAmbiguous', () => {
        it('moves item and clears outline placement in one scoped writer operation', async () => {
            const customTag = { name: 'custom-kept', color: '#123456' };
            const sermon = {
                ...mockSermon,
                thoughts: [{
                    ...mockSermon.thoughts[0],
                    tags: ['custom-kept'],
                    outlinePointId: 'point-1',
                    subPointId: 'subpoint-1',
                }],
                structure: { introduction: ['thought-1'], main: [], conclusion: [], ambiguous: [] },
            };
            const item = {
                ...mockItem,
                customTagNames: [customTag],
                outlinePointId: 'point-1',
                subPointId: 'subpoint-1',
            };
            const props = {
                ...defaultProps,
                sermon,
                containers: { introduction: [item], main: [], conclusion: [], ambiguous: [] },
                containersRef: { current: { introduction: [item], main: [], conclusion: [], ambiguous: [] } },
            };
            mockUpdateStructure.mockResolvedValue({});
            const { result } = renderHook(() => useSermonActions(props));
            let operation!: WriteOperation;

            act(() => {
                operation = result.current.handleMoveToAmbiguous('thought-1', 'introduction');
            });
            await act(async () => {
                await awaitWriteOperation(operation, () => undefined);
            });

            expect(props.setContainers).toHaveBeenCalled();
            expect(mockUpdateStructure).toHaveBeenCalledWith(
                'sermon-1',
                { introduction: [], main: [], conclusion: [], ambiguous: ['thought-1'] },
                sermon.structure,
                {
                    thoughtIds: ['thought-1'],
                    thoughtUpdates: [{
                        thought: expect.objectContaining({
                            id: 'thought-1',
                            tags: ['custom-kept'],
                            outlinePointId: null,
                            subPointId: null,
                        }),
                        baseThought: sermon.thoughts[0],
                    }],
                },
            );
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
