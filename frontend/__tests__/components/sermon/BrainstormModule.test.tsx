import React from 'react';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import fetchMock from 'jest-fetch-mock';
import { toast } from 'sonner';
import { BrainstormSuggestion } from '@/models/models';
import { runScenarios } from '@test-utils/scenarioRunner';

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

const resetScenarioState = () => {
  fetchMock.resetMocks();
  jest.clearAllMocks();
  process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:3000';
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
    it('covers initial rendering scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'renders initial trigger button and text',
            run: () => {
              render(<BrainstormModule sermonId={mockSermonId} />);
              expect(screen.getByRole('button', { name: /generate/i })).toBeInTheDocument();
              expect(screen.getByText('Ideas')).toBeInTheDocument();
            }
          },
          {
            name: 'shows suggestion after generation',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
              expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
            }
          },
          {
            name: 'returns to trigger after closing card',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
              fireEvent.click(screen.getByRole('button', { name: /close/i }));
              await waitFor(() => expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument());
            }
          },
          {
            name: 'applies custom className prop',
            run: () => {
              const { container } = render(<BrainstormModule sermonId={mockSermonId} className="custom-test-class" />);
              expect(container.firstChild).toHaveClass('custom-test-class');
            }
          },
          {
            name: 'button exposes aria-label',
            run: () => {
              render(<BrainstormModule sermonId={mockSermonId} />);
              expect(screen.getByRole('button', { name: /generate/i })).toHaveAttribute('aria-label');
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('API Integration', () => {
    it('handles service interactions', async () => {
      await runScenarios(
        [
          {
            name: 'generates and displays suggestion',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              const generateButton = screen.getByRole('button', { name: /generate/i });
              fireEvent.click(generateButton);
              expect(generateButton).toBeDisabled();
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
              expect(mockGenerateBrainstormSuggestion).toHaveBeenCalledWith(mockSermonId);
              expect(screen.getByText('Another')).toBeInTheDocument();
            }
          },
          {
            name: 'requests multiple suggestions sequentially',
            run: async () => {
              const secondSuggestion: BrainstormSuggestion = {
                id: 'bs-test-456',
                text: 'Think about how this passage connects to other biblical themes.',
                type: 'reflection'
              };
              mockGenerateBrainstormSuggestion
                .mockResolvedValueOnce(mockBrainstormSuggestion)
                .mockResolvedValueOnce(secondSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
              fireEvent.click(screen.getByText('Another').closest('button')!);
              await waitFor(() => screen.getByText(secondSuggestion.text));
              expect(screen.queryByText(mockBrainstormSuggestion.text)).not.toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Suggestion Types', () => {
    it('maps each suggestion type label correctly', async () => {
      const typeCases: Array<{ type: BrainstormSuggestion['type']; label: string }> = [
        { type: 'context', label: 'Context' },
        { type: 'question', label: 'Question' },
        { type: 'reflection', label: 'Reflection' },
        { type: 'relationship', label: 'Relationships' },
        { type: 'application', label: 'Application' }
      ];

      await runScenarios(
        typeCases.map(({ type, label }) => ({
          name: `${type} label`,
          run: async () => {
            mockGenerateBrainstormSuggestion.mockResolvedValue({ ...mockBrainstormSuggestion, type });
            render(<BrainstormModule sermonId={mockSermonId} />);
            fireEvent.click(screen.getByRole('button', { name: /generate/i }));
            await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
          }
        })),
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Loading States', () => {
    it('reflects loading indicators', async () => {
      await runScenarios(
        [
          {
            name: 'initial generate button shows spinner',
            run: async () => {
              let resolvePromise: (value: BrainstormSuggestion) => void;
              const pendingPromise = new Promise<BrainstormSuggestion>((resolve) => {
                resolvePromise = resolve;
              });
              mockGenerateBrainstormSuggestion.mockReturnValue(pendingPromise);
              render(<BrainstormModule sermonId={mockSermonId} />);
              const generateButton = screen.getByRole('button', { name: /generate/i });
              fireEvent.click(generateButton);
              expect(generateButton).toHaveTextContent('...');
              resolvePromise!(mockBrainstormSuggestion);
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
            }
          },
          {
            name: 'another button disables during second request',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
              let resolveSecondPromise: (value: BrainstormSuggestion) => void;
              const secondPendingPromise = new Promise<BrainstormSuggestion>((resolve) => {
                resolveSecondPromise = resolve;
              });
              mockGenerateBrainstormSuggestion.mockReturnValue(secondPendingPromise as any);
              const anotherButton = screen.getByText('Another').closest('button')!;
              fireEvent.click(anotherButton);
              await waitFor(() => expect(anotherButton).toBeDisabled());
              resolveSecondPromise!(mockBrainstormSuggestion);
              await waitFor(() => expect(screen.getByText(mockBrainstormSuggestion.text)).toBeInTheDocument());
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('covers error edge cases', async () => {
      await runScenarios(
        [
          {
            name: 'handles service errors',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockRejectedValue(new Error('Network error occurred'));
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() =>
                expect(toast.error).toHaveBeenCalledWith('Failed to generate suggestion. Please try again.')
              );
            }
          },
          {
            name: 'handles null suggestion responses',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(null as any);
              render(<BrainstormModule sermonId={mockSermonId} />);
              const generateButton = screen.getByRole('button', { name: /generate/i });
              fireEvent.click(generateButton);
              await waitFor(() => expect(generateButton).toBeEnabled());
              expect(screen.getByText('Get unstuck with thinking prompts')).toBeInTheDocument();
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('meets accessibility cues', async () => {
      await runScenarios(
        [
          {
            name: 'button exposes aria label',
            run: () => {
              render(<BrainstormModule sermonId={mockSermonId} />);
              expect(screen.getByRole('button', { name: /generate/i })).toHaveAttribute('aria-label');
            }
          },
          {
            name: 'focus stays on trigger when requested',
            run: () => {
              render(<BrainstormModule sermonId={mockSermonId} />);
              const generateButton = screen.getByRole('button', { name: /generate/i });
              generateButton.focus();
              expect(document.activeElement).toBe(generateButton);
            }
          },
          {
            name: 'visual states toggle with async flow',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              const generateButton = screen.getByRole('button', { name: /generate/i });
              fireEvent.click(generateButton);
              expect(generateButton).toBeDisabled();
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Enhanced Suggestion Features', () => {
    it('handles varied suggestion payloads', async () => {
      await runScenarios(
        [
          {
            name: 'complex suggestions render text and type',
            run: async () => {
              const enhancedSuggestion: BrainstormSuggestion = {
                ...mockBrainstormSuggestion,
                type: 'multi-perspective',
                complexity: 'multi-dimensional',
                dimensions: ['textual-analysis']
              };
              mockGenerateBrainstormSuggestion.mockResolvedValue(enhancedSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(enhancedSuggestion.text));
              expect(screen.getByText('brainstorm.types.multi-perspective')).toBeInTheDocument();
            }
          },
          {
            name: 'basic suggestions still show labels',
            run: async () => {
              const basicSuggestion: BrainstormSuggestion = {
                id: 'bs-basic-123',
                text: 'Basic suggestion without enhanced features',
                type: 'question'
              };
              mockGenerateBrainstormSuggestion.mockResolvedValue(basicSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText('Question'));
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('Component Styling', () => {
    it('checks styling cues quickly', async () => {
      await runScenarios(
        [
          {
            name: 'root container uses base classes',
            run: () => {
              const { container } = render(<BrainstormModule sermonId={mockSermonId} />);
              expect(container.firstChild).toHaveClass('relative');
            }
          },
          {
            name: 'trigger icon has expected sizing',
            run: () => {
              render(<BrainstormModule sermonId={mockSermonId} />);
              const icon = screen
                .getByRole('button', { name: /generate/i })
                .querySelector('[data-testid="lightbulb-icon"]');
              expect(icon).toHaveClass('w-6', 'h-6');
            }
          },
          {
            name: 'suggestion text displays after generation',
            run: async () => {
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(<BrainstormModule sermonId={mockSermonId} />);
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => screen.getByText(mockBrainstormSuggestion.text));
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });

  describe('External State Management', () => {
    it('syncs with controlled suggestion props', async () => {
      await runScenarios(
        [
          {
            name: 'renders external suggestion immediately',
            run: () => {
              const externalSuggestion: BrainstormSuggestion = {
                id: 'external-123',
                text: 'External suggestion text',
                type: 'context'
              };
              render(
                <BrainstormModule
                  sermonId={mockSermonId}
                  currentSuggestion={externalSuggestion}
                  onSuggestionChange={jest.fn()}
                />
              );
              expect(screen.getByText(externalSuggestion.text)).toBeInTheDocument();
            }
          },
          {
            name: 'notifies parent when generating new suggestion',
            run: async () => {
              const onSuggestionChange = jest.fn();
              mockGenerateBrainstormSuggestion.mockResolvedValue(mockBrainstormSuggestion);
              render(
                <BrainstormModule
                  sermonId={mockSermonId}
                  currentSuggestion={null}
                  onSuggestionChange={onSuggestionChange}
                />
              );
              fireEvent.click(screen.getByRole('button', { name: /generate/i }));
              await waitFor(() => expect(onSuggestionChange).toHaveBeenCalledWith(mockBrainstormSuggestion));
            }
          },
          {
            name: 'clears suggestion when closing card',
            run: () => {
              const onSuggestionChange = jest.fn();
              render(
                <BrainstormModule
                  sermonId={mockSermonId}
                  currentSuggestion={mockBrainstormSuggestion}
                  onSuggestionChange={onSuggestionChange}
                />
              );
              fireEvent.click(screen.getByRole('button', { name: /close/i }));
              expect(onSuggestionChange).toHaveBeenCalledWith(null);
            }
          }
        ],
        { beforeEachScenario: resetScenarioState, afterEachScenario: cleanup }
      );
    });
  });
}); 
