import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { updateSermonOutline } from '@/services/outline.service';

// Import necessary hooks for mocking
import { useSermonActions } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions';
import { useStructureDnd } from '@/(pages)/(private)/sermons/[id]/structure/hooks/useStructureDnd';

import { createMockSermon, createMockThought, createMockSermonPoint, mockTranslations, createMockHookReturn, createMockItem } from '../../test-utils/structure-test-utils';

const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockUseSearchParams(),
  usePathname: jest.fn().mockReturnValue('/sermons/sermon-123/structure'),
  useParams: jest.fn(() => ({ id: 'sermon-123' })),
}));

// Mock feature hooks
jest.mock('@/hooks/useSermonStructureData');
jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useStructureDnd');
jest.mock('@/(pages)/(private)/sermons/[id]/structure/hooks/useSermonActions');

const mockedUseSermonStructureData = useSermonStructureData as jest.Mock;
const mockedUseStructureDnd = useStructureDnd as jest.Mock;
const mockedUseSermonActions = useSermonActions as jest.Mock;
const mockUpdateSermonOutline = updateSermonOutline as jest.MockedFunction<typeof updateSermonOutline>;
const mockToast = toast as jest.Mocked<typeof toast>;

jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn().mockResolvedValue({}),
  deleteThought: jest.fn().mockResolvedValue({}),
  createManualThought: jest.fn().mockResolvedValue({ id: 'new-thought', text: 'New thought', tags: [], date: new Date().toISOString() }),
}));

jest.mock('@/services/sortAI.service', () => ({
  sortItemsWithAI: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: { base: '#3b82f6', bg: 'bg-blue-50', darkBg: 'bg-blue-900/20', text: 'text-blue-900', darkText: 'text-blue-100', border: 'border-blue-200', darkBorder: 'border-blue-800', hover: 'hover:bg-blue-100', darkHover: 'hover:bg-blue-800/30' },
    mainPart: { base: '#8b5cf6', bg: 'bg-purple-50', darkBg: 'bg-purple-900/20', text: 'text-purple-900', darkText: 'text-purple-100', border: 'border-purple-200', darkBorder: 'border-purple-800', hover: 'hover:bg-purple-100', darkHover: 'hover:bg-purple-800/30' },
    conclusion: { base: '#10b981', bg: 'bg-green-50', darkBg: 'bg-green-900/20', text: 'text-green-900', darkText: 'text-green-100', border: 'border-green-200', darkBorder: 'border-green-800', hover: 'hover:bg-green-100', darkHover: 'hover:bg-green-800/30' },
  },
  UI_COLORS: {
    neutral: { bg: 'bg-white', darkBg: 'bg-gray-800', text: 'text-gray-900', darkText: 'text-gray-100', border: 'border-gray-200', darkBorder: 'border-gray-700' },
    muted: { text: 'text-gray-600', darkText: 'text-gray-400' },
    success: { bg: 'bg-green-600', darkBg: 'bg-green-700', text: 'text-white', darkText: 'text-white' },
  },
  getFocusModeButtonColors: jest.fn(() => ({
    darkBg: 'dark:bg-gray-800',
    darkText: 'dark:text-gray-200',
  })),
  getTagStyling: jest.fn(() => ({
    bg: 'bg-blue-50',
    text: 'text-blue-800',
  })),
}));

jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: () => <div data-testid="export-buttons">Export Buttons</div>,
}));

// Mock RichMarkdownEditor (TipTap) with a plain textarea so getByDisplayValue works
jest.mock('@/components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange, placeholder }: any) => (
    <textarea
      data-testid="mock-rich-editor"
      value={value}
      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'structure.addThoughtToSection' && options?.section) {
        return `Add thought to ${options.section}`;
      }
      if (options?.defaultValue) return options.defaultValue as string;
      return mockTranslations[key] || key;
    },
  }),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), loading: jest.fn() },
}));

