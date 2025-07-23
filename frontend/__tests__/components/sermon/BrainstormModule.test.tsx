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

// Helper function to expand the brainstorm module
const expandBrainstormModule = async () => {
  const expandButton = screen.getByRole('button', { name: /ideas/i });
  fireEvent.click(expandButton);
  
  // Wait for the expansion animation
  await waitFor(() => {
    expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
  });
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
    it('renders with correct initial collapsed state', () => {
      render(<BrainstormModule sermonId={mockSermonId} />);

      // Check that the trigger button is visible
      const expandButton = screen.getByRole('button', { name: /ideas/i });
      expect(expandButton).toBeInTheDocument();
      expect(screen.getByText('Ideas')).toBeInTheDocument();
      expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
      
      // Check that the generate button is NOT visible (module is collapsed)
      expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
      
      // Should not show suggestion initially
      expect(screen.queryByText(/consider exploring/i)).not.toBeInTheDocument();
    });

    it('expands when trigger button is clicked', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);

      await expandBrainstormModule();
      
      // Check that expanded content is now visible
      expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
      expect(screen.getByText('Click \'Generate\' to get a thinking prompt')).toBeInTheDocument();
      
      // Check close button is present
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
    });

    it('collapses when close button is clicked', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);

      await expandBrainstormModule();
      
      // Verify expanded state
      expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
      
      // Click the close button
      const closeButton = screen.getByRole('button', { name: /close/i });
      fireEvent.click(closeButton);
      
      // Wait for collapse - the generate button should disappear
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /generate/i })).not.toBeInTheDocument();
      });
      
      // Note: Testing the reappearance of the trigger button is skipped due to 
      // Framer Motion animation complexities in the JSDOM test environment.
      // The core functionality (collapse behavior) is verified above.
    });

    it('applies custom className when provided', () => {
      const customClass = 'custom-test-class';
      const { container } = render(
        <BrainstormModule sermonId={mockSermonId} className={customClass} />
      );
      
      const moduleElement = container.firstChild as HTMLElement;
      expect(moduleElement).toHaveClass(customClass);
    });

    it('has correct ARIA attributes', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toHaveAttribute('aria-label', 'Generate');
    });
  });

  describe('API Integration', () => {
    it('successfully generates and displays a brainstorm suggestion', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
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

      // Check that button text changes to "Generate Another"
      expect(generateButton).toHaveTextContent('Generate Another');
      expect(generateButton).toBeEnabled();

      // Check suggestion type display
      expect(screen.getByText('Context')).toBeInTheDocument();
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
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      
      // First generation
      fireEvent.click(generateButton);
      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Second generation
      fireEvent.click(generateButton);
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
    beforeEach(async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      await expandBrainstormModule();
    });

    it('correctly displays context suggestion type', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue({
        ...mockBrainstormSuggestion,
        type: 'context'
      });

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

      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText('Application')).toBeInTheDocument();
      });
    });
  });

  describe('Loading States', () => {
    it('shows loading state during API call', async () => {
      // Create a promise that won't resolve immediately
      let resolvePromise: (value: BrainstormSuggestion) => void;
      const pendingPromise = new Promise<BrainstormSuggestion>((resolve) => {
        resolvePromise = resolve;
      });
      
      mockGenerateBrainstormSuggestion.mockReturnValue(pendingPromise);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      // Check immediate loading state
      expect(generateButton).toHaveTextContent('...');
      expect(generateButton).toBeDisabled();

      // Resolve the promise
      resolvePromise!(mockBrainstormSuggestion);
      
      // Wait for loading to complete
      await waitFor(() => {
        expect(generateButton).toBeEnabled();
      });
    });

    it('disables "Another" button during loading', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
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

      // Click "Generate Another"
      generateButton = screen.getByRole('button', { name: /generate another/i });
      fireEvent.click(generateButton);

      // Both "Generate Another" buttons should be disabled during loading
      const anotherButtons = screen.getAllByText(/another/i);
      anotherButtons.forEach(button => {
        if (button.closest('button')) {
          expect(button.closest('button')).toBeDisabled();
        }
      });

      // Resolve the second promise
      resolveSecondPromise!(mockBrainstormSuggestion);
      
      await waitFor(() => {
        const enabledGenerateButton = screen.getByRole('button', { name: /generate another/i });
        expect(enabledGenerateButton).toBeEnabled();
      });
    });
  });

  describe('Edge Cases', () => {
    it('handles service layer errors gracefully', async () => {
      const errorMessage = 'Network error occurred';
      mockGenerateBrainstormSuggestion.mockRejectedValue(new Error(errorMessage));

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to generate suggestion. Please try again.');
      });

      // Button should be re-enabled after error
      expect(generateButton).toBeEnabled();
    });

    it('handles missing suggestion gracefully', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(null as any);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(generateButton).toBeEnabled();
      });
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA labels', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      expect(generateButton).toHaveAttribute('aria-label', 'Generate');
    });

    it('maintains proper focus management', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      generateButton.focus();
      
      expect(document.activeElement).toBe(generateButton);
    });

    it('provides clear visual indicators for different states', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      
      // Initial state - button should be enabled
      expect(generateButton).toBeEnabled();
      
      fireEvent.click(generateButton);
      
      // Loading state
      expect(generateButton).toBeDisabled();
      
      // Wait for completion
      await waitFor(() => {
        expect(generateButton).toBeEnabled();
      });
    });
  });

  describe('Component Styling', () => {
    it('applies correct CSS classes', () => {
      const { container } = render(<BrainstormModule sermonId={mockSermonId} />);
      
      const moduleElement = container.firstChild as HTMLElement;
      expect(moduleElement).toHaveClass('relative');
    });

    it('applies correct icon styling', async () => {
      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      // Check icons have correct classes
      const icons = screen.getAllByTestId('lightbulb-icon');
      expect(icons.length).toBeGreaterThanOrEqual(2);
      
      // The generate button icon should have w-4 h-4 classes
      const generateButton = screen.getByRole('button', { name: /generate/i });
      const buttonIcon = generateButton.querySelector('[data-testid="lightbulb-icon"]');
      expect(buttonIcon).toHaveClass('w-4', 'h-4');
    });

    it('displays suggestion with correct styling', async () => {
      mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);

      render(<BrainstormModule sermonId={mockSermonId} />);
      
      await expandBrainstormModule();
      
      const generateButton = screen.getByRole('button', { name: /generate/i });
      fireEvent.click(generateButton);

      await waitFor(() => {
        expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument();
      });

      // Check suggestion container styling
      const suggestionText = screen.getByText(mockBrainstormSuggestion.text);
      const suggestionContainer = suggestionText.closest('.p-4');
      expect(suggestionContainer).toHaveClass('bg-yellow-50', 'rounded-lg', 'border');
    });
  });
}); 