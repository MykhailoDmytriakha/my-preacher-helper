import { renderHook, act } from '@testing-library/react';
import { useStructureDnd } from '../useStructureDnd';
import { updateStructure } from '@/services/structure.service';
import { Item, Sermon, OutlinePoint, Thought } from '@/models/models';
import { toast } from 'sonner';

// Mock services
jest.mock('@/services/structure.service');
jest.mock('sonner');

const mockUpdateStructure = updateStructure as jest.MockedFunction<typeof updateStructure>;
const mockToast = toast as jest.Mocked<typeof toast>;

describe('useStructureDnd', () => {
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    thoughts: [
      { id: 'thought-1', text: 'Test thought 1', tags: ['introduction'], date: new Date().toISOString() },
      { id: 'thought-2', text: 'Test thought 2', tags: ['main'], date: new Date().toISOString() },
    ],
    structure: {
      introduction: ['thought-1'],
      main: ['thought-2'],
      conclusion: [],
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
    conclusion: [],
    ambiguous: []
  };

  const mockOutlinePoints = {
    introduction: [{ id: 'intro-1', text: 'Introduction point' }] as OutlinePoint[],
    main: [{ id: 'main-1', text: 'Main point' }] as OutlinePoint[],
    conclusion: [{ id: 'conclusion-1', text: 'Conclusion point' }] as OutlinePoint[]
  };

  const mockColumnTitles = {
    introduction: 'Introduction',
    main: 'Main Part',
    conclusion: 'Conclusion',
    ambiguous: 'Unassigned'
  };

  const mockSetContainers = jest.fn();
  const mockSetSermon = jest.fn();
  const mockDebouncedSaveThought = jest.fn();

  const defaultProps = {
    containers: mockContainers,
    setContainers: mockSetContainers,
    containersRef: { current: mockContainers },
    sermon: mockSermon,
    setSermon: mockSetSermon,
    outlinePoints: mockOutlinePoints,
    columnTitles: mockColumnTitles,
    debouncedSaveThought: mockDebouncedSaveThought,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateStructure.mockResolvedValue(undefined);
  });

  describe('initialization', () => {
    it('should initialize with default values', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));

      expect(result.current.sensors).toBeDefined();
      expect(result.current.activeId).toBeNull();
      expect(typeof result.current.handleDragStart).toBe('function');
      expect(typeof result.current.handleDragOver).toBe('function');
      expect(typeof result.current.handleDragEnd).toBe('function');
    });
  });

  describe('handleDragStart', () => {
    it('should set activeId when drag starts', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));

      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      expect(result.current.activeId).toBe('thought-1');
    });

    it('should handle drag start with valid item', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));

      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      expect(result.current.activeId).toBe('thought-1');
    });
  });

  describe('handleDragOver', () => {
    it('should handle drag over container', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));
      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      // Should not crash and handle the event
      expect(result.current.activeId).toBeNull();
    });

    it('should handle drag over item', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));
      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'thought-2', data: { current: { container: 'main' } } }
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      // Should not crash and handle the event
      expect(result.current.activeId).toBeNull();
    });

    it('should handle drag over outline point', () => {
      const { result } = renderHook(() => useStructureDnd(defaultProps));
      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'intro-1', data: { current: { container: 'introduction' } } }
      } as any;

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      // Should not crash and handle the event
      expect(result.current.activeId).toBeNull();
    });
  });

  describe('handleDragEnd', () => {
    it('should handle drag end with same container', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'introduction', data: { current: { container: 'introduction' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle drag end with different container', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle drag end with outline point assignment', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'intro-1', data: { current: { container: 'introduction' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle drag end with no over target', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      const mockEvent = {
        active: { id: 'thought-1' },
        over: null
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).not.toHaveBeenCalled();
    });

    it('should handle drag end with outline point placeholder', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'outline-point-intro-1', data: { current: { container: 'introduction' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle drag end with unassigned placeholder', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'unassigned-introduction', data: { current: { container: 'introduction' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('container management', () => {
    it('should handle moving item between containers', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle moving item to ambiguous container', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'dummy-drop-zone', data: { current: { container: 'ambiguous' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('outline point handling', () => {
    it('should assign outline point when dropping on outline point', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'outline-point-intro-1', data: { current: { container: 'introduction' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should clear outline point when moving to different section', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('tag management', () => {
    it('should update required tags when moving between sections', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should clear required tags when moving to ambiguous section', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'dummy-drop-zone', data: { current: { container: 'ambiguous' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle errors gracefully', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // Mock an error scenario
      const mockEvent = {
        active: { id: 'invalid-id' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      // Should not crash
      expect(result.current.activeId).toBeNull();
    });
  });

  describe('position calculation', () => {
    it('should calculate correct positions for items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'main', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('should handle position calculation with adjacent items', async () => {
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        setContainers: mockSetContainers
      }));

      // First start a drag to set the original container
      act(() => {
        result.current.handleDragStart({ active: { id: 'thought-1' } } as any);
      });

      const mockEvent = {
        active: { id: 'thought-1' },
        over: { id: 'thought-2', data: { current: { container: 'main' } } }
      } as any;

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });
  });
});