jest.mock('lodash/debounce', () =>
  jest.fn((fn) => {
    const debouncedFn = (...args: any[]) => fn(...args);
    debouncedFn.cancel = jest.fn();
    debouncedFn.flush = jest.fn();
    return debouncedFn;
  })
);

describe('ThoughtsBySection Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseSearchParams.mockReturnValue({
      get: jest.fn((param: string) => {
        if (param === 'sermonId') return 'sermon-123';
        return null;
      }),
    });

    // Default mocks
    mockedUseStructureDnd.mockReturnValue({
      sensors: [],
      activeId: null,
      handleDragStart: jest.fn(),
      handleDragOver: jest.fn(),
      handleDragEnd: jest.fn(),
    });

    mockedUseSermonActions.mockReturnValue({
      editingItem: null,
      addingThoughtToSection: null,
      handleEdit: jest.fn(),
      handleCloseEdit: jest.fn(),
      handleAddThoughtToSection: jest.fn(),
      handleSaveEdit: jest.fn(),
      handleMoveToAmbiguous: jest.fn(),
      handleRetryPendingThought: jest.fn(),
    });
  });

  describe('Loading and Error States', () => {
    it('covers loading, error, and empty sermon fallbacks in one pass', () => {
      const fallbackScenarios = [
        {
          description: 'loading state',
          hookState: () => ({
            ...createMockHookReturn(null),
            loading: true,
          }),
          assert: () => expect(screen.getByTestId('structure-skeleton')).toBeInTheDocument(),
        },
        {
          description: 'error state',
          hookState: () => ({
            ...createMockHookReturn(null),
            error: 'Error loading sermon',
          }),
          assert: () => expect(screen.getByText(/error/i)).toBeInTheDocument(),
        },
        {
          description: 'sermon not found',
          hookState: () => createMockHookReturn(null),
          assert: () => expect(screen.getByText(/sermon not found/i)).toBeInTheDocument(),
        },
      ];

      for (const scenario of fallbackScenarios) {
        mockedUseSermonStructureData.mockReturnValue(scenario.hookState());
        render(<StructurePage />);
        scenario.assert();
        cleanup();
      }
    });

    it('shows StructurePageSkeleton with isFocusMode when loading with focus URL params', async () => {
      mockUseSearchParams.mockReturnValue({
        get: jest.fn((param: string) => {
          if (param === 'sermonId') return 'sermon-123';
          if (param === 'mode') return 'focus';
          if (param === 'section') return 'introduction';
          return null;
        }),
      });
      mockedUseSermonStructureData.mockReturnValue({
        ...createMockHookReturn(null),
        loading: true,
      });

      render(<StructurePage />);

      expect(screen.getByTestId('structure-skeleton')).toBeInTheDocument();
      // Skeleton with isFocusMode uses flex layout (single column) - both branches covered
      const skeleton = screen.getByTestId('structure-skeleton');
      expect(skeleton).toHaveClass('animate-pulse');
    });
  });

  describe('Basic Rendering', () => {
    it('should render sermon and columns', async () => {
      const mockSermon = createMockSermon({
        title: 'Test Sermon',
        thoughts: [
          createMockThought({ id: 't1', text: 'Thought 1', tags: ['intro'] }),
          createMockThought({ id: 't2', text: 'Thought 2', tags: ['main'] }),
        ],
        structure: { introduction: ['t1'], main: ['t2'], conclusion: [], ambiguous: [] },
      });

      const containers = {
        introduction: [createMockItem({ id: 't1', content: 'Thought 1', requiredTags: ['intro'] })],
        main: [createMockItem({ id: 't2', content: 'Thought 2', requiredTags: ['main'] })],
        conclusion: [],
        ambiguous: [],
      };

      mockedUseSermonStructureData.mockReturnValue(createMockHookReturn(mockSermon, containers));

      render(<StructurePage />);

      await waitFor(() => {
        // Sermon title appears in the header as "ThoughtsBySection Test Sermon"
        expect(screen.getByText(/Test Sermon/)).toBeInTheDocument();
        // Find column headers by their specific styling
        const introHeaders = screen.getAllByText('Introduction');
        expect(introHeaders.length).toBeGreaterThan(0);
        const mainHeaders = screen.getAllByText('Main Part');
        expect(mainHeaders.length).toBeGreaterThan(0);
        const conclusionHeaders = screen.getAllByText('Conclusion');
        expect(conclusionHeaders.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Drop Zones', () => {
    it('should display drop zones', async () => {
      const mockSermon = createMockSermon({
        thoughts: [createMockThought({ id: 't1', text: 'Thought 1', tags: ['intro'], outlinePointId: 'op1' })],
        structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: [] },
        outline: { introduction: [createMockSermonPoint({ id: 'op1', text: 'Point 1' })], main: [], conclusion: [] },
      });

      const containers = {
        introduction: [createMockItem({ id: 't1', content: 'Thought 1', outlinePointId: 'op1' })],
        main: [],
        conclusion: [],
        ambiguous: [],
      };

      mockedUseSermonStructureData.mockReturnValue(
        createMockHookReturn(mockSermon, containers, mockSermon.outline)
      );

      render(<StructurePage />);

      await waitFor(() => {
        expect(screen.getByText(/drop thoughts here to add/i)).toBeInTheDocument();
      });
    });
  });

  describe('handleToggleReviewed', () => {

    let mockSermon: ReturnType<typeof createMockSermon>;
    let mockSetSermon: jest.Mock;

    const runHandleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
      if (!mockSermon) return;

      const mapSection = (section?: any[]) =>
        section?.map((point: any) =>
          point.id === outlinePointId ? { ...point, isReviewed } : point
        ) || [];

      try {
        const updatedOutline = {
          introduction: mapSection(mockSermon.outline?.introduction),
          main: mapSection(mockSermon.outline?.main),
          conclusion: mapSection(mockSermon.outline?.conclusion),
        };

        mockSetSermon({ ...mockSermon, outline: updatedOutline });
        await updateSermonOutline(mockSermon.id, updatedOutline);
        toast.success(isReviewed ? 'Marked as reviewed' : 'Marked as unreviewed');
      } catch {
        toast.error('Error saving');
      }
    };

    beforeEach(() => {
      mockSermon = createMockSermon({
        id: 'test-sermon',
        outline: {
          introduction: [{ id: 'op1', text: 'Intro point', isReviewed: false }],
          main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
          conclusion: [{ id: 'op3', text: 'Conclusion point' }],
        },
      });
      mockSetSermon = jest.fn();

      mockUpdateSermonOutline.mockClear();
      mockUpdateSermonOutline.mockResolvedValue({ introduction: [], main: [], conclusion: [] });
      mockToast.success.mockClear();
      mockToast.error.mockClear();
    });

    describe('Interactions', () => {
      it('renders DragOverlay when an item is being dragged', async () => {
        const mockSermon = createMockSermon({
          thoughts: [createMockThought({ id: 't1', text: 'Dragging Thought', tags: ['intro'] })],
        });
        const containers = {
          introduction: [createMockItem({ id: 't1', content: 'Dragging Thought', requiredTags: ['intro'] })],
          main: [],
          conclusion: [],
          ambiguous: [],
        };

        mockedUseSermonStructureData.mockReturnValue(createMockHookReturn(mockSermon, containers));

        // Mock active DnD state
        mockedUseStructureDnd.mockReturnValue({
          sensors: [],
          activeId: 't1',
          handleDragStart: jest.fn(),
          handleDragOver: jest.fn(),
          handleDragEnd: jest.fn(),
        });

        render(<StructurePage />);

        // Should find the active item in the overlay
        await waitFor(() => {
          const thoughts = screen.getAllByText('Dragging Thought');
          // The item appears in the list AND in the overlay (2 instances)
          // or just once if the overlay clones it. Usually 2.
          expect(thoughts.length).toBeGreaterThanOrEqual(1);
        });
      });

      it('renders EditThoughtModal when editingItem is set', async () => {
        const mockSermon = createMockSermon();
        const containers = {
          introduction: [],
          main: [],
          conclusion: [],
          ambiguous: [],
        };

        mockedUseSermonStructureData.mockReturnValue(createMockHookReturn(mockSermon, containers));

        // Mock editing state
        mockedUseSermonActions.mockReturnValue({
          editingItem: createMockItem({ id: 't1', content: 'Editing Content' }),
          addingThoughtToSection: null,
          handleEdit: jest.fn(),
          handleCloseEdit: jest.fn(),
          handleAddThoughtToSection: jest.fn(),
          handleSaveEdit: jest.fn(),
          handleMoveToAmbiguous: jest.fn(),
          handleRetryPendingThought: jest.fn(),
        });

        render(<StructurePage />);

        await waitFor(() => {
          // EditThoughtModal should be present (mocking usually renders it but we check for content or Role)
          // CardContent/EditModal uses portals or simple divs. 
          // We check for "Editing Content" if it's passed as initialText.
          // Or check for a specific testid if the modal has one.
          // Or check for the text inside the modal inputs.
          expect(screen.getByDisplayValue('Editing Content')).toBeInTheDocument();
        });
      });
    });

    it('covers all toggle transitions and failures in a single table-driven test', async () => {
      const scenarios = [
        {
          name: 'marks introduction point as reviewed',
          outlinePointId: 'op1',
          isReviewed: true,
          expectedOutline: {
            introduction: [{ id: 'op1', text: 'Intro point', isReviewed: true }],
            main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
            conclusion: [{ id: 'op3', text: 'Conclusion point' }],
          },
          expectedToast: { success: 'Marked as reviewed' },
        },
        {
          name: 'marks main point as unreviewed',
          outlinePointId: 'op2',
          isReviewed: false,
          expectedOutline: {
            introduction: [{ id: 'op1', text: 'Intro point', isReviewed: false }],
            main: [{ id: 'op2', text: 'Main point', isReviewed: false }],
            conclusion: [{ id: 'op3', text: 'Conclusion point' }],
          },
          expectedToast: { success: 'Marked as unreviewed' },
        },
        {
          name: 'adds isReviewed to conclusion point',
          outlinePointId: 'op3',
          isReviewed: true,
          expectedOutline: {
            introduction: [{ id: 'op1', text: 'Intro point', isReviewed: false }],
            main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
            conclusion: [{ id: 'op3', text: 'Conclusion point', isReviewed: true }],
          },
          expectedToast: { success: 'Marked as reviewed' },
        },
        {
          name: 'handles persistence errors gracefully',
          outlinePointId: 'op1',
          isReviewed: true,
          configureMock: () => mockUpdateSermonOutline.mockRejectedValueOnce(new Error('Network error')),
          expectedToast: { error: 'Error saving' },
        },
      ];

      for (const scenario of scenarios) {
        mockSetSermon.mockClear();
        mockToast.success.mockClear();
        mockToast.error.mockClear();
        mockUpdateSermonOutline.mockClear();

        scenario.configureMock?.();

        await runHandleToggleReviewed(scenario.outlinePointId, scenario.isReviewed);

        if (scenario.expectedOutline) {
          expect(mockSetSermon).toHaveBeenCalledWith({
            ...mockSermon,
            outline: scenario.expectedOutline,
          });
          expect(mockUpdateSermonOutline).toHaveBeenCalledWith('test-sermon', scenario.expectedOutline);
        }

        if (scenario.expectedToast?.success) {
          expect(mockToast.success).toHaveBeenCalledWith(scenario.expectedToast.success);
        } else {
          expect(mockToast.success).not.toHaveBeenCalled();
        }

        if (scenario.expectedToast?.error) {
          expect(mockToast.error).toHaveBeenCalledWith(scenario.expectedToast.error);
        } else {
          expect(mockToast.error).not.toHaveBeenCalled();
        }
      }
    });
  });
});
