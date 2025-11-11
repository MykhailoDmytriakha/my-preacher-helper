import { renderHook, act } from '@testing-library/react';
import { useAiSortingDiff } from '../useAiSortingDiff';
import { sortItemsWithAI } from '@/services/sortAI.service';
import { Item, OutlinePoint, Thought, Sermon, Structure } from '@/models/models';
import { toast } from 'sonner';

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
    it('should handle successful AI sorting', async () => {
      // Mock AI sorting to return sorted items with changes
      mockSortItemsWithAI.mockResolvedValueOnce([
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }, // Changed outline point
        { ...mockContainers.introduction[1], position: 2000 } // Changed position
      ]);
      
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockSortItemsWithAI).toHaveBeenCalledWith(
        'introduction',
        mockContainers.introduction,
        'sermon-1',
        mockOutlinePoints.introduction
      );
      expect(result.current.isSorting).toBe(false);
      expect(result.current.isDiffModeActive).toBe(true);
      expect(result.current.preSortState).toEqual({ introduction: mockContainers.introduction });
    });

    it('should handle AI sorting errors', async () => {
      mockSortItemsWithAI.mockRejectedValueOnce(new Error('AI sorting failed'));
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.error).toHaveBeenCalled();
      expect(result.current.isSorting).toBe(false);
      expect(result.current.isDiffModeActive).toBe(false);
    });

    it('should handle AI sorting with no changes', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return the same items (no changes)
      mockSortItemsWithAI.mockResolvedValue(mockContainers.introduction);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.info).toHaveBeenCalled();
      expect(result.current.isDiffModeActive).toBe(false);
    });

    it('should handle AI sorting with no items to sort', async () => {
      const emptyContainers = { ...mockContainers, introduction: [] };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        containers: emptyContainers,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.info).toHaveBeenCalled();
      expect(mockSortItemsWithAI).not.toHaveBeenCalled();
    });

    it('should handle AI sorting with maximum thoughts limit', async () => {
      const manyItems = Array.from({ length: 51 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Test thought ${i}`,
        requiredTags: ['introduction'],
        customTagNames: []
      }));
      const manyContainers = { ...mockContainers, introduction: manyItems };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        containers: manyContainers,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.warning).toHaveBeenCalled();
      expect(mockSortItemsWithAI).not.toHaveBeenCalled();
    });
  });

  describe('diff mode management', () => {
    it('should activate diff mode after successful sorting', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return different items (with changes)
      // thought-1 gets assigned to an outline point (was unassigned before)
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(result.current.isDiffModeActive).toBe(true);
      expect(result.current.preSortState).toEqual({ introduction: mockContainers.introduction });
      expect(result.current.highlightedItems).toHaveProperty('thought-1'); // thought-1 gets assigned to outline point
    });

    it('should highlight changed items correctly', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return different items (with changes)
      // thought-1 gets assigned to an outline point (was unassigned before)
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(result.current.highlightedItems).toHaveProperty('thought-1'); // thought-1 gets assigned to outline point
    });
  });

  describe('item management in diff mode', () => {
    it('should handle keeping individual items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First activate diff mode
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Now keep an individual item
      act(() => {
        result.current.handleKeepItem('thought-1', 'introduction');
      });

      expect(result.current.highlightedItems).not.toHaveProperty('thought-1');
      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle reverting individual items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First activate diff mode
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Now revert an individual item
      act(() => {
        result.current.handleRevertItem('thought-1', 'introduction');
      });

      expect(result.current.highlightedItems).not.toHaveProperty('thought-1');
      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle keeping all items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First activate diff mode
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Now keep all items
      act(() => {
        result.current.handleKeepAll('introduction');
      });

      expect(result.current.isDiffModeActive).toBe(false);
      expect(result.current.highlightedItems).toEqual({});
      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle reverting all items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First activate diff mode
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Now revert all items
      act(() => {
        result.current.handleRevertAll('introduction');
      });

      expect(result.current.isDiffModeActive).toBe(false);
      expect(result.current.highlightedItems).toEqual({});
      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('state management', () => {
    it('should update containers state after sorting', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return different items (with changes)
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should save structure after successful sorting', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return different items (with changes)
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Keep an item to trigger save
      act(() => {
        result.current.handleKeepItem('thought-1', 'introduction');
      });

      expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();
    });

    it('should handle state updates correctly', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Test state setters
      act(() => {
        result.current.setHighlightedItems(['test-item']);
      });
      expect(result.current.highlightedItems).toEqual(['test-item']);

      act(() => {
        result.current.setIsDiffModeActive(true);
      });
      expect(result.current.isDiffModeActive).toBe(true);

      act(() => {
        result.current.setPreSortState([]);
      });
      expect(result.current.preSortState).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should handle network errors gracefully', async () => {
      mockSortItemsWithAI.mockRejectedValueOnce(new Error('Network error'));
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.error).toHaveBeenCalled();
      expect(result.current.isSorting).toBe(false);
    });

    it('should handle invalid AI responses', async () => {
      mockSortItemsWithAI.mockResolvedValueOnce({
        success: false,
        error: 'Invalid response'
      } as any);
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.error).toHaveBeenCalled();
      expect(result.current.isSorting).toBe(false);
    });

    it('should handle missing sermon data', async () => {
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        sermon: null
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Should not call any toast functions when sermon is null
      expect(mockToast.error).not.toHaveBeenCalled();
      expect(mockToast.info).not.toHaveBeenCalled();
      expect(mockToast.warning).not.toHaveBeenCalled();
      expect(mockToast.success).not.toHaveBeenCalled();
      expect(mockSortItemsWithAI).not.toHaveBeenCalled();
    });
  });

  describe('performance and optimization', () => {
    it('should handle datasets up to the AI sorting limit efficiently', async () => {
      const largeItems = Array.from({ length: 25 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Test thought ${i}`,
        requiredTags: ['introduction'],
        customTagNames: []
      }));
      const largeContainers = { ...mockContainers, introduction: largeItems };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        containers: largeContainers,
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockSortItemsWithAI).toHaveBeenCalledWith(
        'introduction',
        largeItems,
        'sermon-1',
        mockOutlinePoints.introduction
      );
    });

    it('should block AI sorting when dataset exceeds limit', async () => {
      const overflowItems = Array.from({ length: 30 }, (_, i) => ({
        id: `thought-${i}`,
        content: `Overflow thought ${i}`,
        requiredTags: ['introduction'],
        customTagNames: []
      }));
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        containers: { ...mockContainers, introduction: overflowItems },
        setContainers: mockSetContainers
      }));

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(mockToast.warning).toHaveBeenCalled();
      expect(mockSortItemsWithAI).not.toHaveBeenCalled();
    });

    it('should debounce save operations correctly', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock the AI service to return different items (with changes)
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      // Keep an item to trigger save
      act(() => {
        result.current.handleKeepItem('thought-1', 'introduction');
      });

      // Should call debounced save functions
      expect(defaultProps.debouncedSaveStructure).toHaveBeenCalled();
    });
  });

  describe('integration scenarios', () => {
    it('should work with different sections', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Test with main section
      await act(async () => {
        await result.current.handleAiSort('main');
      });

      expect(mockSortItemsWithAI).toHaveBeenCalledWith(
        'main',
        mockContainers.main,
        'sermon-1',
        mockOutlinePoints.main
      );
    });

    it('should handle complete workflow from sorting to acceptance', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useAiSortingDiff({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // 1. Start AI sorting
      const changedItems = [
        { ...mockContainers.introduction[0], outlinePointId: 'intro-1' }
      ];
      mockSortItemsWithAI.mockResolvedValue(changedItems);

      await act(async () => {
        await result.current.handleAiSort('introduction');
      });

      expect(result.current.isDiffModeActive).toBe(true);

      // 2. Accept all changes
      act(() => {
        result.current.handleKeepAll('introduction');
      });

      // 3. Verify final state
      expect(result.current.isDiffModeActive).toBe(false);
      expect(result.current.highlightedItems).toEqual({});
      expect(mockSetContainers).toHaveBeenCalled();
    });
  });
});
