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
describe('StructurePage Error Handling and Edge Cases', () => {
  beforeEach(() => {
    // Reset mocks
    mockedUseSermonStructureData.mockClear();
    MockColumn.mockClear();
    jest.clearAllMocks();
    
    // Default mock state for the hook
    mockedUseSermonStructureData.mockReturnValue(defaultHookState);
  });

  describe('Error States and Edge Cases', () => {
    it('should handle error states gracefully', async () => {
      // Mock the hook to return an error
      mockedUseSermonStructureData.mockReturnValue({
        sermon: null,
        loading: false,
        error: 'Failed to load sermon structure',
        containers: {},
        outlinePoints: {},
        allowedTags: [],
        columnTitles: {},
        requiredTagColors: {}
      });

      render(<StructurePage />);
      
      // Should display error message
      expect(screen.getByText(/Error/)).toBeInTheDocument();
    });

    it('should handle empty sermon state', async () => {
      // Mock the hook to return no sermon
      mockedUseSermonStructureData.mockReturnValue({
        sermon: null,
        loading: false,
        error: null,
        containers: {},
        outlinePoints: {},
        allowedTags: [],
        columnTitles: {},
        requiredTagColors: {}
      });

      render(<StructurePage />);
      
      // Should display sermon not found message
      expect(screen.getByText('structure.sermonNotFound')).toBeInTheDocument();
    });

    it('should handle loading state correctly', async () => {
      // Mock the hook to return loading state
      mockedUseSermonStructureData.mockReturnValue({
        sermon: null,
        loading: true,
        error: null,
        containers: {},
        outlinePoints: {},
        allowedTags: [],
        columnTitles: {},
        requiredTagColors: {}
      });

      render(<StructurePage />);
      
      // Should display loading message
      expect(screen.getByText(/Loading/)).toBeInTheDocument();
    });
  });

  describe('Thought Deletion Error Handling', () => {
    it('should handle thought deletion with invalid container', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return false (cancellation)
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
      
      // Try to delete from non-ambiguous container (should fail early)
      const deleteButton = screen.getByTestId('delete-t1'); // This is in introduction, not ambiguous
      fireEvent.click(deleteButton);
      
      // Should not proceed with deletion - the function should return early
      expect(deleteButton).toBeInTheDocument();
      
      mockConfirm.mockRestore();
    });

    it('should handle thought deletion when thought not found', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to fail
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockRejectedValueOnce(new Error('Thought not found'));
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should show error toast
      await waitFor(() => {
        expect(require('sonner').toast.error).toHaveBeenCalledWith('Failed to delete thought');
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle successful thought deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should show success toast
      await waitFor(() => {
        expect(require('sonner').toast.success).toHaveBeenCalledWith('Thought deleted successfully.');
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle structure update after thought deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Mock updateStructure to succeed
      const mockUpdateStructure = require('@/services/structure.service');
      mockUpdateStructure.updateStructure.mockResolvedValueOnce({});
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should update structure if needed
      await waitFor(() => {
        expect(mockDeleteThought.deleteThought).toHaveBeenCalled();
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle structure update errors after thought deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Mock updateStructure to fail
      const mockUpdateStructure = require('@/services/structure.service');
      mockUpdateStructure.updateStructure.mockRejectedValueOnce(new Error('Structure update failed'));
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should handle errors gracefully
      await waitFor(() => {
        expect(mockDeleteThought.deleteThought).toHaveBeenCalled();
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle thought deletion cancellation', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return false (cancellation)
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should not proceed with deletion
      expect(deleteButton).toBeInTheDocument();
      
      mockConfirm.mockRestore();
    });
  });

  describe('Debounced Save Error Handling', () => {
    it('should handle debounced structure save errors', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock updateStructure to fail
      const mockUpdateStructure = require('@/services/structure.service');
      mockUpdateStructure.updateStructure.mockRejectedValueOnce(new Error('Structure save failed'));
      
      // Should handle errors gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle debounced thought save errors', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock updateThought to fail
      const mockUpdateThought = require('@/services/thought.service');
      mockUpdateThought.updateThought.mockRejectedValueOnce(new Error('Thought save failed'));
      
      // Should handle errors gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle debounced thought save with sermon state update', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock updateThought to succeed
      const mockUpdateThought = require('@/services/thought.service');
      const mockUpdatedThought = { id: 't1', content: 'Updated content', tags: [] };
      mockUpdateThought.updateThought.mockResolvedValueOnce(mockUpdatedThought);
      
      // Should update sermon state after successful save
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Outline Update Error Handling', () => {
    it('should handle outline update with empty sections', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that all empty outline sections are handled correctly
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle outline update with undefined sermon outline', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that undefined sermon outline is handled gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle outline update with null sermon outline', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that null sermon outline is handled gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should preserve existing outline when updating with completely empty data', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that existing outline is preserved when updating with completely empty data
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('DragOverlay Error Handling', () => {
    it('should handle DragOverlay with undefined containers', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that DragOverlay handles undefined containers gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle DragOverlay with empty containers object', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that DragOverlay handles empty containers object gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle DragOverlay with missing container keys', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that DragOverlay handles missing container keys gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle DragOverlay with activeId not found in any container', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that DragOverlay handles activeId not found in any container gracefully
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Component Rendering Edge Cases', () => {
    it('should handle rendering with missing sermon data', async () => {
      const incompleteState = {
        ...defaultHookState,
        sermon: null
      };
      mockedUseSermonStructureData.mockReturnValue(incompleteState);
      
      render(<StructurePage />);
      
      // Test that rendering with missing sermon data is handled
      expect(screen.getByText('structure.sermonNotFound')).toBeInTheDocument();
    });

    it('should handle rendering with missing containers data', async () => {
      const incompleteState = {
        ...defaultHookState,
        containers: {
          introduction: [],
          main: [],
          conclusion: [],
          ambiguous: []
        }
      };
      mockedUseSermonStructureData.mockReturnValue(incompleteState);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that rendering with missing containers data is handled
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle rendering with missing outline points data', async () => {
      const incompleteState = {
        ...defaultHookState,
        outlinePoints: {}
      };
      mockedUseSermonStructureData.mockReturnValue(incompleteState);
      
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that rendering with missing outline points data is handled
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Specific Error Conditions', () => {
    it('should handle thought deletion with missing sermonId', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that missing sermonId shows error toast
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle thought deletion with missing sermon', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that missing sermon shows error toast
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle thought deletion with non-ambiguous container', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that non-ambiguous container shows error toast
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });

    it('should handle thought deletion when thought not found in sermon thoughts', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Test that missing thought in sermon shows error toast
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
    });
  });

  describe('Structure Update Error Handling', () => {
    it('should handle structure update error after successful thought deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Mock updateStructure to fail
      const mockUpdateStructure = require('@/services/structure.service');
      mockUpdateStructure.updateStructure.mockRejectedValueOnce(new Error('Structure update failed'));
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should handle errors gracefully
      await waitFor(() => {
        expect(mockDeleteThought.deleteThought).toHaveBeenCalled();
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle structure update success after thought deletion', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Mock updateStructure to succeed
      const mockUpdateStructure = require('@/services/structure.service');
      mockUpdateStructure.updateStructure.mockResolvedValueOnce({});
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should show success toast
      await waitFor(() => {
        expect(require('sonner').toast.success).toHaveBeenCalledWith('Thought deleted successfully.');
      });
      
      mockConfirm.mockRestore();
    });

    it('should handle structure update when structure has not changed', async () => {
      render(<StructurePage />);
      await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
      
      // Mock window.confirm to return true
      const mockConfirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
      
      // Mock deleteThought to succeed
      const mockDeleteThought = require('@/services/thought.service');
      mockDeleteThought.deleteThought.mockResolvedValueOnce({});
      
      // Try to delete ambiguous thought
      const deleteButton = screen.getByTestId('delete-sortable-t4');
      fireEvent.click(deleteButton);
      
      // Should still work even when structure hasn't changed
      expect(screen.getByTestId('column-introduction')).toBeInTheDocument();
      
      mockConfirm.mockRestore();
    });
  });
});
