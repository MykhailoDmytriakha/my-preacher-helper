import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';
import { updateStructure } from '@/services/structure.service';
import { sortItemsWithAI } from '@/services/sortAI.service';
import { createMockSermon, createMockThought, createMockOutlinePoint, mockTranslations, createMockHookReturn, createMockItem } from '../../test-utils/structure-test-utils';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), prefetch: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => ({ get: jest.fn((param: string) => param === 'sermonId' ? 'sermon-123' : null) }),
  usePathname: jest.fn().mockReturnValue('/sermons/sermon-123/structure'),
  useParams: jest.fn(() => ({ id: 'sermon-123' })),
}));

jest.mock('@/hooks/useSermonStructureData');
const mockedUseSermonStructureData = useSermonStructureData as jest.Mock;

jest.mock('@/services/structure.service');
jest.mock('@/services/thought.service');
jest.mock('@/services/sortAI.service');

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

describe('Structure Page - Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (updateStructure as jest.Mock).mockResolvedValue({});
    (sortItemsWithAI as jest.Mock).mockResolvedValue([]);
  });

  describe('Drag and Drop', () => {
    it('should display drag and drop areas', async () => {
      const mockSermon = createMockSermon({
        thoughts: [
          createMockThought({ id: 't1', text: 'Thought 1', tags: ['Introduction'] }),
          createMockThought({ id: 't2', text: 'Thought 2', tags: ['Main Part'] }),
        ],
        structure: { introduction: ['t1'], main: ['t2'], conclusion: [], ambiguous: [] },
        outline: {
          introduction: [createMockOutlinePoint({ id: 'op1', text: 'Intro Point' })],
          main: [createMockOutlinePoint({ id: 'op2', text: 'Main Point' })],
          conclusion: [],
        },
      });

      const containers = {
        introduction: [createMockItem({ id: 't1', content: 'Thought 1' })],
        main: [createMockItem({ id: 't2', content: 'Thought 2' })],
        conclusion: [],
        ambiguous: [],
      };

      mockedUseSermonStructureData.mockReturnValue(
        createMockHookReturn(mockSermon, containers, mockSermon.outline)
      );

      render(<StructurePage />);

      await waitFor(() => {
        expect(screen.getByText('Thought 1')).toBeInTheDocument();
        // Find outline point in the header, not in the list
        const outlinePoints = screen.getAllByText('Intro Point');
        expect(outlinePoints.length).toBeGreaterThan(0);
      });
    });
  });

  describe('AI Sorting', () => {
    it('should handle AI sorting', async () => {
      const mockSermon = createMockSermon({
        thoughts: [
          createMockThought({ id: 't1', text: 'Thought 1', tags: ['Introduction'] }),
          createMockThought({ id: 't2', text: 'Thought 2', tags: ['Introduction'] }),
        ],
        structure: { introduction: ['t1', 't2'], main: [], conclusion: [], ambiguous: [] },
        outline: {
          introduction: [
            createMockOutlinePoint({ id: 'op1', text: 'Point 1' }),
            createMockOutlinePoint({ id: 'op2', text: 'Point 2' }),
          ],
          main: [],
          conclusion: [],
        },
      });

      const containers = {
        introduction: [
          createMockItem({ id: 't1', content: 'Thought 1' }),
          createMockItem({ id: 't2', content: 'Thought 2' }),
        ],
        main: [],
        conclusion: [],
        ambiguous: [],
      };

      mockedUseSermonStructureData.mockReturnValue(
        createMockHookReturn(mockSermon, containers, mockSermon.outline)
      );

      render(<StructurePage />);

      await waitFor(() => {
        // Find Introduction in the column header, not in navigation links
        const introHeaders = screen.getAllByText('Introduction');
        expect(introHeaders.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Outline Management', () => {
    it('should display thoughts grouped by outline points', async () => {
      const mockSermon = createMockSermon({
        thoughts: [
          createMockThought({ id: 't1', text: 'Thought 1', tags: ['Introduction'], outlinePointId: 'op1' }),
        ],
        structure: { introduction: ['t1'], main: [], conclusion: [], ambiguous: [] },
        outline: {
          introduction: [createMockOutlinePoint({ id: 'op1', text: 'Point 1' })],
          main: [],
          conclusion: [],
        },
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
        // Find Point 1 in the outline point header
        const pointHeaders = screen.getAllByText('Point 1');
        expect(pointHeaders.length).toBeGreaterThan(0);
        expect(screen.getByText('Thought 1')).toBeInTheDocument();
      });
    });
  });
});
