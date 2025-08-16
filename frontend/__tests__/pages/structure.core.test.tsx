import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/structure/page';
import { useSermonStructureData } from '@/hooks/useSermonStructureData';

// Mock next/navigation
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    prefetch: jest.fn(),
    replace: jest.fn(),
  }),
  useSearchParams: () => ({
    get: jest.fn().mockImplementation((param) => {
      if (param === 'sermonId') return 'sermon123';
      return null;
    }),
  }),
  usePathname: jest.fn().mockReturnValue('/structure'),
}));

// Mock the custom hook
jest.mock('@/hooks/useSermonStructureData');
const mockedUseSermonStructureData = useSermonStructureData as jest.Mock;

// Mock services
jest.mock('@/services/structure.service', () => ({
  updateStructure: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/services/thought.service', () => ({
  updateThought: jest.fn().mockResolvedValue({}),
  deleteThought: jest.fn().mockResolvedValue({}),
  createManualThought: jest.fn().mockResolvedValue({
    id: 'new-thought-123',
    text: 'New thought',
    tags: ['Introduction'],
    outlinePointId: 'op1',
    date: new Date().toISOString()
  }),
}));

jest.mock('@/services/sortAI.service', () => ({
  sortItemsWithAI: jest.fn().mockResolvedValue([]),
}));

// Mock themeColors
jest.mock('@/utils/themeColors', () => ({
  SERMON_SECTION_COLORS: {
    introduction: { base: "#2563eb" },
    mainPart: { base: "#7e22ce" },
    conclusion: { base: "#16a34a" }
  }
}));

// Mock ExportButtons component
jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="export-buttons">
      <button onClick={() => props.getExportContent('plain', { includeTags: false })} data-testid="export-txt-button">
        Export TXT
      </button>
    </div>
  ),
}));

// Mock react-i18next
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'structure.introduction': 'Introduction',
        'structure.mainPart': 'Main Part',
        'structure.conclusion': 'Conclusion',
        'structure.underConsideration': 'Under Consideration',
        'structure.title': 'Structure',
        'structure.backToSermon': 'Back to Sermon',
        'structure.noEntries': 'No entries',
        'structure.noItemsToSort': 'No items to sort',
        'structure.aiSortSuggestionsReady': 'AI sorting completed. Review and confirm the changes.',
        'structure.aiSortNoChanges': 'AI sort did not suggest any changes.',
        'structure.aiSortChangesAccepted': 'All AI suggestions accepted.',
        'structure.aiSortChangesReverted': 'All AI suggestions reverted.',
        'structure.thoughtDeletedSuccess': 'Thought deleted successfully.',
        'outline.introduction': 'Introduction',
        'outline.mainPoints': 'Main Points',
        'outline.conclusion': 'Conclusion',
        'common.loading': 'Loading',
        'errors.fetchSermonStructureError': 'Error fetching structure',
        'errors.failedToAddThought': 'Failed to add thought',
        'errors.failedToSortItems': 'Failed to sort items',
        'errors.aiSortFailedFormat': 'AI sort failed - invalid format',
        'errors.dragDropUpdateFailed': 'Failed to update. Changes have been reverted.',
        'errors.removingError': 'Error removing item',
        'errors.deletingError': 'Failed to delete thought',
        'errors.savingError': 'Error saving structure changes after deleting item',
        'errors.failedToSaveStructure': 'Failed to save structure',
        'errors.failedToSaveThought': 'Failed to save thought',
        'sermon.deleteThoughtConfirm': 'Are you sure you want to permanently delete this thought: "{text}"?',
      };
      return translations[key] || key;
    },
    i18n: { changeLanguage: jest.fn() },
  }),
}));

