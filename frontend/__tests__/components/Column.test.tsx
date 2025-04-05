import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import Column from '@/components/Column';
import { Item } from '@/models/models';
import '@testing-library/jest-dom';

// Mock the i18next library
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string, options?: any) => {
        const translations: Record<string, string> = {
          'structure.focusMode': 'Focus Mode',
          'structure.normalMode': 'Normal Mode',
          'structure.noEntries': 'No entries',
          'structure.outlinePoints': 'Outline Points',
          'structure.addPointButton': 'Add outline point',
          'structure.addPointPlaceholder': 'Enter new outline point',
          'structure.editPointPlaceholder': 'Edit outline point',
          'structure.outlineSavedSuccess': 'Outline saved',
          'structure.deletePointConfirm': options?.text ? `Are you sure you want to delete this outline point: "${options.text}"?` : 'Are you sure?',
          'structure.addThoughtToSection': options?.section ? `Add thought to ${options.section}` : 'Add thought',
          'structure.sortButton': 'Сортировать',
          'structure.sorting': 'Сортировка...',
          'structure.sortInfo': 'Sorting only processes unassigned thoughts, up to 25 at a time.',
          'errors.saveOutlineError': 'Failed to save outline',
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.edit': 'Edit',
          'common.delete': 'Delete',
          'buttons.saving': 'Saving'
        };
        return translations[key] || key;
      }
    };
  }
}));

// Mock toast notifications
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn()
  }
}));

// Mock outline service
jest.mock('@/services/outline.service', () => ({
  updateSermonOutline: jest.fn(() => Promise.resolve({ success: true }))
}));

// Mock react-markdown to prevent ESM errors
jest.mock('react-markdown', () => (props: any) => <>{props.children}</>);
// Mock remark-gfm as well
jest.mock('remark-gfm', () => ({}));

// Mock the ExportButtons component
jest.mock('@components/ExportButtons', () => {
  return function MockExportButtons(props: any) {
    return (
      <div 
        data-testid="export-buttons-container" 
        className={props.className}
        data-orientation={props.orientation}
      >
        <button>TXT</button>
        <button disabled>PDF</button>
        <button disabled>Word</button>
      </div>
    );
  };
});

