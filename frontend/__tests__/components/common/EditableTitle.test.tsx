import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import EditableTitle from '@/components/common/EditableTitle';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    return {
      t: (key: string) => {
        const translations: Record<string, string> = {
          'common.editTitleInput': 'Edit Title',
          'common.save': 'Save',
          'common.cancel': 'Cancel',
          'common.edit': 'Edit',
          'errors.failedToSaveTitle': 'Failed to save title',
        };
        return translations[key] || key;
      }
    };
  },
}));

describe('EditableTitle Component', () => {
  const mockOnSave = jest.fn();

  beforeEach(() => {
    mockOnSave.mockClear();
  });

  const defaultProps = {
    initialTitle: 'Test Sermon Title',
    onSave: mockOnSave,
  };

  describe('Rendering', () => {
    it('covers display-state rendering variants', async () => {
      await runScenarios(
        [
          {
            name: 'shows title and edit icon',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              expect(screen.getByText(defaultProps.initialTitle)).toBeInTheDocument();
            }
          },
          {
            name: 'applies custom classes',
            run: () => {
              render(<EditableTitle {...defaultProps} containerClass="custom-container" />);
              const container = screen.getByText(defaultProps.initialTitle).closest('div')?.parentElement;
              expect(container).toHaveClass('custom-container');
            }
          },
          {
            name: 'applies custom text and button sizes',
            run: () => {
              render(<EditableTitle {...defaultProps} textSizeClass="custom-text" buttonSizeClass="custom-button" />);
              const titleElement = screen.getByText(defaultProps.initialTitle);
              expect(titleElement).toHaveClass('custom-text');
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
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              expect(screen.getByTitle('Save')).toBeInTheDocument();
            }
          },
          {
            name: 'focuses input and selects text',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              expect(input).toHaveFocus();
              expect(input).toHaveValue(defaultProps.initialTitle);
            }
          },
          {
            name: 'updates input value',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              expect(input).toHaveValue('Updated title text');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Save Functionality', () => {
    it('handles saving flows and commit operations', async () => {
      await runScenarios(
        [
          {
            name: 'commits changes via button click',
            run: async () => {
              mockOnSave.mockResolvedValue(undefined);
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSave).toHaveBeenCalledWith('Updated title text'));
            }
          },
          {
            name: 'commits changes via Enter key',
            run: async () => {
              mockOnSave.mockResolvedValue(undefined);
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.keyDown(input, { key: 'Enter' });
              await waitFor(() => expect(mockOnSave).toHaveBeenCalledWith('Updated title text'));
            }
          },
          {
            name: 'does not commit unchanged text',
            run: async () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSave).not.toHaveBeenCalled());
            }
          },
          {
            name: 'does not commit whitespace-only text',
            run: async () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: '   ' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(mockOnSave).not.toHaveBeenCalled());
            }
          },
          {
            name: 'shows loading state during commit',
            run: async () => {
              mockOnSave.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              const saveButton = screen.getByTitle('Save');
              fireEvent.click(saveButton);
              expect(saveButton).toBeDisabled();
              expect(input).toBeDisabled();
            }
          },
          {
            name: 'handles commit errors gracefully',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Commit failed'));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(screen.getByText('Failed to save title')).toBeInTheDocument());
            }
          },
          {
            name: 'stays in edit mode after commit failure',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Commit failed'));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(screen.getByText('Failed to save title')).toBeInTheDocument());
              // Should still be in edit mode
              expect(screen.getByTitle('Save')).toBeInTheDocument();
              expect(screen.getByTitle('Cancel')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });

  describe('Cancel Functionality', () => {
    it('supports cancel interactions and reverts changes', async () => {
      await runScenarios(
        [
          {
            name: 'cancel button reverts uncommitted changes',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Modified title' } });
              fireEvent.click(screen.getByTitle('Cancel'));
              expect(screen.getByText(defaultProps.initialTitle)).toBeInTheDocument();
            }
          },
          {
            name: 'escape key cancels edit and reverts changes',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Modified title' } });
              fireEvent.keyDown(input, { key: 'Escape' });
              expect(screen.getByText(defaultProps.initialTitle)).toBeInTheDocument();
            }
          },
          {
            name: 'cancel clears any previous errors',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Commit failed'));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(screen.getByText('Failed to save title')).toBeInTheDocument());

              // Now cancel
              fireEvent.click(screen.getByTitle('Cancel'));
              expect(screen.queryByText('Failed to save title')).not.toBeInTheDocument();
              expect(screen.getByText(defaultProps.initialTitle)).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });

  describe('Accessibility', () => {
    it('sets ARIA labels and error states correctly', async () => {
      await runScenarios(
        [
          {
            name: 'input has proper label',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              expect(screen.getByLabelText('Edit Title')).toBeInTheDocument();
            }
          },
          {
            name: 'error state sets aria-invalid attribute',
            run: async () => {
              mockOnSave.mockRejectedValueOnce(new Error('Commit failed'));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              fireEvent.click(screen.getByTitle('Save'));
              await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'));
            }
          },
          {
            name: 'buttons have proper titles for screen readers',
            run: () => {
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              expect(screen.getByTitle('Save')).toBeInTheDocument();
              expect(screen.getByTitle('Cancel')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });

  describe('Props Updates', () => {
    it('handles prop changes gracefully during editing', async () => {
      await runScenarios(
        [
          {
            name: 'updates display when initialTitle changes',
            run: () => {
              const { rerender } = render(<EditableTitle {...defaultProps} />);
              rerender(<EditableTitle {...defaultProps} initialTitle="Updated initial title" />);
              expect(screen.getByText('Updated initial title')).toBeInTheDocument();
            }
          },
          {
            name: 'preserves edited text during prop changes when editing',
            run: () => {
              const { rerender } = render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Edited text' } });
              rerender(<EditableTitle {...defaultProps} initialTitle="Updated initial title" />);
              expect(input).toHaveValue('Edited text');
            }
          },
          {
            name: 'resets to new initialTitle when not editing',
            run: () => {
              const { rerender } = render(<EditableTitle {...defaultProps} />);
              rerender(<EditableTitle {...defaultProps} initialTitle="Updated initial title" />);
              expect(screen.getByText('Updated initial title')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Loading States', () => {
    it('handles async commit operations properly', async () => {
      await runScenarios(
        [
          {
            name: 'prevents multiple simultaneous commits',
            run: async () => {
              let resolveCommit: (value: void) => void;
              const commitPromise = new Promise<void>(resolve => {
                resolveCommit = resolve;
              });
              mockOnSave.mockReturnValueOnce(commitPromise);

              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });

              const saveButton = screen.getByTitle('Save');
              fireEvent.click(saveButton);
              expect(saveButton).toBeDisabled();

              // Try to click save again while first commit is in progress
              fireEvent.click(saveButton);
              expect(mockOnSave).toHaveBeenCalledTimes(1); // Should not trigger second commit

              // Resolve the first commit
              resolveCommit!();
              await waitFor(() => expect(saveButton).toBeEnabled());
            }
          },
          {
            name: 'shows loading state during commit',
            run: async () => {
              mockOnSave.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
              render(<EditableTitle {...defaultProps} />);
              fireEvent.click(screen.getByTitle('Edit'));
              const input = screen.getByDisplayValue(defaultProps.initialTitle);
              fireEvent.change(input, { target: { value: 'Updated title text' } });
              const saveButton = screen.getByTitle('Save');
              fireEvent.click(saveButton);
              expect(saveButton).toBeDisabled();
              expect(input).toBeDisabled();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnSave.mockReset(); } }
      );
    });
  });
});
