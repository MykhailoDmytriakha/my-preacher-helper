import { Sermon, SermonPoint, Thought, Item } from '@/models/models';

// This is a utility file for test helpers, not a test suite
// It should not be run as tests
export const createMockThought = (overrides: Partial<Thought> = {}): Thought => ({
  id: `thought-${Math.random()}`,
  text: 'Test thought',
  tags: [],
  date: new Date().toISOString(),
  ...overrides,
});

export const createMockSermonPoint = (overrides: Partial<SermonPoint> = {}): SermonPoint => ({
  id: `op-${Math.random()}`,
  text: 'Test outline point',
  ...overrides,
});

export const createMockItem = (overrides: Partial<Item> = {}): Item => ({
  id: `item-${Math.random()}`,
  content: 'Test content',
  requiredTags: [],
  customTagNames: [],
  ...overrides,
});

export const createMockSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
  id: 'sermon-123',
  title: 'Test Sermon',
  verse: '',
  thoughts: [],
  structure: {
    introduction: [],
    main: [],
    conclusion: [],
    ambiguous: [],
  },
  outline: {
    introduction: [],
    main: [],
    conclusion: [],
  },
  date: new Date().toISOString(),
  userId: 'user-123',
  ...overrides,
});

export const mockTranslations: Record<string, string> = {
  'structure.introduction': 'Introduction',
  'structure.mainPart': 'Main Part',
  'structure.conclusion': 'Conclusion',
  'structure.underConsideration': 'Under Consideration',
  'structure.title': 'ThoughtsBySection',
  'structure.backToSermon': 'Back to Sermon',
  'structure.noEntries': 'No entries',
  'structure.dropThoughtsHere': 'Drop thoughts here',
  'structure.dropThoughtsToAdd': 'Drop thoughts here to add to this point',
  'structure.dropToUnassign': 'Drop thoughts here to unassign them from outline points',
  'structure.dropToAmbiguous': 'Drop thoughts here to mark as unclear',
  'structure.unassignedThoughts': 'Unassigned Thoughts',
  'structure.noItemsToSort': 'No items to sort',
  'structure.aiSortSuggestionsReady': 'AI sorting completed',
  'structure.aiSortNoChanges': 'AI sort did not suggest any changes',
  'structure.aiSortChangesAccepted': 'All AI suggestions accepted',
  'structure.aiSortChangesReverted': 'All AI suggestions reverted',
  'structure.thoughtDeletedSuccess': 'Thought deleted successfully',
  'structure.focusMode': 'Focus Mode',
  'structure.normalMode': 'Normal Mode',
  'structure.sortButton': 'Sort',
  'structure.outlinePoints': 'SermonOutline Points',
  'structure.addPointButton': 'Add Point',
  'structure.sermonNotFound': 'Sermon not found',
  'common.loading': 'Loading',
  'common.edit': 'Edit',
  'common.delete': 'Delete',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'errors.fetchSermonStructureError': 'Error fetching structure',
  'errors.failedToSaveStructure': 'Failed to save structure',
  'errors.failedToSaveThought': 'Failed to save thought',
  'errors.deletingError': 'Failed to delete thought',
};