describe('Column Component', () => {
  const mockItems: Item[] = [
    { id: '1', content: 'Item 1', customTagNames: [] },
    { id: '2', content: 'Item 2', customTagNames: [] }
  ];

  it('renders correctly in normal mode', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems} 
      />
    );
    
    expect(screen.getByText('Introduction')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('displays focus button when showFocusButton is true', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    // Find button with the Focus Mode title
    const focusButton = screen.getByTitle('Focus Mode');
    expect(focusButton).toBeInTheDocument();
  });

  it('does not display focus button when showFocusButton is false', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={false}
      />
    );
    
    expect(screen.queryByText('Focus Mode')).not.toBeInTheDocument();
  });

  it('displays Normal Mode text when in focus mode', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    expect(screen.getByText('Normal Mode')).toBeInTheDocument();
  });

  it('calls onToggleFocusMode when focus button is clicked', () => {
    const mockToggleFocus = jest.fn();
    
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={false}
        onToggleFocusMode={mockToggleFocus}
      />
    );
    
    fireEvent.click(screen.getByTitle('Focus Mode'));
    expect(mockToggleFocus).toHaveBeenCalledWith('introduction');
  });

  it('displays items in a vertical list layout when in focus mode', () => {
    const { container } = render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        showFocusButton={true}
        isFocusMode={true}
        onToggleFocusMode={() => {}}
      />
    );
    
    // Check that the space-y-3 class is applied for vertical spacing in focus mode
    const itemsContainer = container.querySelector('.space-y-3');
    expect(itemsContainer).toBeInTheDocument();
  });

  it('renders custom class name when provided', () => {
    const { container } = render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        className="custom-class"
      />
    );
    
    const columnContainer = container.firstChild;
    expect(columnContainer).toHaveClass('custom-class');
  });

  it('shows outline points when provided', () => {
    const outlinePoints = [
      { id: '1', text: 'Point 1' },
      { id: '2', text: 'Point 2' }
    ];
    
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={mockItems}
        outlinePoints={outlinePoints}
      />
    );
    
    expect(screen.getByText('Point 1')).toBeInTheDocument();
    expect(screen.getByText('Point 2')).toBeInTheDocument();
  });

  it('displays no entries message when items array is empty', () => {
    render(
      <Column 
        id="introduction" 
        title="Introduction" 
        items={[]}
      />
    );
    
    expect(screen.getByText('No entries')).toBeInTheDocument();
  });

  // New tests for outline point operations in focus mode
  describe('Outline Point Operations in Focus Mode', () => {
    const mockOutlinePoints = {
      introduction: [
        { id: 'point1', text: 'Existing outline point' }
      ],
      mainPart: [],
      conclusion: []
    };
    
    const mockToggleFocus = jest.fn();
    const mockSermonId = 'sermon-123';
    const { updateSermonOutline } = require('@/services/outline.service');
    const { toast } = require('sonner');
    
    beforeEach(() => {
      // Reset mocks
      updateSermonOutline.mockClear();
      mockToggleFocus.mockClear();
      toast.success.mockClear();
      toast.error.mockClear();
      
      // Mock the implementation of updateSermonOutline
      updateSermonOutline.mockImplementation(() => Promise.resolve({ success: true }));
      
      // Mock setTimeout to execute immediately
      jest.useFakeTimers();
    });
    
    afterEach(() => {
      jest.useRealTimers();
    });
    
    it.skip('adds a new outline point in focus mode', async () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
          sermonId={mockSermonId}
          onOutlineUpdate={updateSermonOutline}
        />
      );
      
      // Find "Add outline point" button by text and click it
      const addButton = screen.getByText('Add outline point');
      fireEvent.click(addButton);
      
      // Find input field and type new point
      const input = screen.getByPlaceholderText('Enter new outline point');
      fireEvent.change(input, { target: { value: 'New outline point' } });
      
      // Click the save button - now uses aria-label instead of data-testid
      const saveButton = screen.getByLabelText('Save');
      fireEvent.click(saveButton);
      
      // Fast-forward timers to trigger the debounced save
      act(() => {
        jest.advanceTimersByTime(300);
      });
      
      // Should have called the API
      expect(updateSermonOutline).toHaveBeenCalled();
      
      // Should update the UI with the new point
      await waitFor(() => {
        expect(screen.getByText('New outline point')).toBeInTheDocument();
      });
    });
    
    it.skip('edits an existing outline point in focus mode', async () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
          sermonId={mockSermonId}
          onOutlineUpdate={updateSermonOutline}
        />
      );
      
      // Find edit button by aria-label and click it
      const editButton = screen.getByLabelText('Edit');
      fireEvent.click(editButton);
      
      // Find input field and update the value
      const input = screen.getByDisplayValue('Existing outline point');
      fireEvent.change(input, { target: { value: 'Updated outline point' } });
      
      // Click the save button
      const saveButton = screen.getByLabelText('Save');
      fireEvent.click(saveButton);
      
      // Fast-forward timers to trigger the debounced save
      act(() => {
        jest.advanceTimersByTime(300);
      });
      
      // Verify API was called with updated data
      expect(updateSermonOutline).toHaveBeenCalledWith(
        mockSermonId, 
        expect.objectContaining({ 
          introduction: [{ id: 'point1', text: 'Updated outline point' }]
        })
      );
    });
    
    it.skip('deletes an outline point when delete is confirmed', async () => {
      // Mock window.confirm to return true
      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(true);
      
      // Setup the component with outline points and focus mode enabled
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
          sermonId={mockSermonId}
          onOutlineUpdate={updateSermonOutline}
        />
      );
      
      // Find delete button by aria-label and click it
      const deleteButton = screen.getByLabelText('Delete');
      fireEvent.click(deleteButton);
      
      // Verify window.confirm was called
      expect(window.confirm).toHaveBeenCalled();
      
      // Fast-forward timers to trigger the debounced save
      act(() => {
        jest.advanceTimersByTime(300);
      });
      
      // Wait for API call to be made
      await waitFor(() => {
        expect(updateSermonOutline).toHaveBeenCalledWith(
          mockSermonId,
          expect.objectContaining({ introduction: [] })
        );
      }, { timeout: 1000 });
      
      // Restore original window.confirm
      window.confirm = originalConfirm;
    }, 10000); // Increase timeout for this test
    
    it('handles API errors when saving outline points', async () => {
      // Mock updateSermonOutline to reject
      const mockError = new Error('API Error');
      updateSermonOutline.mockRejectedValueOnce(mockError);
      
      // Setup the component with outline points and focus mode enabled
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
          sermonId={mockSermonId}
          onOutlineUpdate={updateSermonOutline}
        />
      );
      
      // Find add button by text and click it
      const addButton = screen.getByText('Add outline point');
      fireEvent.click(addButton);
      
      // Find input field and type new point
      const input = screen.getByPlaceholderText('Enter new outline point');
      fireEvent.change(input, { target: { value: 'New outline point' } });
      
      // Click the save button
      const saveButton = screen.getByLabelText('Save');
      fireEvent.click(saveButton);
      
      // Fast-forward timers to trigger the debounced save
      act(() => {
        jest.advanceTimersByTime(300);
      });
      
      // Should show an error toast
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to save outline');
      });
    });
  });

  // Tests for sorting button and export buttons in focus mode
  describe('Sort Button and Export Buttons in Focus Mode', () => {
    const mockSermonId = 'sermon-123';
    const mockGetExportContent = jest.fn(() => Promise.resolve('Example content'));
    const mockAiSort = jest.fn();
    
    it('renders AI sorting button in focus mode when onAiSort is provided', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={mockAiSort}
        />
      );
      
      // Find button by its text content "Сортировать"
      const sortButton = screen.getByText('Сортировать');
      expect(sortButton).toBeInTheDocument();
      
      // Check parent button has correct styling
      const buttonElement = sortButton.closest('button')!;
      expect(buttonElement).toHaveClass('bg-blue-500');  // For introduction section
      expect(buttonElement).toHaveClass('text-white');
      expect(buttonElement).toHaveClass('border-blue-400');
      expect(buttonElement).toHaveClass('shadow-md');
    });
    
    it('does not render AI sorting button when onAiSort is not provided', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
        />
      );
      
      expect(screen.queryByText('Сортировать')).not.toBeInTheDocument();
    });
    
    it('calls onAiSort when sort button is clicked', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={mockAiSort}
        />
      );
      
      const sortButton = screen.getByText('Сортировать').closest('button')!;
      fireEvent.click(sortButton);
      
      expect(mockAiSort).toHaveBeenCalled();
    });
    
    it('shows loading state when isLoading is true', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={mockAiSort}
          isLoading={true}
        />
      );
      
      const loadingText = screen.getByText('Сортировка...');
      expect(loadingText).toBeInTheDocument();
      
      // Check for spinner SVG using its class rather than role
      const button = loadingText.closest('button');
      expect(button).toBeDisabled();
      
      const spinnerSVG = button?.querySelector('svg.animate-spin');
      expect(spinnerSVG).toBeInTheDocument();
    });
    
    it('renders export buttons in focus mode when getExportContent is provided', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          getExportContent={mockGetExportContent}
          sermonId={mockSermonId}
        />
      );
      
      // Look for the ExportButtons component by data-testid
      const exportContainer = screen.getByTestId('export-buttons-container');
      expect(exportContainer).toBeInTheDocument();
    });
    
    it('does not render export buttons when getExportContent is not provided', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
        />
      );
      
      expect(screen.queryByTestId('export-buttons-container')).not.toBeInTheDocument();
    });
    
    it('applies correct color styling for main section sort button', () => {
      render(
        <Column 
          id="main" 
          title="Main" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={mockAiSort}
        />
      );
      
      const sortButtonText = screen.getByText('Сортировать');
      const sortButton = sortButtonText.closest('button')!;
      expect(sortButton).toHaveClass('bg-purple-500');
    });
    
    it('applies correct color styling for conclusion section sort button', () => {
      render(
        <Column 
          id="conclusion" 
          title="Conclusion" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={mockAiSort}
        />
      );
      
      const sortButtonText = screen.getByText('Сортировать');
      const sortButton = sortButtonText.closest('button')!;
      expect(sortButton).toHaveClass('bg-green-500');
    });
  });

  // Tests for hover styles and UI details in focus mode
  describe('Hover Styles and UI Details in Focus Mode', () => {
    const mockOutlinePoints = {
      introduction: [
        { id: 'point1', text: 'Existing outline point' }
      ],
      mainPart: [],
      conclusion: []
    };
    
    const mockToggleFocus = jest.fn();
    const mockSermonId = 'sermon-123';
    const mockAiSort = jest.fn();
    
    it('applies correct hover styles to outline points in focus mode', () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
        />
      );
      
      // Find the list item containing the outline point text
      const pointItem = screen.getByText('Existing outline point').closest('li')!;
      expect(pointItem).toHaveClass('hover:bg-white/15');
    });
    
    it('renders edit and delete buttons with correct hover styles', () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          outlinePoints={mockOutlinePoints.introduction}
        />
      );
      
      // Find the edit button by aria-label
      const editButton = screen.getByLabelText('Edit');
      expect(editButton).toHaveClass('hover:text-white');
      
      // Find the delete button by aria-label
      const deleteButton = screen.getByLabelText('Delete');
      expect(deleteButton).toHaveClass('hover:text-white');
    });
    
    it('correctly renders the "Add outline point" button with hover styles', () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
        />
      );
      
      // Find the add outline point button by text content
      const addButton = screen.getByText('Add outline point').closest('button')!;
      expect(addButton).toBeInTheDocument();
      
      // Check it has the correct hover classes
      expect(addButton).toHaveClass('hover:bg-white/20');
      expect(addButton).toHaveClass('hover:text-white');
    });
    
    it('renders a star emoji in the sort button', () => {
      render(
        <Column 
          title="Introduction"
          id="introduction"
          items={[]}
          showFocusButton={true}
          isFocusMode={true}
          onToggleFocusMode={mockToggleFocus}
          onAiSort={mockAiSort}
        />
      );
      
      // Find the sort button containing the emoji character
      const emojiElement = screen.getByText('✨');
      expect(emojiElement).toBeInTheDocument();
      expect(emojiElement).toHaveClass('animate-pulse');
    });
  });
}); 