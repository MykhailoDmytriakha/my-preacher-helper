import { renderHook, act } from '@testing-library/react';
import { useAiSortingDiff } from '../useAiSortingDiff';
import { sortItemsWithAI } from '@/services/sortAI.service';
import { Item, OutlinePoint, Thought, Sermon, Structure } from '@/models/models';
import { toast } from 'sonner';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock services
jest.mock('@/services/sortAI.service');
jest.mock('sonner');

const mockSortItemsWithAI = sortItemsWithAI as jest.MockedFunction<typeof sortItemsWithAI>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('useAiSortingDiff', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    thoughts: [
      { id: 'thought-1', text: 'Test thought 1', tags: ['introduction'], date: new Date().toISOString() },
      { id: 'thought-2', text: 'Test thought 2', tags: ['main'], date: new Date().toISOString() },
      { id: 'thought-3', text: 'Test thought 3', tags: ['conclusion'], date: new Date().toISOString() },
    ],
    structure: {
      introduction: ['thought-1'],
      main: ['thought-2'],
      conclusion: ['thought-3'],
      ambiguous: []
    }
  } as Sermon;

  const mockContainers: Record<string, Item[]> = {
    introduction: [
      { id: 'thought-1', content: 'Test thought 1', requiredTags: ['introduction'], customTagNames: [] }
    ],
    main: [
      { id: 'thought-2', content: 'Test thought 2', requiredTags: ['main'], customTagNames: [] }
    ],
    conclusion: [
      { id: 'thought-3', content: 'Test thought 3', requiredTags: ['conclusion'], customTagNames: [] }
    ],
    ambiguous: []
  };

  const mockOutlinePoints = {
    introduction: [{ id: 'intro-1', text: 'Introduction point' }] as OutlinePoint[],
    main: [{ id: 'main-1', text: 'Main point' }] as OutlinePoint[],
    conclusion: [{ id: 'conclusion-1', text: 'Conclusion point' }] as OutlinePoint[]
  };

  const defaultProps = {
    containers: mockContainers,
    setContainers: jest.fn(),
    outlinePoints: mockOutlinePoints,
    sermon: mockSermon,
    sermonId: 'sermon-1',
    debouncedSaveThought: jest.fn(),
    debouncedSaveStructure: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSortItemsWithAI.mockResolvedValue({
      success: true,
      sortedItems: ['thought-2', 'thought-1', 'thought-3'],
      changes: [
        { itemId: 'thought-1', oldPosition: 0, newPosition: 1, section: 'introduction' },
        { itemId: 'thought-2', oldPosition: 0, newPosition: 0, section: 'main' }
      ]
    });
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useAiSortingDiff(defaultProps));

      expect(result.current.preSortState).toBeNull();
      expect(result.current.highlightedItems).toEqual({});
      expect(result.current.isDiffModeActive).toBe(false);
      expect(result.current.isSorting).toBe(false);
      expect(typeof result.current.handleAiSort).toBe('function');
      expect(typeof result.current.handleKeepItem).toBe('function');
      expect(typeof result.current.handleRevertItem).toBe('function');
      expect(typeof result.current.handleKeepAll).toBe('function');
      expect(typeof result.current.handleRevertAll).toBe('function');
    });
  });

  describe('handleAiSort', () => {
    it('covers success, error, no-op, and limit states in one run', async () => {
      await runScenarios([
        {
          name: 'successful sort with changes',
          run: async () => {
            mockSortItemsWithAI.mockResolvedValueOnce([
              { ...mockContainers.introduction[0], outlinePointId: 'intro-1' },
            ]);
            const mockSetContainers = jest.fn();
            const { result } = renderHook(() => useAiSortingDiff({ ...defaultProps, setContainers: mockSetContainers }));
            await act(async () => {
              await result.current.handleAiSort('introduction');
            });
            expect(mockSortItemsWithAI).toHaveBeenCalledWith(
              'introduction',
              mockContainers.introduction,
              'sermon-1',
              mockOutlinePoints.introduction,
            );
            expect(result.current.isDiffModeActive).toBe(true);
            expect(result.current.preSortState).toEqual({ introduction: mockContainers.introduction });
            mockSortItemsWithAI.mockClear();
          },
        },
        {
          name: 'service error surfaces toast',
          run: async () => {
            mockSortItemsWithAI.mockRejectedValueOnce(new Error('AI sorting failed'));
            const { result } = renderHook(() => useAiSortingDiff(defaultProps));
            await act(async () => {
              await result.current.handleAiSort('introduction');
            });
            expect(mockToast.error).toHaveBeenCalled();
            expect(result.current.isDiffModeActive).toBe(false);
            mockToast.error.mockClear();
          },
        },
        {
          name: 'no changes or no items',
          run: async () => {
            mockSortItemsWithAI.mockResolvedValue(mockContainers.introduction);
            const hook = renderHook(() => useAiSortingDiff(defaultProps));
            await act(async () => {
              await hook.result.current.handleAiSort('introduction');
            });
            expect(mockToast.info).toHaveBeenCalled();
            mockToast.info.mockClear();

            const emptyContainers = { ...mockContainers, introduction: [] };
            const emptyHook = renderHook(() => useAiSortingDiff({ ...defaultProps, containers: emptyContainers }));
            await act(async () => {
              await emptyHook.result.current.handleAiSort('introduction');
            });
            expect(mockToast.info).toHaveBeenCalled();
            expect(mockSortItemsWithAI).not.toHaveBeenCalledWith(expect.anything(), [], expect.anything(), expect.anything());
            mockToast.info.mockClear();
          },
        },
        {
          name: 'dataset limit warning',
          run: async () => {
            const manyItems = Array.from({ length: 51 }, (_, i) => ({
              id: `thought-${i}`,
              content: `Test thought ${i}`,
              requiredTags: ['introduction'],
              customTagNames: [],
            }));
            const hook = renderHook(() =>
              useAiSortingDiff({ ...defaultProps, containers: { ...mockContainers, introduction: manyItems } }),
            );
            await act(async () => {
              await hook.result.current.handleAiSort('introduction');
            });
            expect(mockToast.warning).toHaveBeenCalled();
            expect(mockSortItemsWithAI).not.toHaveBeenCalled();
            mockToast.warning.mockClear();
          },
        },
      ], {
        afterEachScenario: () => {
          jest.clearAllMocks();
        }
      });
    });
  });

  describe('diff mode management', () => {
    it('activates diff mode and highlights changed items in one verification', async () => {
      const mockSetContainers = jest.fn();
      const changedItems = [{ ...mockContainers.introduction[0], outlinePointId: 'intro-1' }];
      mockSortItemsWithAI.mockResolvedValue(changedItems);
      const { result } = renderHook(() => useAiSortingDiff({ ...defaultProps, setContainers: mockSetContainers }));
      await act(async () => {
        await result.current.handleAiSort('introduction');
      });
      expect(result.current.isDiffModeActive).toBe(true);
      expect(result.current.preSortState).toEqual({ introduction: mockContainers.introduction });
      expect(result.current.highlightedItems).toHaveProperty('thought-1');
    });
  });

  describe('item management in diff mode', () => {
    it('covers keep/revert operations for single and bulk actions together', async () => {
      const mockSetContainers = jest.fn();
      const changedItems = [{ ...mockContainers.introduction[0], outlinePointId: 'intro-1' }];
      mockSortItemsWithAI.mockResolvedValue(changedItems);
      const { result } = renderHook(() => useAiSortingDiff({ ...defaultProps, setContainers: mockSetContainers }));
      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      act(() => result.current.handleKeepItem('thought-1', 'introduction'));
      expect(result.current.highlightedItems).not.toHaveProperty('thought-1');

      act(() => result.current.handleRevertItem('thought-1', 'introduction'));
      expect(mockSetContainers).toHaveBeenCalled();

      mockSetContainers.mockClear();
      act(() => result.current.handleKeepAll('introduction'));
      expect(result.current.isDiffModeActive).toBe(false);

      // Re-activate diff mode and revert all
      mockSortItemsWithAI.mockResolvedValue(changedItems);
      await act(async () => {
        await result.current.handleAiSort('introduction');
      });
      act(() => result.current.handleRevertAll('introduction'));
      expect(result.current.highlightedItems).toEqual({});
      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('state management', () => {
    it('updates derived state and triggers persistence in a single test', async () => {
      const mockSetContainers = jest.fn();
      const changedItems = [{ ...mockContainers.introduction[0], outlinePointId: 'intro-1' }];
      mockSortItemsWithAI.mockResolvedValue(changedItems);
      const { result } = renderHook(() => useAiSortingDiff({ ...defaultProps, setContainers: mockSetContainers }));
      await act(async () => {
        await result.current.handleAiSort('introduction');
      });
      expect(mockSetContainers).toHaveBeenCalled();

      act(() => {
        result.current.handleKeepItem('thought-1', 'introduction');
      });
      expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();

      act(() => result.current.setHighlightedItems(['test-item']));
      expect(result.current.highlightedItems).toEqual(['test-item']);
      act(() => result.current.setIsDiffModeActive(true));
      expect(result.current.isDiffModeActive).toBe(true);
      act(() => result.current.setPreSortState([]));
      expect(result.current.preSortState).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('coalesces error scenarios', async () => {
      jest.clearAllMocks();
      mockSortItemsWithAI.mockRejectedValueOnce(new Error('Network error'));
      const { result } = renderHook(() => useAiSortingDiff(defaultProps));
      await act(async () => {
        await result.current.handleAiSort('introduction');
      });
      expect(mockToast.error).toHaveBeenCalled();
      mockToast.error.mockClear();

      mockSortItemsWithAI.mockResolvedValueOnce({ success: false, error: 'Invalid response' } as any);
      const invalidResult = renderHook(() => useAiSortingDiff(defaultProps));
      await act(async () => {
        await invalidResult.result.current.handleAiSort('introduction');
      });
      expect(mockToast.error).toHaveBeenCalled();
      mockToast.error.mockClear();

      mockSortItemsWithAI.mockClear();

      const noSermonHook = renderHook(() => useAiSortingDiff({ ...defaultProps, sermon: null as any }));
      await act(async () => {
        await noSermonHook.result.current.handleAiSort('introduction');
      });
      expect(mockSortItemsWithAI).not.toHaveBeenCalled();
    });
  });

  describe('performance and optimization', () => {
    it('enforces dataset limits and triggers debounced saves together', async () => {
      const largeItems = Array.from({ length: 25 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Test thought ${i}`,
        requiredTags: ['introduction'],
        customTagNames: [],
      }));
      const largeHook = renderHook(() =>
        useAiSortingDiff({ ...defaultProps, containers: { ...mockContainers, introduction: largeItems } }),
      );
      await act(async () => {
        await largeHook.result.current.handleAiSort('introduction');
      });
      expect(mockSortItemsWithAI).toHaveBeenCalledWith(
        'introduction',
        largeItems,
        'sermon-1',
        mockOutlinePoints.introduction,
      );

      const overflowItems = Array.from({ length: 30 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Overflow thought ${i}`,
        requiredTags: ['introduction'],
        customTagNames: [],
      }));
      const overflowHook = renderHook(() =>
        useAiSortingDiff({ ...defaultProps, containers: { ...mockContainers, introduction: overflowItems } }),
      );
      await act(async () => {
        await overflowHook.result.current.handleAiSort('introduction');
      });
      expect(mockToast.warning).toHaveBeenCalled();
      mockToast.warning.mockClear();

      mockSortItemsWithAI.mockResolvedValue([{ ...mockContainers.introduction[0], outlinePointId: 'intro-1' }]);
      const debounceHook = renderHook(() => useAiSortingDiff(defaultProps));
      await act(async () => {
        await debounceHook.result.current.handleAiSort('introduction');
      });
      act(() => debounceHook.result.current.handleKeepItem('thought-1', 'introduction'));
      expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('runs AI sorting end-to-end across sections once', async () => {
      const mockSetContainers = jest.fn();
      const hook = renderHook(() => useAiSortingDiff({ ...defaultProps, setContainers: mockSetContainers }));
      await act(async () => {
        await hook.result.current.handleAiSort('main');
      });
      expect(mockSortItemsWithAI).toHaveBeenCalledWith('main', mockContainers.main, 'sermon-1', mockOutlinePoints.main);

      mockSortItemsWithAI.mockResolvedValue([{ ...mockContainers.introduction[0], outlinePointId: 'intro-1' }]);
      await act(async () => {
        await hook.result.current.handleAiSort('introduction');
      });
      act(() => hook.result.current.handleKeepAll('introduction'));
      expect(hook.result.current.isDiffModeActive).toBe(false);
      expect(mockSetContainers).toHaveBeenCalled();
    });
  });
});
