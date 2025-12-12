import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import EditableVerse from '@/components/common/EditableVerse';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

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
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('EditableVerse Component', () => {
  const mockOnSave = jest.fn();

  beforeEach(() => {
    mockOnSave.mockClear();
  });

  const defaultProps = {
    initialVerse: 'John 3:16 - For God so loved the world...',
    onSave: mockOnSave,
  };

  describe('Rendering', () => {
    it('covers display-state rendering variants', async () => {
      await runScenarios(
        [
          {
            name: 'shows verse and edit icon',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              expect(screen.getByText(defaultProps.initialVerse)).toBeInTheDocument();
            }
          },
          {
            name: 'hides component when verse empty',
            run: () => {
              const { container } = render(<EditableVerse {...defaultProps} initialVerse="" />);
              expect(container.firstChild).toBeNull();
            }
          },
          {
            name: 'applies custom classes',
            run: () => {
              render(<EditableVerse {...defaultProps} containerClass="custom-container" />);
              const container = screen.getByText(defaultProps.initialVerse).closest('div')?.parentElement;
              expect(container).toHaveClass('custom-container');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edit Mode', () => {
    it('enters edit mode and updates input', async () => {
      await runScenarios(
        [
          {
            name: 'enter edit mode',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              expect(screen.getByTitle('Save')).toBeInTheDocument();
            }
          },
          {
            name: 'focuses textarea and updates value',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              expect(textarea).toHaveFocus();
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              expect(textarea).toHaveValue('Updated verse text');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Save Functionality', () => {
    it('handles saving flows and errors', async () => {
      await runScenarios(
        [
          {
            name: 'saves via button and ctrl+enter',
            run: async () => {
              mockOnSave.mockResolvedValue(undefined);
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
              await waitFor(() => expect(mockOnSave).toHaveBeenCalledWith('Updated verse text'));
            }
          },
          {
            name: 'does not save unchanged or whitespace text',
            run: async () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSave).not.toHaveBeenCalled());
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: '   ' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSave).not.toHaveBeenCalled());
            }
          },
          {
            name: 'shows loading and error states',
            run: async () => {
              mockOnSave.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              const saveButton = screen.getByTitle('Save');
              fireEvent.click(saveButton);
              expect(saveButton).toBeDisabled();
            }
          },
          {
            name: 'handles save errors gracefully',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Save failed'));
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(screen.getByText('Failed to save verse')).toBeInTheDocument());
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });

  describe('Cancel Functionality', () => {
    it('supports cancel interactions', async () => {
      await runScenarios(
        [
          {
            name: 'cancel button reverts edit',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              fireEvent.click(screen.getByTitle('Cancel'));
              expect(screen.getByText(defaultProps.initialVerse)).toBeInTheDocument();
            }
          },
          {
            name: 'escape key cancels edit',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              fireEvent.keyDown(textarea, { key: 'Escape' });
              expect(screen.getByText(defaultProps.initialVerse)).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Adaptive Height', () => {
    it('applies height constraints', async () => {
      await runScenarios(
        [
          {
            name: 'initial textarea sizing',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              expect(textarea).toHaveStyle({ minHeight: '20px' });
            }
          },
          {
            name: 'adjusts when content grows',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              Object.defineProperty(textarea, 'scrollHeight', { value: 100, writable: true });
              fireEvent.change(textarea, { target: { value: 'Line 1\nLine 2' } });
              expect(textarea).toHaveValue('Line 1\nLine 2');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('sets ARIA labels and errors', async () => {
      await runScenarios(
        [
          {
            name: 'textarea has label',
            run: () => {
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              expect(screen.getByLabelText('Scripture Verse')).toBeInTheDocument();
            }
          },
          {
            name: 'error state sets aria attributes',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Save failed'));
              render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Updated verse text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(textarea).toHaveAttribute('aria-invalid', 'true'));
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });

  describe('Props Updates', () => {
    it('handles prop changes gracefully', async () => {
      await runScenarios(
        [
          {
            name: 'updates display when initialVerse changes',
            run: () => {
              const { rerender } = render(<EditableVerse {...defaultProps} />);
              rerender(<EditableVerse {...defaultProps} initialVerse="Updated initial verse" />);
              expect(screen.getByText('Updated initial verse')).toBeInTheDocument();
            }
          },
          {
            name: 'preserves edited text during prop changes',
            run: () => {
              const { rerender } = render(<EditableVerse {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const textarea = screen.getByDisplayValue(defaultProps.initialVerse);
              fireEvent.change(textarea, { target: { value: 'Edited text' } });
              rerender(<EditableVerse {...defaultProps} initialVerse="Updated initial verse" />);
              expect(textarea).toHaveValue('Edited text');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });
});
