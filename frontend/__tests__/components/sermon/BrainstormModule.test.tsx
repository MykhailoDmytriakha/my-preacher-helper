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
        'brainstorm.subtitle': 'Get unstuck with thinking prompts',
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
        'actions.close': 'Close',
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

// Helper function - no longer needed with new single-state design
// Keeping for backwards compatibility but it's now a no-op
const expandBrainstormModule = async () => {
  // New design doesn't have expand/collapse - the generate button is always visible when there's no suggestion
  // This function is kept to avoid breaking existing tests
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
    it('renders with correct initial state showing trigger button', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);

      // New design: trigger button is visible from the start
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toBeInTheDocument();
      expect(screen.getByText('Ideas')).toBeInTheDocument();
      expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
    });

    it('shows suggestion card after generating', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
      
      render(<BrainstormModule sermonId={mockSermonId} />);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
      
      // Close button should be present in suggestion card
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      
      // Original trigger button should not be visible
      expect(screen.queryByText('Get unstuck with thinking prompts')).not.toBeInTheDocument();
    });

    it('returns to trigger state when close button is clicked', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
      
      render(<BrainstormModule sermonId={mockSermonId} />);

      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
      
      // Click the close button
      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);
      
      // Should return to trigger state
      await waitFor(() => {
        expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
      });
      
      expect(screen.queryByText(mockBrainstormSuggestion.text)).not.toBeInTheDocument();
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
      expect(generateButton).toHaveAttribute('aria-label');
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

      // Check suggestion type display
      expect(screen.getByText('Context')).toBeInTheDocument();
      
      // Check that "Another" button is present in the suggestion card
      expect(screen.getByText('Another')).toBeInTheDocument();
    });

    it('generates multiple suggestions when requested', async () => {
      const secondSuggestion: BrainstormSuggestion = {
        id: 'bs-test-456',
        text: 'Think about how this passage connects to other biblical themes.',
        type: 'reflection'
      };

      mockGenerateBrainstormSuggestion
        .mockResolvedValueOnce(mockBrainstormSuggestion)
        .mockResolvedValueOnce(secondSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      let generateButton = screen.getByRole('button', { name: /generate/i });
      
      // First generation
      fireEvent.click(generateButton);
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Second generation - click the "Another" button in the suggestion card
      const anotherButton = screen.getByText('Another').closest('button')!;
      fireEvent.click(anotherButton);
      
      await waitFor(() => {
        expect(screen.getByText(secondSuggestion.text)).toBeInTheDocument();
      });

      // Should not show the first suggestion anymore
      expect(screen.queryByText(mockBrainstormSuggestion.text)).not.toBeInTheDocument();
      
      // Verify both API calls were made
      expect(mockGenerateBrainstormSuggestion).toHaveBeenCalledTimes(2);
    });
  });

  describe('Suggestion Types', () => {
    it('correctly displays context suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'context'
      });

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Context')).toBeInTheDocument();
      });
    });

    it('correctly displays question suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'question'
      });

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Question')).toBeInTheDocument();
      });
    });

    it('correctly displays reflection suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'reflection'
      });

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Reflection')).toBeInTheDocument();
      });
    });

    it('correctly displays relationship suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'relationship'
      });

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Relationships')).toBeInTheDocument();
      });
    });

    it('correctly displays application suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'application'
      });

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Application')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading state during API call', async () => {
      let resolvePromise: (value: BrainstormSuggestion) => void;
      const pendingPromise = new Promise<BrainstormSuggestion>((resolve) => {
        resolvePromise = resolve;
      });
      
      mockGenerateBrainstormSuggestion.mockReturnValue(pendingPromise);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Check immediate loading state
      expect(generateButton).toHaveTextContent('...');
      expect(generateButton).toBeDisabled();

      // Resolve the promise
      resolvePromise!(mockBrainstormSuggestion);
      
      // Wait for loading to complete and suggestion to appear
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
    });

    it('disables "Another" button during loading', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      let generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);
      
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Create another pending promise for the second request
      let resolveSecondPromise: (value: BrainstormSuggestion) => void;
      const secondPendingPromise = new Promise<BrainstormSuggestion>((resolve) => {
        resolveSecondPromise = resolve;
      });
      
      mockGenerateBrainstormSuggestion.mockReturnValue(secondPendingPromise);

      // Click "Another" button in the suggestion card
      const anotherButton = screen.getByText('Another').closest('button')!;
      fireEvent.click(anotherButton);

      // Button should be disabled during loading
      await waitFor(() => {
        expect(anotherButton).toBeDisabled();
      });

      // Resolve the second promise
      resolveSecondPromise!(mockBrainstormSuggestion);
      
      await waitFor(() => {
        const enabledAnotherButton = screen.getByText('Another').closest('button')!;
        expect(enabledAnotherButton).toBeEnabled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles service layer errors gracefully', async () => {
      const errorMessage = 'Network error occurred';
      mockGenerateBrainstormSuggestion.mockRejectedValue(new Error(errorMessage));

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to generate suggestion. Please try again.');
      });

      // Button should be re-enabled after error and still showing trigger state
      expect(generateButton).toBeEnabled();
      expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
    });

    it('handles missing suggestion gracefully', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(null as any);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(generateButton).toBeEnabled();
      });
      
      // Should remain in trigger state when suggestion is null
      expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toHaveAttribute('aria-label');
    });

    it('maintains proper focus management', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      generateButton.focus();
      
      expect(document.activeElement).toBe(generateButton);
    });

    it('provides clear visual indicators for different states', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      
      // Initial state - button should be enabled
      expect(generateButton).toBeEnabled();
      
      fireEvent.click(generateButton);
      
      // Loading state
      expect(generateButton).toBeDisabled();
      
      // Wait for completion - suggestion should appear
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });
    });
  });

  describe('Enhanced Suggestion Features', () => {
    it('handles suggestions with complexity and dimensions gracefully', async () => {
      const enhancedSuggestion: BrainstormSuggestion = {
        ...mockBrainstormSuggestion,
        type: 'multi-perspective',
        complexity: 'multi-dimensional',
        dimensions: ['textual-analysis', 'contemporary-application', 'theological-depth']
      };

      mockGenerateBrainstormSuggestion.mockResolvedValue(enhancedSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(enhancedSuggestion.text)).toBeInTheDocument();
      });

      // New design: complexity and dimensions are not displayed, only type
      expect(screen.getByText('brainstorm.types.multi-perspective')).toBeInTheDocument();
    });

    it('handles suggestions without complexity or dimensions', async () => {
      const basicSuggestion: BrainstormSuggestion = {
        id: 'bs-basic-123',
        text: 'Basic suggestion without enhanced features',
        type: 'question'
      };

      mockGenerateBrainstormSuggestion.mockResolvedValue(basicSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Question')).toBeInTheDocument();
      });
    });
  });

  describe('Component Styling', () => {
    it('applies correct CSS classes', () => {
      const { container } = render(<BrainstormModule sermonId={mockSermonId} />);
      
      const moduleElement = container.firstChild as HTMLElement;
      expect(moduleElement).toHaveClass('relative');
    });

    it('applies correct icon styling in trigger button', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      const buttonIcon = generateButton.querySelector('[data-testid="lightbulb-icon"]');
      expect(buttonIcon).toHaveClass('w-6', 'h-6');
    });

    it('displays suggestion with correct styling', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Check suggestion is visible
      const suggestionText = screen.getByText(mockBrainstormSuggestion.text);
      expect(suggestionText).toBeInTheDocument();
    });
  });

  describe('External State Management', () => {
    it('uses external state when provided', async () => {
      const externalSuggestion: BrainstormSuggestion = {
        id: 'external-123',
        text: 'External suggestion text',
        type: 'context'
      };
      const onSuggestionChange = jest.fn();

      render(
        <BrainstormModule 
          sermonId={mockSermonId}
          currentSuggestion={externalSuggestion}
          onSuggestionChange={onSuggestionChange}
        />
      );

      // Should display the external suggestion immediately
      expect(screen.getByText(externalSuggestion.text)).toBeInTheDocument();
    });

    it('calls onSuggestionChange when generating new suggestion', async () => {
      const onSuggestionChange = jest.fn();
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(
        <BrainstormModule 
          sermonId={mockSermonId}
          currentSuggestion={null}
          onSuggestionChange={onSuggestionChange}
        />
      );

      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(onSuggestionChange).toHaveBeenCalledWith(mockBrainstormSuggestion);
      });
    });

    it('calls onSuggestionChange when closing suggestion', async () => {
      const onSuggestionChange = jest.fn();

      render(
        <BrainstormModule 
          sermonId={mockSermonId}
          currentSuggestion={mockBrainstormSuggestion}
          onSuggestionChange={onSuggestionChange}
        />
      );

      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);

      expect(onSuggestionChange).toHaveBeenCalledWith(null);
    });
  });
}); 