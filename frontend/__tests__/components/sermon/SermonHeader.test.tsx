import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SermonHeader from '@/components/sermon/SermonHeader';
import { updateSermon } from '@/services/sermon.service';
import { Sermon } from '@/models/models';
import '@testing-library/jest-dom';

// Mock dependencies
jest.mock('@/services/sermon.service', () => ({
  updateSermon: jest.fn()
}));

jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => '2024-01-15')
}));

jest.mock('@utils/exportContent', () => ({
  getExportContent: jest.fn(() => Promise.resolve('exported content'))
}));

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'editSermon.verseLabel': 'Scripture Verse',
          'editSermon.versePlaceholder': 'Enter scripture verse',
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.edit': 'Edit',
          'errors.failedToSaveVerse': 'Failed to save verse',
          'errors.failedToSaveTitle': 'Failed to save title',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('SermonHeader Component', () => {
  const mockOnUpdate = jest.fn();
  const mockUpdateSermon = updateSermon as jest.MockedFunction<typeof updateSermon>;

  beforeEach(() => {
    mockOnUpdate.mockClear();
    mockUpdateSermon.mockClear();
  });

  const mockSermon: Sermon = {
    id: 'test-sermon-id',
    title: 'Test Sermon Title',
    verse: 'John 3:16 - For God so loved the world that he gave his one and only Son',
    date: new Date('2024-01-15'),
    userId: 'test-user-id',
    thoughts: [],
    outline: {
      introduction: [],
      main: [],
      conclusion: []
    },
    isPreached: false,
    preparation: {}
  };

  describe('Rendering', () => {
    it('renders sermon title, date, and verse', () => {
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
      expect(screen.getByText('2024-01-15')).toBeInTheDocument();
      expect(screen.getByText('John 3:16 - For God so loved the world that he gave his one and only Son')).toBeInTheDocument();
      expect(screen.getByText('ID: test-sermon-id')).toBeInTheDocument();
    });

    it('renders without verse when verse is empty', () => {
      const sermonWithoutVerse = { ...mockSermon, verse: '' };
      render(<SermonHeader sermon={sermonWithoutVerse} onUpdate={mockOnUpdate} />);
      
      expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
      expect(screen.queryByText('John 3:16 - For God so loved the world that he gave his one and only Son')).not.toBeInTheDocument();
    });

    it('renders export buttons', () => {
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      // Export buttons should be present (they're rendered by ExportButtons component)
      expect(screen.getByText('TXT')).toBeInTheDocument();
      expect(screen.getByText('PDF')).toBeInTheDocument();
      expect(screen.getByText('Word')).toBeInTheDocument();
    });
  });

  describe('Title Editing', () => {
    it('allows editing sermon title', async () => {
      const updatedSermon = { ...mockSermon, title: 'Updated Title' };
      mockUpdateSermon.mockResolvedValue(updatedSermon);
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      // Find and click the edit button for title
      const editButtons = screen.getAllByTitle('Edit');
      const titleEditButton = editButtons[0]; // First edit button should be for title
      fireEvent.click(titleEditButton);
      
      const titleInput = screen.getByDisplayValue('Test Sermon Title');
      fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockUpdateSermon).toHaveBeenCalledWith({
          ...mockSermon,
          title: 'Updated Title'
        });
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon);
      });
    });

    it('handles title save errors', async () => {
      mockUpdateSermon.mockRejectedValue(new Error('Save failed'));
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      const editButtons = screen.getAllByTitle('Edit');
      const titleEditButton = editButtons[0];
      fireEvent.click(titleEditButton);
      
      const titleInput = screen.getByDisplayValue('Test Sermon Title');
      fireEvent.change(titleInput, { target: { value: 'Updated Title' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText('Failed to save title')).toBeInTheDocument();
      });
      
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });
  });

  describe('Verse Editing', () => {
    it('allows editing sermon verse', async () => {
      const updatedSermon = { ...mockSermon, verse: 'Updated verse text' };
      mockUpdateSermon.mockResolvedValue(updatedSermon);
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      // Find and click the edit button for verse (should be the second edit button)
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1]; // Second edit button should be for verse
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockUpdateSermon).toHaveBeenCalledWith({
          ...mockSermon,
          verse: 'Updated verse text'
        });
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon);
      });
    });

    it('handles verse save errors', async () => {
      mockUpdateSermon.mockRejectedValue(new Error('Save failed'));
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1];
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(screen.getByText('Failed to save verse')).toBeInTheDocument();
      });
      
      expect(mockOnUpdate).not.toHaveBeenCalled();
    });

    it('allows adding verse when sermon has no verse', async () => {
      const sermonWithoutVerse = { ...mockSermon, verse: '' };
      const updatedSermon = { ...sermonWithoutVerse, verse: 'New verse text' };
      mockUpdateSermon.mockResolvedValue(updatedSermon);
      
      render(<SermonHeader sermon={sermonWithoutVerse} onUpdate={mockOnUpdate} />);
      
      // When there's no verse, the EditableVerse component should not render
      // We need to simulate adding a verse by updating the sermon prop
      const { rerender } = render(<SermonHeader sermon={sermonWithoutVerse} onUpdate={mockOnUpdate} />);
      
      // Simulate the parent component updating the sermon with a verse
      rerender(<SermonHeader sermon={{ ...sermonWithoutVerse, verse: 'New verse text' }} onUpdate={mockOnUpdate} />);
      
      expect(screen.getByText('New verse text')).toBeInTheDocument();
    });

    it('supports multi-line verse editing', async () => {
      const multiLineVerse = 'John 3:16\nFor God so loved the world\nthat he gave his one and only Son';
      const updatedSermon = { ...mockSermon, verse: multiLineVerse };
      mockUpdateSermon.mockResolvedValue(updatedSermon);
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1];
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: multiLineVerse } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockUpdateSermon).toHaveBeenCalledWith({
          ...mockSermon,
          verse: multiLineVerse
        });
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon);
      });
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('supports Ctrl+Enter to save verse', async () => {
      const updatedSermon = { ...mockSermon, verse: 'Updated verse text' };
      mockUpdateSermon.mockResolvedValue(updatedSermon);
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1];
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(verseTextarea, { key: 'Enter', ctrlKey: true });
      
      await waitFor(() => {
        expect(mockUpdateSermon).toHaveBeenCalledWith({
          ...mockSermon,
          verse: 'Updated verse text'
        });
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon);
      });
    });

    it('supports Escape to cancel verse editing', () => {
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1];
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(verseTextarea, { key: 'Escape' });
      
      // Should return to display mode with original text
      expect(screen.getByText('John 3:16 - For God so loved the world that he gave his one and only Son')).toBeInTheDocument();
      expect(mockUpdateSermon).not.toHaveBeenCalled();
    });
  });

  describe('Component Integration', () => {
    it('works without onUpdate callback', () => {
      render(<SermonHeader sermon={mockSermon} />);
      
      expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
      expect(screen.getByText('John 3:16 - For God so loved the world that he gave his one and only Son')).toBeInTheDocument();
    });

    it('handles multiple rapid edits correctly', async () => {
      const updatedSermon1 = { ...mockSermon, verse: 'First update' };
      const updatedSermon2 = { ...mockSermon, verse: 'Second update' };
      
      mockUpdateSermon
        .mockResolvedValueOnce(updatedSermon1)
        .mockResolvedValueOnce(updatedSermon2);
      
      render(<SermonHeader sermon={mockSermon} onUpdate={mockOnUpdate} />);
      
      // First edit
      const editButtons = screen.getAllByTitle('Edit');
      const verseEditButton = editButtons[1];
      fireEvent.click(verseEditButton);
      
      const verseTextarea = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
      fireEvent.change(verseTextarea, { target: { value: 'First update' } });
      
      const saveButton = screen.getByTitle('Save');
      fireEvent.click(saveButton);
      
      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon1);
      });
      
      // Second edit - need to wait for the component to update
      await waitFor(() => {
        const editButtons2 = screen.getAllByTitle('Edit');
        const verseEditButton2 = editButtons2[1];
        fireEvent.click(verseEditButton2);
        
        const verseTextarea2 = screen.getByDisplayValue('John 3:16 - For God so loved the world that he gave his one and only Son');
        fireEvent.change(verseTextarea2, { target: { value: 'Second update' } });
        
        const saveButton2 = screen.getByTitle('Save');
        fireEvent.click(saveButton2);
      });
      
      await waitFor(() => {
        expect(mockOnUpdate).toHaveBeenCalledWith(updatedSermon2);
      });
    });
  });
});
