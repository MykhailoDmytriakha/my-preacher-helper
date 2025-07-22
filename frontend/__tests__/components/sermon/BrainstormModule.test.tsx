import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import fetchMock from 'jest-fetch-mock';
import { toast } from 'sonner';
import { BrainstormSuggestion } from '@/models/models';

// Enable fetch mocking
fetchMock.enableMocks();

// Mock dependencies
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const mockTranslations: Record<string, string> = {
        'brainstorm.title': 'Ideas',
        'brainstorm.generateButton': 'Generate',
        'brainstorm.generating': '...',
        'brainstorm.newSuggestion': 'Another',
        'brainstorm.clickToStart': 'Click \'Generate\' to get a thinking prompt',
        'brainstorm.types.text': 'Reading',
        'brainstorm.types.question': 'Question',
        'brainstorm.types.context': 'Context',
        'brainstorm.types.reflection': 'Reflection',
        'brainstorm.types.relationship': 'Relationships',
        'brainstorm.types.application': 'Application',
        'errors.brainstormGenerationError': 'Failed to generate suggestion. Please try again.',
        'brainstorm.generateAnother': 'Generate Another',
        'brainstorm.copy': 'Copy',
        'brainstorm.copied': 'Copied!',
        'brainstorm.copySuggestion': 'Copy suggestion',
        'brainstorm.copiedToClipboard': 'Suggestion copied to clipboard!',
      };
      return mockTranslations[key] || key;
    }
  })
}));

// Mock the LightBulbIcon component
jest.mock('@components/Icons', () => ({
  LightBulbIcon: ({ className, ...props }: any) => (
    <svg data-testid="lightbulb-icon" className={className} {...props}>
      <path d="test-lightbulb-path" />
    </svg>
  )
}));

// Mock the service layer to avoid actual API calls
jest.mock('@/services/brainstorm.service', () => ({
  generateBrainstormSuggestion: jest.fn(),
}));

import { generateBrainstormSuggestion } from '@/services/brainstorm.service';

// Import the actual component after mocking dependencies
import BrainstormModule from '@/components/sermon/BrainstormModule';

// Type the mocked function
const mockGenerateBrainstormSuggestion = generateBrainstormSuggestion as jest.MockedFunction<typeof generateBrainstormSuggestion>;

// Test data
const mockSermonId = 'test-sermon-123';

const mockBrainstormSuggestion: BrainstormSuggestion = {
  id: 'bs-test-123',
  text: 'Consider exploring the historical context of this passage and how it might have sounded to the original audience.',
  type: 'context'
};

