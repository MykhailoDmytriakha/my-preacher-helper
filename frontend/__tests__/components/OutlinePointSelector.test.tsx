import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import OutlinePointSelector from '@components/OutlinePointSelector';
import type { Thought, Outline } from '@/models/models';

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => {
      const translations: Record<string, string> = {
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
        'editThought.noOutlinePoint': 'No outline point selected',
        'editThought.noOutlinePointAssigned': 'Outline point not assigned',
        'editThought.selectOutlinePoint': 'Select outline point',
        'outline.introduction': 'Introduction',
        'outline.mainPoints': 'Main Points',
        'outline.conclusion': 'Conclusion',
      };
      return translations[key] || defaultValue || key;
    },
  }),
}));

describe('OutlinePointSelector', () => {
  const mockOutline: Outline = {
    introduction: [
      { id: 'intro-1', text: 'Opening statement' },
      { id: 'intro-2', text: 'Context setting' },
    ],
    main: [
      { id: 'main-1', text: 'First main point' },
      { id: 'main-2', text: 'Second main point' },
      { id: 'main-3', text: 'Third main point' },
    ],
    conclusion: [
      { id: 'concl-1', text: 'Summary' },
      { id: 'concl-2', text: 'Call to action' },
    ],
  };

  const mockThoughtWithoutOutline: Thought = {
    id: 'thought-1',
    text: 'Test thought',
    tags: ['Основная часть'],
    date: '2025-09-30T10:00:00Z',
  };

  const mockThoughtWithOutline: Thought = {
    id: 'thought-2',
    text: 'Test thought with outline',
    tags: ['Основная часть'],
    date: '2025-09-30T10:00:00Z',
    outlinePointId: 'main-1',
  };

  const mockOnOutlinePointChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should not render when sermonOutline is undefined', () => {
      const { container } = render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={undefined}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should not render when there are no outline points', () => {
      const emptyOutline: Outline = {
        introduction: [],
        main: [],
        conclusion: [],
      };
      const { container } = render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={emptyOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it('should render "not assigned" state when thought has no outline point', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(screen.getByText('Outline point not assigned')).toBeInTheDocument();
    });

    it('should render assigned outline point when thought has outlinePointId', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(screen.getByText(/Main Part:/)).toBeInTheDocument();
      expect(screen.getByText(/First main point/)).toBeInTheDocument();
    });

    it('should render outline point from introduction section', () => {
      const thoughtWithIntro: Thought = {
        ...mockThoughtWithoutOutline,
        outlinePointId: 'intro-1',
        tags: ['Вступление'],
      };
      render(
        <OutlinePointSelector
          thought={thoughtWithIntro}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(screen.getByText(/Introduction:/)).toBeInTheDocument();
      expect(screen.getByText(/Opening statement/)).toBeInTheDocument();
    });

    it('should render outline point from conclusion section', () => {
      const thoughtWithConclusion: Thought = {
        ...mockThoughtWithoutOutline,
        outlinePointId: 'concl-1',
        tags: ['Заключение'],
      };
      render(
        <OutlinePointSelector
          thought={thoughtWithConclusion}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );
      expect(screen.getByText(/Conclusion:/)).toBeInTheDocument();
      expect(screen.getByText(/Summary/)).toBeInTheDocument();
    });
  });

  describe('Dropdown Interaction', () => {
    it('should open dropdown when button is clicked', async () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Select outline point')).toBeInTheDocument();
      });
    });

    it('should close dropdown when clicking outside', async () => {
      render(
        <div>
          <OutlinePointSelector
            thought={mockThoughtWithoutOutline}
            sermonOutline={mockOutline}
            onOutlinePointChange={mockOnOutlinePointChange}
          />
          <div data-testid="outside">Outside element</div>
        </div>
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Select outline point')).toBeInTheDocument();
      });

      const outside = screen.getByTestId('outside');
      fireEvent.mouseDown(outside);

      await waitFor(() => {
        expect(screen.queryByText('Select outline point')).not.toBeInTheDocument();
      });
    });

    it('should show chevron icon that rotates when dropdown opens', async () => {
      const { container } = render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned').closest('button');
      const chevron = container.querySelector('svg');

      expect(chevron).toBeInTheDocument();
      expect(chevron).not.toHaveClass('rotate-180');

      fireEvent.click(button!);

      await waitFor(() => {
        expect(chevron).toHaveClass('rotate-180');
      });
    });
  });

  describe('Outline Point Selection', () => {
    it('should call onOutlinePointChange when selecting an outline point', async () => {
      mockOnOutlinePointChange.mockResolvedValue(undefined);

      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('First main point')).toBeInTheDocument();
      });

      const outlineOption = screen.getByText('First main point');
      fireEvent.click(outlineOption);

      await waitFor(() => {
        expect(mockOnOutlinePointChange).toHaveBeenCalledWith('main-1');
      });
    });

    it('should call onOutlinePointChange with undefined when removing outline point', async () => {
      mockOnOutlinePointChange.mockResolvedValue(undefined);

      render(
        <OutlinePointSelector
          thought={mockThoughtWithOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText(/First main point/);
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('No outline point selected')).toBeInTheDocument();
      });

      const removeOption = screen.getByText('No outline point selected');
      fireEvent.click(removeOption);

      await waitFor(() => {
        expect(mockOnOutlinePointChange).toHaveBeenCalledWith(undefined);
      });
    });

    it('should close dropdown after selecting an outline point', async () => {
      mockOnOutlinePointChange.mockResolvedValue(undefined);

      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('First main point')).toBeInTheDocument();
      });

      const outlineOption = screen.getByText('First main point');
      fireEvent.click(outlineOption);

      await waitFor(() => {
        expect(screen.queryByText('Select outline point')).not.toBeInTheDocument();
      });
    });

    it('should handle errors when outline point update fails', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      mockOnOutlinePointChange.mockRejectedValue(new Error('Update failed'));

      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('First main point')).toBeInTheDocument();
      });

      const outlineOption = screen.getByText('First main point');
      fireEvent.click(outlineOption);

      await waitFor(() => {
        expect(consoleError).toHaveBeenCalledWith(
          'Failed to update outline point:',
          expect.any(Error)
        );
      });

      consoleError.mockRestore();
    });
  });

  describe('Section Filtering', () => {
    it('should show only main section points when thought has main tag', async () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Main Points')).toBeInTheDocument();
        expect(screen.getByText('First main point')).toBeInTheDocument();
        expect(screen.getByText('Second main point')).toBeInTheDocument();
        expect(screen.getByText('Third main point')).toBeInTheDocument();
      });

      expect(screen.queryByText('Opening statement')).not.toBeInTheDocument();
      expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    });

    it('should show only introduction points when thought has introduction tag', async () => {
      const introThought: Thought = {
        ...mockThoughtWithoutOutline,
        tags: ['Вступление'],
      };

      render(
        <OutlinePointSelector
          thought={introThought}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Introduction')).toBeInTheDocument();
        expect(screen.getByText('Opening statement')).toBeInTheDocument();
        expect(screen.getByText('Context setting')).toBeInTheDocument();
      });

      expect(screen.queryByText('First main point')).not.toBeInTheDocument();
      expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    });

    it('should show only conclusion points when thought has conclusion tag', async () => {
      const conclusionThought: Thought = {
        ...mockThoughtWithoutOutline,
        tags: ['Заключение'],
      };

      render(
        <OutlinePointSelector
          thought={conclusionThought}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Conclusion')).toBeInTheDocument();
        expect(screen.getByText('Summary')).toBeInTheDocument();
        expect(screen.getByText('Call to action')).toBeInTheDocument();
      });

      expect(screen.queryByText('First main point')).not.toBeInTheDocument();
      expect(screen.queryByText('Opening statement')).not.toBeInTheDocument();
    });

    it('should show all sections when thought has no section tag', async () => {
      const noSectionThought: Thought = {
        ...mockThoughtWithoutOutline,
        tags: ['custom-tag'],
      };

      render(
        <OutlinePointSelector
          thought={noSectionThought}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Introduction')).toBeInTheDocument();
        expect(screen.getByText('Main Points')).toBeInTheDocument();
        expect(screen.getByText('Conclusion')).toBeInTheDocument();
      });
    });

    it('should show all sections when thought has multiple section tags', async () => {
      const multiSectionThought: Thought = {
        ...mockThoughtWithoutOutline,
        tags: ['Вступление', 'Основная часть'],
      };

      render(
        <OutlinePointSelector
          thought={multiSectionThought}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('Introduction')).toBeInTheDocument();
        expect(screen.getByText('Main Points')).toBeInTheDocument();
        expect(screen.getByText('Conclusion')).toBeInTheDocument();
      });
    });
  });

  describe('Disabled State', () => {
    it('should be disabled when disabled prop is true', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
          disabled={true}
        />
      );

      const button = screen.getByText('Outline point not assigned').closest('button');
      expect(button).toBeDisabled();
    });

    it('should not open dropdown when disabled', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
          disabled={true}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      expect(screen.queryByText('Select outline point')).not.toBeInTheDocument();
    });

    it('should show disabled styling', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
          disabled={true}
        />
      );

      const button = screen.getByText('Outline point not assigned').closest('button');
      expect(button).toHaveClass('disabled:opacity-50', 'disabled:cursor-not-allowed');
    });
  });

  describe('Visual States', () => {
    it('should highlight currently selected outline point in dropdown', async () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText(/First main point/);
      fireEvent.click(button);

      await waitFor(() => {
        const selectedOption = screen.getByText('First main point').closest('button');
        expect(selectedOption).toHaveClass('bg-blue-50', 'text-blue-700');
      });
    });

    it('should show hover state for non-selected options', async () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText(/First main point/);
      fireEvent.click(button);

      await waitFor(() => {
        const nonSelectedOption = screen.getByText('Second main point').closest('button');
        expect(nonSelectedOption).toHaveClass('hover:bg-gray-100');
      });
    });

    it('should render dashed border for unassigned state', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned').closest('button');
      expect(button).toHaveClass('border-2', 'border-dashed');
    });

    it('should render solid border for assigned state', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText(/First main point/).closest('button');
      expect(button).toHaveClass('border');
      expect(button).not.toHaveClass('border-dashed');
    });
  });

  describe('Accessibility', () => {
    it('should have accessible button element', () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByRole('button');
      expect(button).toBeInTheDocument();
    });

    it('should support keyboard navigation', async () => {
      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned').closest('button');
      button?.focus();
      
      expect(document.activeElement).toBe(button);
    });
  });

  describe('Edge Cases', () => {
    it('should handle outline with empty arrays', () => {
      const partialOutline: Outline = {
        introduction: [],
        main: [{ id: 'main-1', text: 'Only main point' }],
        conclusion: [],
      };

      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={partialOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      expect(screen.getByText('Outline point not assigned')).toBeInTheDocument();
    });

    it('should handle thought with invalid outlinePointId', () => {
      const thoughtWithInvalidId: Thought = {
        ...mockThoughtWithoutOutline,
        outlinePointId: 'invalid-id',
      };

      render(
        <OutlinePointSelector
          thought={thoughtWithInvalidId}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      expect(screen.getByText('Outline point not assigned')).toBeInTheDocument();
    });

    it('should be disabled during update', async () => {
      let resolveUpdate: () => void;
      const updatePromise = new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      });
      mockOnOutlinePointChange.mockReturnValue(updatePromise);

      render(
        <OutlinePointSelector
          thought={mockThoughtWithoutOutline}
          sermonOutline={mockOutline}
          onOutlinePointChange={mockOnOutlinePointChange}
        />
      );

      const button = screen.getByText('Outline point not assigned');
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText('First main point')).toBeInTheDocument();
      });

      const outlineOption = screen.getByText('First main point');
      fireEvent.click(outlineOption);

      await waitFor(() => {
        const buttons = screen.getAllByRole('button');
        buttons.forEach(btn => {
          if (btn.textContent?.includes('point')) {
            expect(btn).toBeDisabled();
          }
        });
      });

      resolveUpdate!();
    });
  });
});