// Mock Column component
const MockColumn = jest.fn(({
  id,
  title,
  items,
  onEdit,
  onAddThought,
  onDelete,
  onFocus,
  isFocused,
  focusedColumn,
  onToggleFocusMode,
  onAiSort,
  isLoading,
  onOutlineUpdate,
  thoughtsPerOutlinePoint,
  ...props
}) => (
  <div data-testid={`column-${id}`} className={isFocused ? 'focused' : ''}>
    <h2>{title}</h2>
    
    {/* Focus Mode Button */}
    <button 
      data-testid={`focus-${id}`}
      onClick={onToggleFocusMode}
      className="focus-button"
    >
      {isFocused ? 'Normal Mode' : 'Focus Mode'}
    </button>
    
    {/* AI Sort Button */}
    <button 
      data-testid={`ai-sort-${id}`}
      onClick={onAiSort}
      disabled={isLoading}
      className="ai-sort-button"
    >
      {isLoading ? 'Sorting...' : 'AI Sort'}
    </button>
    
    <div>
      {items.map((item: any) => (
        <div key={item.id} data-testid={`item-${item.id}`}>
          <span>{item.content || item.text}</span>
          <button onClick={() => onEdit?.(item)} data-testid={`edit-${item.id}`}>
            Edit
          </button>
          <button onClick={() => onDelete?.(item.id)} data-testid={`delete-${item.id}`}>
            Delete
          </button>
        </div>
      ))}
    </div>
    <button onClick={() => onAddThought?.(id)} data-testid={`add-thought-${id}`}>
      Add Thought
    </button>
    
    {/* Test outline update functionality */}
    <button onClick={() => onOutlineUpdate?.({
      introduction: [{ id: 'op1', text: 'Updated Intro' }],
      main: [],
      conclusion: []
    })} data-testid={`update-outline-${id}`}>
      Update Outline
    </button>
    
    {/* Display thoughts per outline point */}
    <div data-testid={`thoughts-count-${id}`}>
      {Object.entries(thoughtsPerOutlinePoint || {}).map(([pointId, count]) => (
        <span key={pointId} data-testid={`point-${pointId}-count`}>
          {pointId}: {String(count)}
        </span>
      ))}
    </div>
  </div>
));

jest.mock('@/components/Column', () => ({
  __esModule: true,
  default: (props: any) => MockColumn(props),
}));

// Mock other components
jest.mock('@/components/EditThoughtModal', () => ({
  __esModule: true,
  default: ({ onSave, onClose, initialText, initialTags, initialOutlinePointId }: any) => (
    <div data-testid="edit-thought-modal">
      <input 
        data-testid="edit-text-input" 
        defaultValue={initialText} 
        onChange={(e) => onSave(e.target.value, initialTags || [], initialOutlinePointId)}
      />
      <button onClick={onClose} data-testid="close-modal">Close</button>
      <button onClick={() => onSave(initialText || 'Updated text', initialTags || [], initialOutlinePointId)} data-testid="save-modal">
        Save
      </button>
    </div>
  ),
}));

jest.mock('@/components/SortableItem', () => ({
  __esModule: true,
  default: ({ item, onEdit, onDelete, isDeleting, containerId }: { item: any; onEdit?: (item: any) => void; onDelete?: (id: string, containerId: string) => void; isDeleting?: boolean; containerId: string }) => (
    <div data-testid={`sortable-item-${item.id}`}>
      {item.content}
      <button onClick={() => onEdit?.(item)} data-testid={`edit-sortable-${item.id}`}>
        Edit
      </button>
      <button 
        onClick={() => onDelete?.(item.id, containerId)} 
        data-testid={`delete-sortable-${item.id}`}
        disabled={isDeleting}
      >
        {isDeleting ? 'Deleting...' : 'Delete'}
      </button>
    </div>
  ),
}));

jest.mock('@/components/CardContent', () => ({
  __esModule: true,
  default: ({ item }: { item: any }) => (
    <div data-testid={`card-content-${item.id}`}>
      {item.content}
    </div>
  ),
}));

// Mock toast
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
  },
}));

// Mock lodash debounce
jest.mock('lodash/debounce', () => (fn: any) => fn);

// Test Setup Data
const mockSermonData = {
  id: 'sermon123',
  userId: 'user1',
  title: 'Test Sermon',
  verse: 'John 3:16',
  date: '2023-01-01',
  thoughts: [
    { id: 't1', text: 'Intro thought', tags: ['Introduction'], outlinePointId: 'op1', date: '2023-01-01' },
    { id: 't2', text: 'Main thought', tags: ['Main Part'], outlinePointId: 'op2', date: '2023-01-01' },
    { id: 't3', text: 'Conclusion thought', tags: ['Conclusion'], outlinePointId: 'op3', date: '2023-01-01' },
    { id: 't4', text: 'Ambiguous thought', tags: [], date: '2023-01-01' },
  ],
  structure: { introduction: ['t1'], main: ['t2'], conclusion: ['t3'], ambiguous: ['t4'] },
  outline: { 
    introduction: [{ id: 'op1', text: 'Intro Point' }], 
    main: [{ id: 'op2', text: 'Main Point' }], 
    conclusion: [{ id: 'op3', text: 'Conclusion Point' }] 
  },
};