describe('BrainstormModule', () => {
  beforeEach(() => {
    fetchMock.resetMocks();
    jest.clearAllMocks();
    // Set up default environment variable for API base
    process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:3000';
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Initial Render', () => {
    it('renders with correct initial state', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);

      // Check header elements - use getAllByTestId to handle multiple icons
      const icons = screen.getAllByTestId('lightbulb-icon');
      expect(icons).toHaveLength(3); // Header, button, and empty state icon
      expect(screen.getByText('Ideas')).toBeInTheDocument();
      
      // Check generate button
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toBeInTheDocument();
      expect(generateButton).toBeEnabled();
      expect(generateButton).toHaveTextContent('Generate');
      
      // Check placeholder text
      expect(screen.getByText('Click \'Generate\' to get a thinking prompt')).toBeInTheDocument();
      
      // Should not show suggestion initially
      expect(screen.queryByText(/consider exploring/i)).not.toBeInTheDocument();
    });

    it('applies custom className when provided', () => {
      const customClass = 'custom-test-class';
      const { container } = render(
        <BrainstormModule sermonId={mockSermonId} className={customClass} />
      );
      
      const moduleElement = container.firstChild as HTMLElement;
      expect(moduleElement).toHaveClass(customClass);
    });

    it('has correct ARIA attributes', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toHaveAttribute('aria-label', 'Generate');
    });
  });

  describe('API Integration', () => {
    it('successfully generates and displays a brainstorm suggestion', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Check loading state
      expect(generateButton).toHaveTextContent('...');
      expect(generateButton).toBeDisabled();

      // Wait for API call to complete
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Verify service call was made correctly
      expect(mockGenerateBrainstormSuggestion).toHaveBeenCalledTimes(1);
      expect(mockGenerateBrainstormSuggestion).toHaveBeenCalledWith(mockSermonId);

      // Check suggestion is displayed correctly
      expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      expect(screen.getByText('Context')).toBeInTheDocument(); // Type badge
      
      // Check button returns to normal state
      expect(generateButton).toHaveTextContent('Generate');
      expect(generateButton).toBeEnabled();
      
      // Check "Another" button appears
      expect(screen.getByText('Another')).toBeInTheDocument();
      
      // Placeholder should be hidden
      expect(screen.queryByText('Click \'Generate\' to get a thinking prompt')).not.toBeInTheDocument();
    });

    it('handles API error responses gracefully', async () => {
      const error = new Error('Failed to generate brainstorm suggestion');
      mockGenerateBrainstormSuggestion.mockRejectedValue(error);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Wait for error handling
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to generate suggestion. Please try again.'
        );
      });

      // Button should return to normal state
      expect(generateButton).toHaveTextContent('Generate');
      expect(generateButton).toBeEnabled();
      
      // Should still show placeholder
      expect(screen.getByText('Click \'Generate\' to get a thinking prompt')).toBeInTheDocument();
    });

    it('handles network errors gracefully', async () => {
      const error = new Error('Network error');
      mockGenerateBrainstormSuggestion.mockRejectedValue(error);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Wait for error handling
      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to generate suggestion. Please try again.'
        );
      });

      // Button should return to normal state
      expect(generateButton).toHaveTextContent('Generate');
      expect(generateButton).toBeEnabled();
    });
  });

  describe('User Interactions', () => {
    beforeEach(async () => {
      // Set up initial suggestion for interaction tests
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
      
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
      
      jest.clearAllMocks();
    });

    it('generates new suggestion when "Another" button is clicked', async () => {
      const newSuggestion: BrainstormSuggestion = {
        id: 'bs-test-456',
        text: 'What questions might this passage raise for modern readers?',
        type: 'question'
      };
      
      mockGenerateBrainstormSuggestion.mockResolvedValue(newSuggestion);

      const anotherButton = screen.getByText('Another');
      fireEvent.click(anotherButton);

      // Check loading state
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /generate/i })).toHaveTextContent('...');
      });

      // Wait for new suggestion
      await waitFor(() => {
        expect(screen.getByText(newSuggestion.text)).toBeInTheDocument();
      });

      // Verify old suggestion is replaced
      expect(screen.queryByText(mockBrainstormSuggestion.text)).not.toBeInTheDocument();
      
      // Check new type badge
      expect(screen.getByText('Question')).toBeInTheDocument();
    });

    it('prevents multiple simultaneous requests', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      
      // Click multiple times rapidly
      fireEvent.click(generateButton);
      fireEvent.click(generateButton);
      fireEvent.click(generateButton);

      // Should only make one service call
      await waitFor(() => {
        expect(mockGenerateBrainstormSuggestion).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('Suggestion Types', () => {
    const suggestionTypes: Array<{ type: BrainstormSuggestion['type'], expectedLabel: string }> = [
      { type: 'text', expectedLabel: 'Reading' },
      { type: 'question', expectedLabel: 'Question' },
      { type: 'context', expectedLabel: 'Context' },
      { type: 'reflection', expectedLabel: 'Reflection' },
      { type: 'relationship', expectedLabel: 'Relationships' },
      { type: 'application', expectedLabel: 'Application' },
    ];

    suggestionTypes.forEach(({ type, expectedLabel }) => {
      it(`correctly displays ${type} suggestion type`, async () => {
        const suggestion: BrainstormSuggestion = {
          id: `bs-${type}-test`,
          text: `Test ${type} suggestion`,
          type
        };

        mockGenerateBrainstormSuggestion.mockResolvedValue(suggestion);

        render(<BrainstormModule sermonId={mockSermonId} />);
        
        const generateButton = screen.getByRole('button', { name: /generate/i });
        fireEvent.click(generateButton);

        await waitFor(() => {
          expect(screen.getByText(suggestion.text)).toBeInTheDocument();
          expect(screen.getByText(expectedLabel)).toBeInTheDocument();
        });
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading state during API call', async () => {
      // Create a promise that we control
      let resolvePromise: (value: BrainstormSuggestion) => void;
      const promise = new Promise<BrainstormSuggestion>((resolve) => {
        resolvePromise = resolve;
      });
      
      mockGenerateBrainstormSuggestion.mockReturnValue(promise);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Check immediate loading state
      expect(generateButton).toHaveTextContent('...');
      expect(generateButton).toBeDisabled();
      
      // Resolve the promise
      resolvePromise!(mockBrainstormSuggestion);
      
      // Wait for completion
      await waitFor(() => {
        expect(generateButton).toHaveTextContent('Generate');
        expect(generateButton).toBeEnabled();
      });
    });

    it('disables "Another" button during loading', async () => {
      // First, set up a suggestion
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
      
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      let generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
      
      jest.clearAllMocks();
      
      // Create controlled promise for second request
      let resolvePromise: (value: BrainstormSuggestion) => void;
      const promise = new Promise<BrainstormSuggestion>((resolve) => {
        resolvePromise = resolve;
      });
      
      mockGenerateBrainstormSuggestion.mockReturnValue(promise);
      
      // Click "Another" button
      const anotherButton = screen.getByText('Another');
      fireEvent.click(anotherButton);
      
      // Check that "Another" button is disabled during loading
      expect(anotherButton).toHaveTextContent('Another');
      expect(anotherButton).toBeDisabled();
      
      // Resolve and verify
      resolvePromise!(mockBrainstormSuggestion);
      
      await waitFor(() => {
        expect(anotherButton).toBeEnabled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles service layer errors gracefully', async () => {
      const error = new Error('Service error');
      mockGenerateBrainstormSuggestion.mockRejectedValue(error);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          'Failed to generate suggestion. Please try again.'
        );
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toHaveAttribute('aria-label', 'Generate');
    });

    it('maintains proper focus management', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      generateButton.focus();
      
      expect(document.activeElement).toBe(generateButton);
      
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Focus should remain on the button after operation
      expect(document.activeElement).toBe(generateButton);
    });

    it('provides clear visual indicators for different states', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      
      // Initial state - button should be enabled
      expect(generateButton).toBeEnabled();
      expect(generateButton).not.toHaveClass('opacity-50', 'cursor-not-allowed');
    });
  });

  describe('Component Styling', () => {
    it('applies correct CSS classes', () => {
      const { container } = render(<BrainstormModule sermonId={mockSermonId} />);
      
      const moduleElement = container.firstChild as HTMLElement;
      expect(moduleElement).toHaveClass(
        'p-6', 'rounded-xl', 'shadow-sm', 'transition-shadow', 'hover:shadow-md'
      );
    });

    it('applies correct icon styling', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const icons = screen.getAllByTestId('lightbulb-icon');
      
      // Header icon
      expect(icons[0]).toHaveClass('w-6', 'h-6', 'text-yellow-500', 'dark:text-yellow-400');
      
      // Button icon
      expect(icons[1]).toHaveClass('w-5', 'h-5');
    });

    it('displays suggestion with correct styling', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Check suggestion container styling
      const suggestionText = screen.getByText(mockBrainstormSuggestion.text);
      const suggestionContainer = suggestionText.parentElement;
      
      expect(suggestionContainer).toHaveClass(
        'p-4', 'bg-yellow-50', 'dark:bg-yellow-900/10', 'rounded-lg', 'border', 'border-yellow-200', 'dark:border-yellow-700'
      );
    });
  });
}); 