export const setupCommonMocks = () => {
  jest.mock('next/navigation', () => ({
    useRouter: () => ({
      push: jest.fn(),
      prefetch: jest.fn(),
      replace: jest.fn(),
    }),
    useParams: () => ({
      id: 'sermon-123',
    }),
    useSearchParams: () => ({
      get: jest.fn((param: string) => {
        if (param === 'sermonId') return 'sermon-123';
        return null;
      }),
    }),
    usePathname: jest.fn().mockReturnValue('/sermons/sermon-123/structure'),
  }));

  jest.mock('react-i18next', () => ({
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) => {
        if (options?.defaultValue) return options.defaultValue as string;
        return mockTranslations[key] || key;
      },
    }),
  }));

  jest.mock('@/utils/themeColors', () => ({
    SERMON_SECTION_COLORS: {
      introduction: {
        base: '#3b82f6',
        bg: 'bg-blue-50',
        darkBg: 'bg-blue-900/20',
        text: 'text-blue-900',
        darkText: 'text-blue-100',
        border: 'border-blue-200',
        darkBorder: 'border-blue-800',
        hover: 'hover:bg-blue-100',
        darkHover: 'hover:bg-blue-800/30',
      },
      mainPart: {
        base: '#8b5cf6',
        bg: 'bg-purple-50',
        darkBg: 'bg-purple-900/20',
        text: 'text-purple-900',
        darkText: 'text-purple-100',
        border: 'border-purple-200',
        darkBorder: 'border-purple-800',
        hover: 'hover:bg-purple-100',
        darkHover: 'hover:bg-purple-800/30',
      },
      conclusion: {
        base: '#10b981',
        bg: 'bg-green-50',
        darkBg: 'bg-green-900/20',
        text: 'text-green-900',
        darkText: 'text-green-100',
        border: 'border-green-200',
        darkBorder: 'border-green-800',
        hover: 'hover:bg-green-100',
        darkHover: 'hover:bg-green-800/30',
      },
    },
    UI_COLORS: {
      neutral: {
        bg: 'bg-white',
        darkBg: 'bg-gray-800',
        text: 'text-gray-900',
        darkText: 'text-gray-100',
        border: 'border-gray-200',
        darkBorder: 'border-gray-700',
      },
      muted: {
        text: 'text-gray-600',
        darkText: 'text-gray-400',
      },
      success: {
        bg: 'bg-green-600',
        darkBg: 'bg-green-700',
        text: 'text-white',
        darkText: 'text-white',
      },
    },
  }));

  jest.mock('@/components/ExportButtons', () => ({
    __esModule: true,
    default: jest.fn(() => null),
  }));

  jest.mock('sonner', () => ({
    toast: {
      success: jest.fn(),
      error: jest.fn(),
      loading: jest.fn(),
    },
  }));

  jest.mock('lodash/debounce', () =>
    jest.fn((fn) => {
      const debouncedFn = (...args: any[]) => fn(...args);
      debouncedFn.cancel = jest.fn();
      debouncedFn.flush = jest.fn();
      return debouncedFn;
    })
  );
};

export const mockServices = {
  structure: {
    updateStructure: jest.fn().mockResolvedValue({}),
  },
  thought: {
    updateThought: jest.fn().mockResolvedValue({}),
    deleteThought: jest.fn().mockResolvedValue({}),
    createManualThought: jest.fn().mockResolvedValue({
      id: 'new-thought',
      text: 'New thought',
      tags: [],
      date: new Date().toISOString(),
    }),
  },
  sortAI: {
    sortItemsWithAI: jest.fn().mockResolvedValue([]),
  },
  outline: {
    updateSermonOutline: jest.fn().mockResolvedValue({}),
    getSermonOutline: jest.fn().mockResolvedValue({
      introduction: [],
      main: [],
      conclusion: [],
    }),
  },
};

export const setupServiceMocks = () => {
  jest.mock('@/services/structure.service', () => ({
    updateStructure: mockServices.structure.updateStructure,
  }));

  jest.mock('@/services/thought.service', () => ({
    updateThought: mockServices.thought.updateThought,
    deleteThought: mockServices.thought.deleteThought,
    createManualThought: mockServices.thought.createManualThought,
  }));

  jest.mock('@/services/sortAI.service', () => ({
    sortItemsWithAI: mockServices.sortAI.sortItemsWithAI,
  }));

  jest.mock('@/services/outline.service', () => ({
    updateSermonOutline: mockServices.outline.updateSermonOutline,
    getSermonOutline: mockServices.outline.getSermonOutline,
  }));
};

export const createDragEvent = (
  activeId: string,
  overId: string,
  overData?: { container?: string; outlinePointId?: string | null }
) => ({
  active: {
    id: activeId,
    data: { current: {} },
  },
  over: {
    id: overId,
    data: { current: overData || {} },
  },
});

export const waitForDebounce = () => new Promise(resolve => setTimeout(resolve, 300));

export const createMockHookReturn = (sermon: any, containers?: Record<string, Item[]>, outlinePoints?: any) => ({
  sermon,
  setSermon: jest.fn(),
  containers: containers || { introduction: [], main: [], conclusion: [], ambiguous: [] },
  setContainers: jest.fn(),
  outlinePoints: outlinePoints || { introduction: [], main: [], conclusion: [] },
  requiredTagColors: {},
  allowedTags: [],
  loading: false,
  error: null,
  setLoading: jest.fn(),
  isAmbiguousVisible: true,
  setIsAmbiguousVisible: jest.fn(),
});
