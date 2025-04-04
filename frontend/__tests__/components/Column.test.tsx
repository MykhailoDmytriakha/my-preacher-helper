import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
    
    expect(screen.getByText('Focus Mode')).toBeInTheDocument();
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
    
    fireEvent.click(screen.getByText('Focus Mode'));
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
    const mockOutlinePoints = [
      { id: 'point1', text: 'Existing outline point' }
    ];
    
    const mockUpdateOutline = jest.fn();
    const mockSermonId = 'sermon-123';
    const { updateSermonOutline } = require('@/services/outline.service');
    const { toast } = require('sonner');
    
    beforeEach(() => {
      // Reset mocks
      updateSermonOutline.mockClear();
      mockUpdateOutline.mockClear();
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
    
    it('adds a new outline point in focus mode', async () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          showFocusButton={true}
          outlinePoints={mockOutlinePoints}
          sermonId={mockSermonId}
          onOutlineUpdate={mockUpdateOutline}
          onToggleFocusMode={() => {}}
        />
      );
      
      // Should show existing point
      expect(screen.getByText('Existing outline point')).toBeInTheDocument();
      
      // Find and click add button
      const addButton = screen.getByLabelText('Add outline point');
      fireEvent.click(addButton);
      
      // Find input field and type new point
      const inputField = screen.getByPlaceholderText('Enter new outline point');
      fireEvent.change(inputField, { target: { value: 'New outline point' } });
      
      // Press Enter to save
      fireEvent.keyDown(inputField, { key: 'Enter', code: 'Enter' });
      
      // Check if the new point is now displayed
      expect(screen.getByText('New outline point')).toBeInTheDocument();
      
      // Run timers to trigger the debounced save
      jest.runAllTimers();
      
      // Verify API was called correctly
      expect(updateSermonOutline).toHaveBeenCalledWith(
        mockSermonId, 
        expect.objectContaining({ 
          introduction: expect.arrayContaining([
            { id: 'point1', text: 'Existing outline point' },
            expect.objectContaining({ text: 'New outline point' })
          ])
        })
      );
      
      // Verify toast was shown
      await act(async () => {
        await Promise.resolve();
      });
      expect(toast.success).toHaveBeenCalledWith('Outline saved');
    });
    
    it('edits an existing outline point in focus mode', async () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          showFocusButton={true}
          outlinePoints={mockOutlinePoints}
          sermonId={mockSermonId}
          onOutlineUpdate={mockUpdateOutline}
          onToggleFocusMode={() => {}}
        />
      );
      
      // Find existing point
      const pointText = screen.getByText('Existing outline point');
      
      // Find edit button within the list item
      const pointItem = pointText.closest('li');
      fireEvent.mouseOver(pointItem!); // Trigger hover to show buttons
      
      // Wait for edit button to appear and click it
      const editButton = screen.getByLabelText('Edit');
      fireEvent.click(editButton);
      
      // Find input field and update text
      const inputField = screen.getByPlaceholderText('Edit outline point');
      fireEvent.change(inputField, { target: { value: 'Updated outline point' } });
      
      // Click save button
      const saveButton = screen.getByLabelText('Save');
      fireEvent.click(saveButton);
      
      // Check if the point text was updated
      expect(screen.getByText('Updated outline point')).toBeInTheDocument();
      
      // Run timers to trigger the debounced save
      jest.runAllTimers();
      
      // Verify API was called with updated data
      expect(updateSermonOutline).toHaveBeenCalledWith(
        mockSermonId, 
        expect.objectContaining({ 
          introduction: [{ id: 'point1', text: 'Updated outline point' }]
        })
      );
    });
    
    it('deletes an outline point when delete is confirmed', async () => {
      // Mock window.confirm to return true
      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(true);
      
      try {
        render(
          <Column 
            id="introduction" 
            title="Introduction" 
            items={mockItems}
            isFocusMode={true}
            showFocusButton={true}
            outlinePoints={mockOutlinePoints}
            sermonId={mockSermonId}
            onOutlineUpdate={mockUpdateOutline}
            onToggleFocusMode={() => {}}
          />
        );
        
        // Find existing point
        const pointText = screen.getByText('Existing outline point');
        
        // Find delete button within the list item
        const pointItem = pointText.closest('li');
        fireEvent.mouseOver(pointItem!); // Trigger hover to show buttons
        
        // Wait for delete button to appear and click it
        const deleteButton = screen.getByLabelText('Delete');
        fireEvent.click(deleteButton);
        
        // Confirm should be called with the right message
        expect(window.confirm).toHaveBeenCalledWith(
          'Are you sure you want to delete this outline point: "Existing outline point"?'
        );
        
        // After deletion, the point should no longer be visible
        expect(screen.queryByText('Existing outline point')).not.toBeInTheDocument();
        
        // Run timers to trigger the debounced save
        jest.runAllTimers();
        
        // Verify API was called with empty array for this section
        expect(updateSermonOutline).toHaveBeenCalledWith(
          mockSermonId, 
          expect.objectContaining({ 
            introduction: []
          })
        );
      } finally {
        // Restore original window.confirm
        window.confirm = originalConfirm;
      }
    });
    
    it('cancels point deletion when confirm is declined', async () => {
      // Mock window.confirm to return false
      const originalConfirm = window.confirm;
      window.confirm = jest.fn().mockReturnValue(false);
      
      try {
        render(
          <Column 
            id="introduction" 
            title="Introduction" 
            items={mockItems}
            isFocusMode={true}
            showFocusButton={true}
            outlinePoints={mockOutlinePoints}
            sermonId={mockSermonId}
            onOutlineUpdate={mockUpdateOutline}
            onToggleFocusMode={() => {}}
          />
        );
        
        // Find existing point
        const pointText = screen.getByText('Existing outline point');
        
        // Find delete button within the list item
        const pointItem = pointText.closest('li');
        fireEvent.mouseOver(pointItem!); // Trigger hover to show buttons
        
        // Wait for delete button to appear and click it
        const deleteButton = screen.getByLabelText('Delete');
        fireEvent.click(deleteButton);
        
        // Confirm should be called
        expect(window.confirm).toHaveBeenCalled();
        
        // The point should still be visible
        expect(screen.getByText('Existing outline point')).toBeInTheDocument();
        
        // API should not be called
        expect(updateSermonOutline).not.toHaveBeenCalled();
      } finally {
        // Restore original window.confirm
        window.confirm = originalConfirm;
      }
    });
    
    it('handles API errors when saving outline points', async () => {
      // Mock API to throw error
      updateSermonOutline.mockRejectedValueOnce(new Error('API Error'));
      
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          showFocusButton={true}
          outlinePoints={mockOutlinePoints}
          sermonId={mockSermonId}
          onOutlineUpdate={mockUpdateOutline}
          onToggleFocusMode={() => {}}
        />
      );
      
      // Find and click add button
      const addButton = screen.getByLabelText('Add outline point');
      fireEvent.click(addButton);
      
      // Find input field and type new point
      const inputField = screen.getByPlaceholderText('Enter new outline point');
      fireEvent.change(inputField, { target: { value: 'New outline point' } });
      
      // Click save button
      const saveButton = screen.getByLabelText('Save');
      fireEvent.click(saveButton);
      
      // Run timers to trigger the debounced save
      jest.runAllTimers();
      
      // Wait for the API promise to resolve
      await act(async () => {
        try {
          await Promise.resolve();
        } catch (e) {
          // Ignore errors
        }
      });
      
      // Verify error toast was shown
      expect(toast.error).toHaveBeenCalledWith('Failed to save outline');
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
      
      const sortButton = screen.getByText('Сортировать');
      expect(sortButton).toBeInTheDocument();
      
      // Check button styling
      const button = sortButton.closest('button');
      expect(button).toHaveClass('bg-blue-500');  // For introduction section
      expect(button).toHaveClass('text-white');
      expect(button).toHaveClass('border-blue-400');
      expect(button).toHaveClass('shadow-md');
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
      
      const sortButton = screen.getByText('Сортировать');
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
      
      expect(screen.getByText('Сортировка...')).toBeInTheDocument();
      expect(screen.queryByText('Сортировать')).not.toBeInTheDocument();
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
      
      // Since ExportButtons is mocked, we can't directly check for TXT button
      // We can check if the container exists
      const exportContainer = screen.getByTestId('export-buttons-container');
      expect(exportContainer).toBeInTheDocument();
      
      // Verify horizontal orientation
      expect(exportContainer).toHaveClass('inline-flex');
      
      // Check if the container has justify-center applied
      const parentDiv = exportContainer.parentElement;
      expect(parentDiv).toHaveClass('flex');
      expect(parentDiv).toHaveClass('justify-center');
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
      
      const sortButton = screen.getByText('Сортировать');
      const button = sortButton.closest('button');
      expect(button).toHaveClass('bg-purple-500');
      expect(button).toHaveClass('border-purple-400');
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
      
      const sortButton = screen.getByText('Сортировать');
      const button = sortButton.closest('button');
      expect(button).toHaveClass('bg-green-500');
      expect(button).toHaveClass('border-green-400');
    });
  });

  // Tests for hover styles and UI details in focus mode
  describe('Hover Styles and UI Details in Focus Mode', () => {
    it('applies correct hover styles to outline points in focus mode', () => {
      const mockOutlinePoints = [
        { id: 'point1', text: 'Outline point' }
      ];
    
      const { container } = render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          outlinePoints={mockOutlinePoints}
        />
      );
      
      // Find the outline point list item
      const pointItem = screen.getByText('Outline point').closest('li');
      expect(pointItem).toBeInTheDocument();
      
      // Verify it has hover:bg-white/15 class for light hover effect
      expect(pointItem).toHaveClass('hover:bg-white/15');
      
      // Verify it has transition classes
      expect(pointItem).toHaveClass('transition-all');
    });
    
    it('renders edit and delete buttons with correct hover styles', () => {
      const mockOutlinePoints = [
        { id: 'point1', text: 'Outline point' }
      ];
    
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          outlinePoints={mockOutlinePoints}
        />
      );
      
      // Find the edit button (it might be hidden initially until hover)
      const editButton = screen.getByLabelText('Edit');
      expect(editButton).toBeInTheDocument();
      
      // Check it has the correct hover style class
      expect(editButton).toHaveClass('hover:bg-white/20');
      expect(editButton).toHaveClass('transition-colors');
      
      // Find the delete button
      const deleteButton = screen.getByLabelText('Delete');
      expect(deleteButton).toBeInTheDocument();
      
      // Check it has the correct hover style class
      expect(deleteButton).toHaveClass('hover:bg-white/20');
      expect(deleteButton).toHaveClass('transition-colors');
    });
    
    it('correctly renders the "Add outline point" button with hover styles', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
        />
      );
      
      // Find the add outline point button
      const addButton = screen.getByLabelText('Add outline point');
      expect(addButton).toBeInTheDocument();
      
      // Check it has the correct hover classes
      expect(addButton).toHaveClass('hover:bg-white/15');
      expect(addButton).toHaveClass('transition-all');
      expect(addButton).toHaveClass('border-white/30');
    });
    
    it('renders a star emoji in the sort button', () => {
      render(
        <Column 
          id="introduction" 
          title="Introduction" 
          items={mockItems}
          isFocusMode={true}
          onAiSort={jest.fn()}
        />
      );
      
      // Find the sparkle emoji in the sort button
      const sparkle = screen.getByText('✨');
      expect(sparkle).toBeInTheDocument();
      
      // Check it has animation class
      expect(sparkle).toHaveClass('animate-pulse');
    });
  });
}); 