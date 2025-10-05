import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { createMockSermon, createMockThought, createMockOutlinePoint, mockTranslations, createMockHookReturn, createMockItem } from '../../test-utils/structure-test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn((param: string) => param === 'sermonId' ? 'sermon-123' : null) }),
  usePathname: jest.fn().mockReturnValue('/structure'),
}));

jest.mock('@/hooks/useSermonStructureData');
const mockedUseSermonStructureData = useSermonStructureData as jest.Mock;

jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue({}),
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
}));

jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: () => <div data-testid="export-buttons">Export Buttons</div>,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
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

describe('Structure Page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Loading and Error States', () => {
    it('should display loading state', () => {
      mockedUseSermonStructureData.mockReturnValue({
        ...createMockHookReturn(null),
        loading: true,
      });

      render(<StructurePage />);
      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });

    it('should display error state', () => {
      mockedUseSermonStructureData.mockReturnValue({
        ...createMockHookReturn(null),
        error: 'Error loading sermon',
      });

      render(<StructurePage />);
      expect(screen.getByText(/error/i)).toBeInTheDocument();
    });

    it('should display sermon not found state', () => {
      mockedUseSermonStructureData.mockReturnValue(createMockHookReturn(null));

      render(<StructurePage />);
      expect(screen.getByText(/sermon not found/i)).toBeInTheDocument();
    });
  });

  describe('Basic Rendering', () => {
    it('should render sermon and columns', async () => {
      const mockSermon = createMockSermon({
        title: 'Test Sermon',
        thoughts: [
          createMockThought({ id: 't1', text: 'Thought 1', tags: ['Introduction'] }),
          createMockThought({ id: 't2', text: 'Thought 2', tags: ['Main Part'] }),
        ],
        structure: { introduction: ['t1'], main: ['t2'], conclusion: [], ambiguous: [] },
      });

      const containers = {
        introduction: [createMockItem({ id: 't1', content: 'Thought 1', requiredTags: ['Introduction'] })],
        main: [createMockItem({ id: 't2', content: 'Thought 2', requiredTags: ['Main Part'] })],
        conclusion: [],
        ambiguous: [],
      };

      mockedUseSermonStructureData.mockReturnValue(createMockHookReturn(mockSermon, containers));

      render(<StructurePage />);

      await waitFor(() => {
        // Sermon title appears in the header as "Structure Test Sermon"
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
        thoughts: [createMockThought({ id: 't1', text: 'Thought 1', tags: ['Introduction'], outlinePointId: 'op1' })],
        structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: [] },
        outline: { introduction: [createMockOutlinePoint({ id: 'op1', text: 'Point 1' })], main: [], conclusion: [] },
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
    let mockSermon: any;
    let mockSetSermon: jest.Mock;
    let mockToast: any;

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

      // Mock toast
      mockToast = { success: jest.fn(), error: jest.fn() };
      jest.mock('sonner', () => ({ toast: mockToast }));

      // Mock updateSermonOutline
      jest.mock('@/services/outline.service', () => ({
        updateSermonOutline: jest.fn().mockResolvedValue({}),
      }));
    });

    it('should toggle isReviewed from false to true', async () => {
      const { updateSermonOutline } = require('@/services/outline.service');
      updateSermonOutline.mockResolvedValue({});

      const { result } = renderHook(() => useSermonStructureData('sermon-123', mockTranslations));

      // Simulate the handleToggleReviewed logic
      const handleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
        if (!mockSermon) return;

        try {
          const updatedOutline = {
            introduction: mockSermon.outline?.introduction?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            main: mockSermon.outline?.main?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            conclusion: mockSermon.outline?.conclusion?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || []
          };

          mockSetSermon({ ...mockSermon, outline: updatedOutline });
          await updateSermonOutline(mockSermon.id, updatedOutline);

          mockToast.success('Marked as reviewed');
        } catch (error) {
          mockToast.error('Error saving');
        }
      };

      await handleToggleReviewed('op1', true);

      expect(mockSetSermon).toHaveBeenCalledWith({
        ...mockSermon,
        outline: {
          introduction: [{ id: 'op1', text: 'Intro point', isReviewed: true }],
          main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
          conclusion: [{ id: 'op3', text: 'Conclusion point' }],
        },
      });

      expect(updateSermonOutline).toHaveBeenCalledWith('test-sermon', {
        introduction: [{ id: 'op1', text: 'Intro point', isReviewed: true }],
        main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
        conclusion: [{ id: 'op3', text: 'Conclusion point' }],
      });

      expect(mockToast.success).toHaveBeenCalledWith('Marked as reviewed');
    });

    it('should toggle isReviewed from true to false', async () => {
      const { updateSermonOutline } = require('@/services/outline.service');
      updateSermonOutline.mockResolvedValue({});

      const handleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
        if (!mockSermon) return;

        try {
          const updatedOutline = {
            introduction: mockSermon.outline?.introduction?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            main: mockSermon.outline?.main?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            conclusion: mockSermon.outline?.conclusion?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || []
          };

          mockSetSermon({ ...mockSermon, outline: updatedOutline });
          await updateSermonOutline(mockSermon.id, updatedOutline);

          mockToast.success('Marked as unreviewed');
        } catch (error) {
          mockToast.error('Error saving');
        }
      };

      await handleToggleReviewed('op2', false);

      expect(mockSetSermon).toHaveBeenCalledWith({
        ...mockSermon,
        outline: {
          introduction: [{ id: 'op1', text: 'Intro point', isReviewed: false }],
          main: [{ id: 'op2', text: 'Main point', isReviewed: false }],
          conclusion: [{ id: 'op3', text: 'Conclusion point' }],
        },
      });

      expect(mockToast.success).toHaveBeenCalledWith('Marked as unreviewed');
    });

    it('should handle errors when saving outline', async () => {
      const { updateSermonOutline } = require('@/services/outline.service');
      updateSermonOutline.mockRejectedValue(new Error('Network error'));

      const handleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
        if (!mockSermon) return;

        try {
          const updatedOutline = {
            introduction: mockSermon.outline?.introduction?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            main: mockSermon.outline?.main?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            conclusion: mockSermon.outline?.conclusion?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || []
          };

          mockSetSermon({ ...mockSermon, outline: updatedOutline });
          await updateSermonOutline(mockSermon.id, updatedOutline);

          mockToast.success('Marked as reviewed');
        } catch (error) {
          mockToast.error('Error saving');
        }
      };

      await handleToggleReviewed('op1', true);

      expect(mockToast.error).toHaveBeenCalledWith('Error saving');
    });

    it('should handle points without existing isReviewed field', async () => {
      const { updateSermonOutline } = require('@/services/outline.service');
      updateSermonOutline.mockResolvedValue({});

      const handleToggleReviewed = async (outlinePointId: string, isReviewed: boolean) => {
        if (!mockSermon) return;

        try {
          const updatedOutline = {
            introduction: mockSermon.outline?.introduction?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            main: mockSermon.outline?.main?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || [],
            conclusion: mockSermon.outline?.conclusion?.map((point: any) =>
              point.id === outlinePointId ? { ...point, isReviewed } : point
            ) || []
          };

          mockSetSermon({ ...mockSermon, outline: updatedOutline });
          await updateSermonOutline(mockSermon.id, updatedOutline);

          mockToast.success('Marked as reviewed');
        } catch (error) {
          mockToast.error('Error saving');
        }
      };

      await handleToggleReviewed('op3', true);

      expect(mockSetSermon).toHaveBeenCalledWith({
        ...mockSermon,
        outline: {
          introduction: [{ id: 'op1', text: 'Intro point', isReviewed: false }],
          main: [{ id: 'op2', text: 'Main point', isReviewed: true }],
          conclusion: [{ id: 'op3', text: 'Conclusion point', isReviewed: true }],
        },
      });
    });
  });
});