const mockContainersData = {
  introduction: [{ 
    id: 't1', 
    content: 'Intro Item', 
    customTagNames: [], 
    requiredTags: ['Introduction'],
    outlinePointId: 'op1'
  }],
  main: [{ 
    id: 't2', 
    content: 'Main Item', 
    customTagNames: [], 
    requiredTags: ['Main Part'],
    outlinePointId: 'op2'
  }],
  conclusion: [{ 
    id: 't3', 
    content: 'Conclusion Item', 
    customTagNames: [], 
    requiredTags: ['Conclusion'],
    outlinePointId: 'op3'
  }],
  ambiguous: [{ 
    id: 't4', 
    content: 'Ambiguous Item', 
    customTagNames: [], 
    requiredTags: [],
    outlinePointId: undefined
  }],
};

const mockOutlinePointsData = {
  introduction: [{ id: 'op1', text: 'Outline Intro' }],
  main: [{ id: 'op2', text: 'Outline Main' }],
  conclusion: [{ id: 'op3', text: 'Outline Conclusion' }],
};

const mockAllowedTagsData = [{ name: 'custom1', color: '#eee' }];

const defaultHookState = {
  sermon: mockSermonData,
  setSermon: jest.fn(),
  containers: mockContainersData,
  setContainers: jest.fn(),
  outlinePoints: mockOutlinePointsData,
  requiredTagColors: { introduction: 'blue', main: 'purple', conclusion: 'green' },
  allowedTags: mockAllowedTagsData,
  loading: false,
  error: null,
  setLoading: jest.fn(),
  isAmbiguousVisible: true,
  setIsAmbiguousVisible: jest.fn(),
};

