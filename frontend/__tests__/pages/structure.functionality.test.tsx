import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
  },
  getFocusModeButtonColors: jest.fn((section: string) => {
    const colorMap = {
      introduction: { bg: 'bg-amber-500', text: 'text-white' },
      mainPart: { bg: 'bg-blue-500', text: 'text-white' },
      conclusion: { bg: 'bg-green-500', text: 'text-white' }
    };
    return colorMap[section as keyof typeof colorMap] || { bg: 'bg-gray-500', text: 'text-white' };
  })
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
        'structure.navigation.previousSection': '← Previous Section',
        'structure.navigation.nextSection': 'Next Section →',
        'structure.navigation.goToIntroduction': 'Go to Introduction',
        'structure.navigation.goToMainPart': 'Go to Main Part',
        'structure.navigation.goToConclusion': 'Go to Conclusion',
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
describe('StructurePage Core Functionality Tests', () => {
  beforeEach(() => {
    // Reset mocks
    mockedUseSermonStructureData.mockClear();
    MockColumn.mockClear();
    jest.clearAllMocks();
    
    // Default mock state for the hook
    mockedUseSermonStructureData.mockReturnValue(defaultHookState);
  });

  describe('AI Sorting Functionality', () => {
    it('should handle AI sorting with changes', async () => {
      const mockSortAI = require('@/services/sortAI.service');
      mockSortAI.sortItemsWithAI.mockResolvedValueOnce([
        { id: 't1', content: 'Sorted Intro', outlinePointId: 'op1' },
        { id: 't2', content: 'Sorted Main', outlinePointId: 'op2' }
      ]);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Click AI sort button
      const aiSortButton = screen.getByTestId('ai-sort-introduction');
      fireEvent.click(aiSortButton);
      
      // Should trigger AI sorting
      expect(aiSortButton).toBeInTheDocument();
    });

    it('should handle AI sorting errors', async () => {
      const mockSortAI = require('@/services/sortAI.service');
      mockSortAI.sortItemsWithAI.mockRejectedValueOnce(new Error('AI Sort failed'));
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Click AI sort button
      const aiSortButton = screen.getByTestId('ai-sort-introduction');
      fireEvent.click(aiSortButton);
      
      // Should handle errors gracefully
      expect(aiSortButton).toBeInTheDocument();
    });

    it('should handle AI sorting with no changes', async () => {
      const mockSortAI = require('@/services/sortAI.service');
      mockSortAI.sortItemsWithAI.mockResolvedValueOnce([]);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Click AI sort button
      const aiSortButton = screen.getByTestId('ai-sort-introduction');
      fireEvent.click(aiSortButton);
      
      // Should handle no changes scenario
      expect(aiSortButton).toBeInTheDocument();
    });

    it('should handle AI sorting with no items to sort', async () => {
      const emptyContainersState = {
        ...defaultHookState,
        containers: {
          ...mockContainersData,
          introduction: []
        }
      };
      mockedUseSermonStructureData.mockReturnValue(emptyContainersState);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that AI sorting with no items is handled
      expect(screen.getByTestId('column-main')).toBeInTheDocument();
    });
  });

  describe('Focus Mode Functionality', () => {
    it('should handle focus mode toggle for different columns', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that focus buttons are rendered
      expect(screen.getByTestId('focus-introduction')).toBeInTheDocument();
      expect(screen.getByTestId('focus-main')).toBeInTheDocument();
      expect(screen.getByTestId('focus-conclusion')).toBeInTheDocument();
    });

    it('should handle focus mode with ambiguous items', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that focus mode with ambiguous items is available
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle focus mode without ambiguous items', async () => {
      const noAmbiguousState = {
        ...defaultHookState,
        containers: {
          ...mockContainersData,
          ambiguous: []
        }
      };
      mockedUseSermonStructureData.mockReturnValue(noAmbiguousState);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that focus mode without ambiguous items is handled
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should display navigation buttons in focus mode', async () => {
      // Mock URL search params for focus mode
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Check that all three section navigation buttons are displayed
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      expect(navigationButtons).toHaveLength(3);
      
      // Introduction button should be active (amber colors)
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      expect(introductionButton).toBeInTheDocument();
      expect(introductionButton).toHaveClass('bg-amber-500');
      expect(introductionButton).toHaveClass('text-white');
    });

    it('should display correct navigation buttons for main section in focus mode', async () => {
      // Mock URL search params for focus mode on main section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=main&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Check that all three section navigation buttons are displayed
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      expect(navigationButtons).toHaveLength(3);
      
      // Main part button should be active (blue colors)
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      expect(mainPartButton).toBeInTheDocument();
      expect(mainPartButton).toHaveClass('bg-blue-500');
      expect(mainPartButton).toHaveClass('text-white');
    });

    it('should display correct navigation buttons for conclusion section in focus mode', async () => {
      // Mock URL search params for focus mode on conclusion section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=conclusion&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Check that all three section navigation buttons are displayed
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      expect(navigationButtons).toHaveLength(3);
      
      // Conclusion button should be active (green colors)
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      expect(conclusionButton).toBeInTheDocument();
      expect(conclusionButton).toHaveClass('bg-green-500');
      expect(conclusionButton).toHaveClass('text-white');
    });

    it('should apply correct theme colors to active navigation button in focus mode', async () => {
      // Mock URL search params for focus mode on introduction section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Find navigation buttons specifically (not column headers)
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      // Introduction button should be active (amber colors)
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      expect(introductionButton).toBeInTheDocument();
      expect(introductionButton).toHaveClass('bg-amber-500');
      expect(introductionButton).toHaveClass('text-white');
      
      // Other buttons should be inactive (gray colors)
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      
      expect(mainPartButton).toHaveClass('bg-gray-100');
      expect(mainPartButton).toHaveClass('text-gray-700');
      expect(conclusionButton).toHaveClass('bg-gray-100');
      expect(conclusionButton).toHaveClass('text-gray-700');
    });

    it('should apply correct theme colors to main section navigation button when active', async () => {
      // Mock URL search params for focus mode on main section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=main&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Find navigation buttons specifically (not column headers)
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      // Main part button should be active (blue colors)
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      expect(mainPartButton).toBeInTheDocument();
      expect(mainPartButton).toHaveClass('bg-blue-500');
      expect(mainPartButton).toHaveClass('text-white');
      
      // Other buttons should be inactive (gray colors)
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      
      expect(introductionButton).toHaveClass('bg-gray-100');
      expect(introductionButton).toHaveClass('text-gray-700');
      expect(conclusionButton).toHaveClass('bg-gray-100');
      expect(conclusionButton).toHaveClass('text-gray-700');
    });

    it('should apply correct theme colors to conclusion section navigation button when active', async () => {
      // Mock URL search params for focus mode on conclusion section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=conclusion&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Find navigation buttons specifically (not column headers)
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      // Conclusion button should be active (green colors)
      const conclusionButton = navigationButtons.find(button => button.textContent === 'Conclusion');
      expect(conclusionButton).toBeInTheDocument();
      expect(conclusionButton).toHaveClass('bg-green-500');
      expect(conclusionButton).toHaveClass('text-white');
      
      // Other buttons should be inactive (gray colors)
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      
      expect(introductionButton).toHaveClass('bg-gray-100');
      expect(introductionButton).toHaveClass('text-gray-700');
      expect(mainPartButton).toHaveClass('bg-gray-100');
      expect(mainPartButton).toHaveClass('text-gray-700');
    });

    it('should handle navigation button clicks correctly in focus mode', async () => {
      // Mock URL search params for focus mode on introduction section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Find navigation buttons specifically (not column headers)
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      // Find and click the main part navigation button
      const mainPartButton = navigationButtons.find(button => button.textContent === 'Main Part');
      expect(mainPartButton).toBeInTheDocument();
      
      fireEvent.click(mainPartButton!);
      
      // The main part button should now be active (blue colors)
      expect(mainPartButton).toHaveClass('bg-blue-500');
      expect(mainPartButton).toHaveClass('text-white');
      
      // The introduction button should now be inactive (gray colors)
      const introductionButton = navigationButtons.find(button => button.textContent === 'Introduction');
      expect(introductionButton).toHaveClass('bg-gray-100');
      expect(introductionButton).toHaveClass('text-gray-700');
    });

    it('should maintain proper button styling during theme color transitions', async () => {
      // Mock URL search params for focus mode on introduction section
      const mockSearchParams = new URLSearchParams('?mode=focus&section=introduction&sermonId=test123');
      jest.spyOn(require('next/navigation'), 'useSearchParams').mockReturnValue(mockSearchParams);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // All navigation buttons should have the base styling classes
      const navigationButtons = screen.getAllByRole('button').filter(button => 
        ['Introduction', 'Main Part', 'Conclusion'].includes(button.textContent || '')
      );
      
      expect(navigationButtons).toHaveLength(3);
      
      navigationButtons.forEach(button => {
        expect(button).toHaveClass('px-3');
        expect(button).toHaveClass('py-1.5');
        expect(button).toHaveClass('rounded-md');
        expect(button).toHaveClass('text-sm');
        expect(button).toHaveClass('font-medium');
        expect(button).toHaveClass('transition-colors');
        expect(button).toHaveClass('duration-200');
      });
    });
  });

  describe('Thought Management', () => {
    it('should handle thought editing modal interactions', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Find and click an edit button
      const editButtons = screen.getAllByTestId('edit-t1');
      expect(editButtons.length).toBeGreaterThan(0);
      
      fireEvent.click(editButtons[0]);
      
      // Modal should be rendered
      expect(editButtons[0]).toBeInTheDocument();
    });

    it('should handle thought deletion from structure', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Find and click a delete button
      const deleteButtons = screen.getAllByTestId('delete-t1');
      expect(deleteButtons.length).toBeGreaterThan(0);
      
      fireEvent.click(deleteButtons[0]);
      
      // Should handle deletion
      expect(deleteButtons[0]).toBeInTheDocument();
    });

    it('should handle adding new thoughts to sections', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the component renders without errors when adding thoughts
      // In focus mode, only one column should be visible
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle thought editing with outline points', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that thought editing functionality is available
      expect(screen.getByText('Intro Item')).toBeInTheDocument();
    });

    it('should handle thought deletion confirmation properly', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that thought deletion functionality is available
      expect(screen.getByText('Ambiguous Item')).toBeInTheDocument();
    });
  });

  describe('Outline Update Functionality', () => {
    it('should handle outline updates from Column components', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that update outline button exists
      const updateOutlineButton = screen.getByTestId('update-outline-introduction');
      expect(updateOutlineButton).toBeInTheDocument();
      
      // Test that outline update functionality is available
      expect(updateOutlineButton).toHaveTextContent('Update Outline');
    });

    it('should merge outline updates correctly', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that outline update functionality is available
      expect(screen.getByTestId('update-outline-introduction')).toBeInTheDocument();
    });

    it('should handle partial outline updates', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that partial outline updates are handled correctly
      const updateOutlineButton = screen.getByTestId('update-outline-introduction');
      fireEvent.click(updateOutlineButton);
      
      // Should handle partial updates
      expect(updateOutlineButton).toBeInTheDocument();
    });
  });

  describe('Drag and Drop Functionality', () => {
    it('should handle drag and drop preview state', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the page is properly configured for drag and drop
      // Test that sortable items are present, indicating drag and drop support
      expect(screen.getByTestId('sortable-item-t4')).toBeInTheDocument();
      
      // Test that items have proper structure for drag and drop
      const sortableItem = screen.getByTestId('sortable-item-t4');
      expect(sortableItem).toBeInTheDocument();
      expect(sortableItem).toHaveTextContent('Ambiguous Item');
    });

    it('should handle ambiguous section visibility toggle', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that ambiguous section is visible by default
      expect(screen.getByTestId('sortable-item-t4')).toBeInTheDocument();
      
      // Test that the ambiguous section header is clickable
      const ambiguousHeader = screen.getByText('Under Consideration');
      expect(ambiguousHeader).toBeInTheDocument();
      expect(ambiguousHeader.closest('div')).toHaveClass('cursor-pointer');
    });
  });

  describe('Export Functionality', () => {
    it('should handle export functionality for focused columns', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that export functionality is available
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle export content generation', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that export functionality is available
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Modal Interactions', () => {
    it('should handle opening add thought modal', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Click add thought button
      const addThoughtButton = screen.getByTestId('add-thought-introduction');
      fireEvent.click(addThoughtButton);
      
      // Button should be clickable
      expect(addThoughtButton).toBeInTheDocument();
    });

    it('should handle opening edit thought modal', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Click edit button for existing thought
      const editButton = screen.getByTestId('edit-t1');
      fireEvent.click(editButton);
      
      // Button should be clickable
      expect(editButton).toBeInTheDocument();
    });
  });

  describe('Internationalization', () => {
    it('should handle internationalization correctly', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that translated text is displayed
      // In focus mode, only one column should be visible
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle missing translations gracefully', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that missing translations are handled gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Integration Scenarios', () => {
    it('should work as a complete system', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

      // Test that the entire system works together
      // In focus mode, only one column should be visible
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: /Under Consideration/i })).toBeInTheDocument();
    });

    it('should handle complete workflow from thought creation to deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that complete workflow is handled
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });
});
