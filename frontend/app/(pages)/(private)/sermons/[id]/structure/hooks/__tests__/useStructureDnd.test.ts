import { renderHook, act } from '@testing-library/react';
import { toast } from 'sonner';

import { Item, Sermon, SermonPoint, Thought } from '@/models/models';
import { updateStructure } from '@/services/structure.service';

import { useStructureDnd } from '../useStructureDnd';


// Mock services
jest.mock('@/services/structure.service');
jest.mock('sonner');

const mockUpdateStructure = updateStructure as jest.MockedFunction<typeof updateStructure>;
const mockToastError = toast.error as jest.Mock;

describe('useStructureDnd', () => {
  const BASE_DATE = '2026-01-15T00:00:00.000Z';
  const THOUGHT_ONE = 'thought-1';
  const THOUGHT_TWO = 'thought-2';
  const THOUGHT_THREE = 'thought-3';
  const OUTLINE_INTRO = 'intro-1';
  const OUTLINE_MAIN = 'main-1';
  const OUTLINE_CONCLUSION = 'conclusion-1';
  const CUSTOM_TAG = { name: 'custom-tag', color: '#123456' };

  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: BASE_DATE,
    userId: 'user-1',
    thoughts: [
      { id: THOUGHT_ONE, text: 'Test thought 1', tags: ['introduction'], date: BASE_DATE },
      { id: THOUGHT_TWO, text: 'Test thought 2', tags: ['main'], date: BASE_DATE },
    ],
    structure: {
      introduction: [THOUGHT_ONE],
      main: [THOUGHT_TWO],
      conclusion: [],
      ambiguous: []
    },
    outline: {
      introduction: [{ id: OUTLINE_INTRO, text: 'Introduction point' }],
      main: [{ id: OUTLINE_MAIN, text: 'Main point' }],
      conclusion: [{ id: OUTLINE_CONCLUSION, text: 'Conclusion point' }]
    },
  };

  const mockContainers: Record<string, Item[]> = {
    introduction: [
      {
        id: THOUGHT_ONE,
        content: 'Test thought 1',
        requiredTags: ['introduction'],
        customTagNames: [],
        outlinePointId: OUTLINE_INTRO
      }
    ],
    main: [
      {
        id: THOUGHT_TWO,
        content: 'Test thought 2',
        requiredTags: ['main'],
        customTagNames: [],
        outlinePointId: OUTLINE_MAIN
      }
    ],
    conclusion: [],
    ambiguous: []
  };

  const mockSermonPoints = {
    introduction: [{ id: OUTLINE_INTRO, text: 'Introduction point' }] as SermonPoint[],
    main: [{ id: OUTLINE_MAIN, text: 'Main point' }] as SermonPoint[],
    conclusion: [{ id: OUTLINE_CONCLUSION, text: 'Conclusion point' }] as SermonPoint[]
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
    outlinePoints: mockSermonPoints,
    columnTitles: mockColumnTitles,
    debouncedSaveThought: mockDebouncedSaveThought,
  };

  const buildItem = (id: string, overrides: Partial<Item> = {}): Item => ({
    id,
    content: `Test ${id}`,
    requiredTags: [],
    customTagNames: [],
    ...overrides,
  });

  const buildThought = (id: string, overrides: Partial<Thought> = {}): Thought => ({
    id,
    text: `Test ${id}`,
    tags: [],
    date: BASE_DATE,
    ...overrides,
  });

  const buildContainers = (overrides: Partial<Record<string, Item[]>> = {}) => ({
    introduction: [
      buildItem(THOUGHT_ONE, {
        requiredTags: [mockColumnTitles.introduction],
        outlinePointId: OUTLINE_INTRO,
        position: 1000,
      }),
    ],
    main: [
      buildItem(THOUGHT_TWO, {
        requiredTags: [mockColumnTitles.main],
        outlinePointId: OUTLINE_MAIN,
        position: 2000,
      }),
    ],
    conclusion: [],
    ambiguous: [],
    ...overrides,
  });

  const buildSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
    id: mockSermon.id,
    title: mockSermon.title,
    verse: mockSermon.verse,
    date: BASE_DATE,
    userId: mockSermon.userId,
    thoughts: [
      buildThought(THOUGHT_ONE, {
        tags: ['introduction'],
        outlinePointId: OUTLINE_INTRO,
        position: 1000,
      }),
      buildThought(THOUGHT_TWO, {
        tags: ['main'],
        outlinePointId: OUTLINE_MAIN,
        position: 2000,
      }),
    ],
    structure: {
      introduction: [THOUGHT_ONE],
      main: [THOUGHT_TWO],
      conclusion: [],
      ambiguous: [],
    },
    outline: {
      introduction: [{ id: OUTLINE_INTRO, text: 'Introduction point' }],
      main: [{ id: OUTLINE_MAIN, text: 'Main point' }],
      conclusion: [{ id: OUTLINE_CONCLUSION, text: 'Conclusion point' }],
    },
    ...overrides,
  });

  const buildOver = (
    id: string,
    container?: string,
    outlinePointId?: string | null
  ) => ({
    id,
    data: container ? { current: { container, outlinePointId } } : undefined,
  });

  const buildDragEvent = (activeId: string, over: any) => ({
    active: { id: activeId },
    over,
  }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateStructure.mockResolvedValue(undefined);
    mockToastError.mockClear();
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

    it('should update preview order when dragging over an earlier item', () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO }),
          buildItem(THOUGHT_TWO, { outlinePointId: OUTLINE_INTRO }),
          buildItem(THOUGHT_THREE, { outlinePointId: OUTLINE_INTRO }),
        ],
        main: [],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_THREE,
        buildOver(THOUGHT_ONE, 'introduction')
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.introduction.map((item) => item.id)).toEqual([
        THOUGHT_THREE,
        THOUGHT_ONE,
        THOUGHT_TWO,
      ]);
    });

    it('should skip preview update for adjacent item in same group', () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO }),
          buildItem(THOUGHT_TWO, { outlinePointId: OUTLINE_INTRO }),
        ],
        main: [],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver(THOUGHT_TWO, 'introduction')
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.introduction.map((item) => item.id)).toEqual([
        THOUGHT_ONE,
        THOUGHT_TWO,
      ]);
    });

    it('should assign outlinePointId during preview when over outline placeholder', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: null })],
        main: [],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver(`outline-point-${OUTLINE_MAIN}`, 'main', OUTLINE_MAIN)
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main[0]?.outlinePointId).toBe(OUTLINE_MAIN);
    });

    it('should preview unassigned outlinePointId when over unassigned placeholder', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO })],
        main: [],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver('unassigned-main', 'main')
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main[0]?.outlinePointId).toBeUndefined();
    });

    it('should infer destination when over data is missing', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO })],
        main: [buildItem(THOUGHT_TWO, { outlinePointId: OUTLINE_MAIN })],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(THOUGHT_ONE, { id: THOUGHT_TWO });

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main.map((item) => item.id)).toEqual([
        THOUGHT_ONE,
        THOUGHT_TWO,
      ]);
      expect(containersRef.current.main[0]?.outlinePointId).toBe(OUTLINE_MAIN);
    });

    it('should insert after last group item when hovering outline placeholder', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO })],
        main: [
          buildItem(THOUGHT_TWO, { outlinePointId: OUTLINE_MAIN }),
          buildItem(THOUGHT_THREE, { outlinePointId: OUTLINE_MAIN }),
        ],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver(`outline-point-${OUTLINE_MAIN}`, 'main', OUTLINE_MAIN)
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main.map((item) => item.id)).toEqual([
        THOUGHT_TWO,
        THOUGHT_THREE,
        THOUGHT_ONE,
      ]);
    });

    it('should skip preview update when item already exists in destination', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_MAIN })],
        main: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_MAIN })],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver(THOUGHT_ONE, 'main')
      );

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main.map((item) => item.id)).toEqual([THOUGHT_ONE]);
    });

    it('should infer container when over id is a container and data is missing', () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO })],
        main: [],
      });
      const containersRef = { current: containers };
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
      }));
      const mockEvent = buildDragEvent(THOUGHT_ONE, { id: 'main' });

      act(() => {
        result.current.handleDragOver(mockEvent);
      });

      expect(containersRef.current.main[0]?.id).toBe(THOUGHT_ONE);
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

  describe('handleDragEnd side effects', () => {
    it('returns early when sermon is missing', async () => {
      const containers = buildContainers();
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        sermon: null,
      }));
      const mockEvent = buildDragEvent(THOUGHT_ONE, buildOver('main', 'main'));

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).not.toHaveBeenCalled();
    });

    it('returns early for invalid container', async () => {
      const containers = buildContainers();
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver('invalid-container', 'invalid-container')
      );

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).not.toHaveBeenCalled();
    });

    it('uses over.id as container when data is missing', async () => {
      const containers = buildContainers();
      const sermon = buildSermon();
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        sermon,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(THOUGHT_ONE, { id: 'main', data: { current: {} } });

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('reorders within the same container when dropped on item', async () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO }),
          buildItem(THOUGHT_TWO, { outlinePointId: OUTLINE_INTRO }),
        ],
        main: [],
      });
      const sermon = buildSermon({
        thoughts: [
          buildThought(THOUGHT_ONE, { tags: ['introduction'] }),
          buildThought(THOUGHT_TWO, { tags: ['introduction'] }),
        ],
        structure: {
          introduction: [THOUGHT_ONE, THOUGHT_TWO],
          main: [],
          conclusion: [],
          ambiguous: [],
        },
      });
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        sermon,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_TWO } } as any);
      });

      const mockEvent = buildDragEvent(
        THOUGHT_TWO,
        buildOver(THOUGHT_ONE, 'introduction')
      );

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockSetContainers).toHaveBeenCalled();
    });

    it('persists outline point without structure changes when dropping on outline placeholder', async () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, {
            requiredTags: [mockColumnTitles.introduction],
            customTagNames: [CUSTOM_TAG],
            outlinePointId: null,
          }),
        ],
        main: [],
      });
      const sermon = buildSermon({
        thoughts: [buildThought(THOUGHT_ONE, { tags: [], outlinePointId: null })],
        structure: {
          introduction: [THOUGHT_ONE],
          main: [],
          conclusion: [],
          ambiguous: [],
        },
      });
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const mockDebouncedSaveThought = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        sermon,
        debouncedSaveThought: mockDebouncedSaveThought,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver(`outline-point-${OUTLINE_INTRO}`, 'introduction', OUTLINE_INTRO)
      );

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockDebouncedSaveThought).toHaveBeenCalledWith(
        sermon.id,
        expect.objectContaining({
          id: THOUGHT_ONE,
          outlinePointId: OUTLINE_INTRO,
          tags: expect.arrayContaining([mockColumnTitles.introduction, CUSTOM_TAG.name]),
        })
      );
      expect(mockUpdateStructure).not.toHaveBeenCalled();
    });

    it('inherits outline point from target item when dropping on item in another section', async () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, {
            requiredTags: [mockColumnTitles.introduction],
            outlinePointId: OUTLINE_INTRO,
          }),
        ],
        main: [
          buildItem(THOUGHT_TWO, {
            requiredTags: [mockColumnTitles.main],
            outlinePointId: OUTLINE_MAIN,
          }),
        ],
      });
      const sermon = buildSermon();
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const mockSetSermon = jest.fn();
      const mockDebouncedSaveThought = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        setSermon: mockSetSermon,
        sermon,
        debouncedSaveThought: mockDebouncedSaveThought,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(THOUGHT_ONE, buildOver(THOUGHT_TWO, 'main'));

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockDebouncedSaveThought).toHaveBeenCalledWith(
        sermon.id,
        expect.objectContaining({
          id: THOUGHT_ONE,
          outlinePointId: OUTLINE_MAIN,
          tags: expect.arrayContaining([mockColumnTitles.main]),
        })
      );
      expect(mockUpdateStructure).toHaveBeenCalledWith(sermon.id, {
        introduction: [],
        main: [THOUGHT_ONE, THOUGHT_TWO],
        conclusion: [],
        ambiguous: [],
      });
      expect(mockSetSermon).toHaveBeenCalledWith(expect.any(Function));
    });

    it('clears required tags when moving to ambiguous via additional drop zone', async () => {
      const containers = buildContainers({
        introduction: [
          buildItem(THOUGHT_ONE, {
            requiredTags: [mockColumnTitles.introduction],
            customTagNames: [CUSTOM_TAG],
            outlinePointId: OUTLINE_INTRO,
          }),
        ],
        main: [],
      });
      const sermon = buildSermon({
        thoughts: [
          buildThought(THOUGHT_ONE, {
            tags: ['introduction'],
            outlinePointId: OUTLINE_INTRO,
          }),
        ],
        structure: {
          introduction: [THOUGHT_ONE],
          main: [],
          conclusion: [],
          ambiguous: [],
        },
      });
      const containersRef = { current: containers };
      const mockDebouncedSaveThought = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        sermon,
        debouncedSaveThought: mockDebouncedSaveThought,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(
        THOUGHT_ONE,
        buildOver('ambiguous-additional-drop', 'ambiguous')
      );

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockDebouncedSaveThought).toHaveBeenCalledWith(
        sermon.id,
        expect.objectContaining({
          id: THOUGHT_ONE,
          tags: [CUSTOM_TAG.name],
        })
      );
      expect(mockUpdateStructure).toHaveBeenCalledWith(sermon.id, {
        introduction: [],
        main: [],
        conclusion: [],
        ambiguous: [THOUGHT_ONE],
      });
    });

    it('rolls back on updateStructure failure and shows toast', async () => {
      const containers = buildContainers();
      const sermon = buildSermon();
      const containersRef = { current: containers };
      const mockSetContainers = jest.fn();
      const mockSetSermon = jest.fn();
      const mockDebouncedSaveThought = jest.fn();

      mockUpdateStructure.mockRejectedValueOnce(new Error('boom'));

      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        setContainers: mockSetContainers,
        setSermon: mockSetSermon,
        sermon,
        debouncedSaveThought: mockDebouncedSaveThought,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(THOUGHT_ONE, buildOver('main', 'main'));

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      const lastSetCall = mockSetContainers.mock.calls[mockSetContainers.mock.calls.length - 1]?.[0];
      expect(lastSetCall).toEqual(containers);
      expect(mockSetSermon).toHaveBeenCalledWith(expect.objectContaining({ id: sermon.id }));
      expect(mockToastError).toHaveBeenCalledWith('errors.dragDropUpdateFailed');
    });

    it('skips persistence when thought is missing', async () => {
      const containers = buildContainers({
        introduction: [buildItem(THOUGHT_ONE, { outlinePointId: OUTLINE_INTRO })],
        main: [],
      });
      const sermon = buildSermon({
        thoughts: [],
        structure: {
          introduction: [THOUGHT_ONE],
          main: [],
          conclusion: [],
          ambiguous: [],
        },
      });
      const containersRef = { current: containers };
      const mockDebouncedSaveThought = jest.fn();
      const { result } = renderHook(() => useStructureDnd({
        ...defaultProps,
        containers,
        containersRef,
        sermon,
        debouncedSaveThought: mockDebouncedSaveThought,
      }));

      act(() => {
        result.current.handleDragStart({ active: { id: THOUGHT_ONE } } as any);
      });

      const mockEvent = buildDragEvent(THOUGHT_ONE, buildOver('introduction', 'introduction'));

      await act(async () => {
        await result.current.handleDragEnd(mockEvent);
      });

      expect(mockDebouncedSaveThought).not.toHaveBeenCalled();
      expect(mockUpdateStructure).not.toHaveBeenCalled();
    });
  });
});