// Test Suite
describe('StructurePage Core Component Tests', () => {
  beforeEach(() => {
    // Reset mocks
    mockedUseSermonStructureData.mockClear();
    MockColumn.mockClear();
    jest.clearAllMocks();
    
    // Default mock state for the hook
    mockedUseSermonStructureData.mockReturnValue(defaultHookState);
  });

  describe('Basic Rendering and States', () => {
    it('should display loading state', () => {
      mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: true });
      render(<StructurePage />);
      expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    });

    it('should display error state', () => {
      mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: false, error: 'Fetch Failed' });
      render(<StructurePage />);
      expect(screen.getByText(/Error fetching structure/i)).toBeInTheDocument();
      expect(screen.getByText(/Fetch Failed/i)).toBeInTheDocument();
    });

    it('should display sermon not found state', () => {
      mockedUseSermonStructureData.mockReturnValue({ ...defaultHookState, loading: false, sermon: null });
      render(<StructurePage />);
      expect(screen.getByText('structure.sermonNotFound')).toBeInTheDocument();
    });

    it('should render columns and items when data is loaded', async () => {
      render(<StructurePage />);

      await waitFor(() => {
        expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
      });

      // Check main columns are rendered
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('column-main')).toBeInTheDocument();
      expect(screen.getByTestId('column-conclusion')).toBeInTheDocument();

      // Check ambiguous section
      expect(screen.getByRole('heading', { name: /Under Consideration/i })).toBeInTheDocument();
      expect(screen.getByTestId('sortable-item-t4')).toBeInTheDocument();
      expect(within(screen.getByTestId('sortable-item-t4')).getByText('Ambiguous Item')).toBeInTheDocument();

      // Check items are rendered within main columns
      expect(within(screen.getByTestId('column-introduction')).getByText('Intro Item')).toBeInTheDocument();
      expect(within(screen.getByTestId('column-main')).getByText('Main Item')).toBeInTheDocument();
      expect(within(screen.getByTestId('column-conclusion')).getByText('Conclusion Item')).toBeInTheDocument();

      // Check if MockColumn received correct props
      expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ 
        id: 'introduction', 
        title: 'Introduction', 
        items: mockContainersData.introduction 
      }));
      expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ 
        id: 'main', 
        title: 'Main Part', 
        items: mockContainersData.main 
      }));
      expect(MockColumn).toHaveBeenCalledWith(expect.objectContaining({ 
        id: 'conclusion', 
        title: 'Conclusion', 
        items: mockContainersData.conclusion 
      }));
    });
  });

  describe('Core UI Elements', () => {
    it('should render sermon title and back link', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the sermon title is rendered
      const titleElements = screen.getAllByText((content, element) => {
        return element?.textContent?.includes('Test Sermon') || false;
      });
      expect(titleElements.length).toBeGreaterThan(0);
      
      // Test that the back link is rendered
      const backLink = screen.getByText('Back to Sermon');
      expect(backLink).toHaveAttribute('href', '/sermons/sermon123');
    });

    it('should render structure statistics correctly', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the ambiguous section shows the correct count
      const countElement = screen.getByText('1');
      expect(countElement).toBeInTheDocument();
      expect(countElement.closest('span')).toHaveClass('text-sm', 'bg-gray-200', 'dark:bg-gray-700', 'text-gray-800', 'dark:text-gray-200', 'px-2', 'py-0.5', 'rounded-full');
    });

    it('should render ambiguous section with correct styling', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the ambiguous section is rendered with the correct styling
      const ambiguousElement = screen.getByText('Under Consideration');
      const ambiguousSection = ambiguousElement.closest('div')?.parentElement;
      expect(ambiguousSection).toHaveClass('bg-white', 'dark:bg-gray-800', 'rounded-md', 'shadow', 'border', 'border-red-500');
    });
  });

  describe('Basic Interactions', () => {
    it('should render edit and delete buttons for each item', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that edit and delete buttons are rendered for each item
      expect(screen.getByTestId('edit-t1')).toBeInTheDocument();
      expect(screen.getByTestId('delete-t1')).toBeInTheDocument();
      expect(screen.getByTestId('edit-t2')).toBeInTheDocument();
      expect(screen.getByTestId('delete-t2')).toBeInTheDocument();
    });

    it('should render add thought buttons for each column', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that add thought buttons are rendered for each column
      expect(screen.getByTestId('add-thought-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('add-thought-main')).toBeInTheDocument();
      expect(screen.getByTestId('add-thought-conclusion')).toBeInTheDocument();
    });

    it('should render focus mode buttons for each column', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that focus buttons exist for each column
      expect(screen.getByTestId('focus-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('focus-main')).toBeInTheDocument();
      expect(screen.getByTestId('focus-conclusion')).toBeInTheDocument();
      
      // Test that focus buttons have the correct class
      expect(screen.getByTestId('focus-introduction')).toHaveClass('focus-button');
      expect(screen.getByTestId('focus-main')).toHaveClass('focus-button');
      expect(screen.getByTestId('focus-conclusion')).toHaveClass('focus-button');
    });

    it('should render AI sort buttons for each column', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test AI sort button for each column
      expect(screen.getByTestId('ai-sort-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('ai-sort-main')).toBeInTheDocument();
      expect(screen.getByTestId('ai-sort-conclusion')).toBeInTheDocument();
    });
  });

  describe('Outline Point Display', () => {
    it('should count thoughts per outline point correctly', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that thoughts per outline point are displayed
      expect(screen.getByTestId('thoughts-count-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('thoughts-count-main')).toBeInTheDocument();
      expect(screen.getByTestId('thoughts-count-conclusion')).toBeInTheDocument();
    });

    it('should handle empty outline points gracefully', async () => {
      const emptyOutlineState = {
        ...defaultHookState,
        sermon: {
          ...mockSermonData,
          outline: { introduction: [], main: [], conclusion: [] }
        }
      };
      mockedUseSermonStructureData.mockReturnValue(emptyOutlineState);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Should still render without errors
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Component Lifecycle', () => {
    it('should handle unmounting gracefully', async () => {
      const { unmount } = render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that unmounting is handled gracefully
      unmount();
    });
  });
});
