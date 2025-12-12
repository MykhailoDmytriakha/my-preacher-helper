import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import SermonPointSelector from '@components/SermonPointSelector';
import { runScenarios } from '@test-utils/scenarioRunner';

import type { Thought, SermonOutline } from '@/models/models';

// Mock the translation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => {
      const translations: Record<string, string> = {
        'tags.introduction': 'Introduction',
        'tags.mainPart': 'Main Part',
        'tags.conclusion': 'Conclusion',
        'editThought.noSermonPoint': 'No outline point selected',
        'editThought.noSermonPointAssigned': 'SermonOutline point not assigned',
        'editThought.selectSermonPoint': 'Select outline point',
        'outline.introduction': 'Introduction',
        'outline.mainPoints': 'Main Points',
        'outline.conclusion': 'Conclusion',
      };
      return translations[key] || defaultValue || key;
    },
  }),
}));

describe('SermonPointSelector', () => {
  const mockOutline: SermonOutline = {
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

  const mockOnSermonPointChange = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering', () => {
    it('covers rendering permutations with scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'hidden without outline data',
            run: () => {
              const { container } = render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={undefined}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(container.firstChild).toBeNull();
            }
          },
          {
            name: 'hidden when outline arrays empty',
            run: () => {
              const emptyOutline: SermonOutline = { introduction: [], main: [], conclusion: [] };
              const { container } = render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={emptyOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(container.firstChild).toBeNull();
            }
          },
          {
            name: 'shows unassigned label when no outline point',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText('SermonOutline point not assigned')).toBeInTheDocument();
            }
          },
          {
            name: 'renders assigned outline data',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText(/Main Part:/)).toBeInTheDocument();
              expect(screen.getByText(/First main point/)).toBeInTheDocument();
            }
          },
          {
            name: 'supports introduction outline selections',
            run: () => {
              const thoughtWithIntro: Thought = {
                ...mockThoughtWithoutOutline,
                outlinePointId: 'intro-1',
                tags: ['Вступление']
              };
              render(
                <SermonPointSelector
                  thought={thoughtWithIntro}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText(/Introduction:/)).toBeInTheDocument();
            }
          },
          {
            name: 'supports conclusion outline selections',
            run: () => {
              const thoughtWithConclusion: Thought = {
                ...mockThoughtWithoutOutline,
                outlinePointId: 'concl-1',
                tags: ['Заключение']
              };
              render(
                <SermonPointSelector
                  thought={thoughtWithConclusion}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText(/Conclusion:/)).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Dropdown Interaction', () => {
    it('covers menu toggling behaviors via scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'opens list when trigger clicked',
            run: async () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => expect(screen.getByText('Select outline point')).toBeInTheDocument());
            }
          },
          {
            name: 'closes when clicking outside the menu',
            run: async () => {
              render(
                <div>
                  <SermonPointSelector
                    thought={mockThoughtWithoutOutline}
                    sermonOutline={mockOutline}
                    onSermonPointChange={mockOnSermonPointChange}
                  />
                  <div data-testid="outside">Outside element</div>
                </div>
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => expect(screen.getByText('Select outline point')).toBeInTheDocument());
              fireEvent.mouseDown(screen.getByTestId('outside'));
              await waitFor(() => expect(screen.queryByText('Select outline point')).toBeNull());
            }
          },
          {
            name: 'rotates chevron to indicate open state',
            run: async () => {
              const { container } = render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              const button = screen.getByText('SermonOutline point not assigned').closest('button');
              const chevron = container.querySelector('svg');
              fireEvent.click(button!);
              await waitFor(() => expect(chevron).toHaveClass('rotate-180'));
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('SermonOutline Point Selection', () => {
    it('covers selection flows without multiple tests', async () => {
      await runScenarios(
        [
          {
            name: 'selecting an outline triggers callback',
            run: async () => {
              mockOnSermonPointChange.mockResolvedValue(undefined);
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('First main point'));
              fireEvent.click(screen.getByText('First main point'));
              await waitFor(() => expect(mockOnSermonPointChange).toHaveBeenCalledWith('main-1'));
            }
          },
          {
            name: 'removing outline resets value',
            run: async () => {
              mockOnSermonPointChange.mockResolvedValue(undefined);
              render(
                <SermonPointSelector
                  thought={mockThoughtWithOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText(/First main point/));
              await waitFor(() => screen.getByText('No outline point selected'));
              fireEvent.click(screen.getByText('No outline point selected'));
              await waitFor(() => expect(mockOnSermonPointChange).toHaveBeenCalledWith(undefined));
            }
          },
          {
            name: 'dropdown closes after selection',
            run: async () => {
              mockOnSermonPointChange.mockResolvedValue(undefined);
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('First main point'));
              fireEvent.click(screen.getByText('First main point'));
              await waitFor(() => expect(screen.queryByText('Select outline point')).toBeNull());
            }
          },
          {
            name: 'logs errors when update fails',
            run: async () => {
              const consoleError = jest.spyOn(console, 'error').mockImplementation();
              mockOnSermonPointChange.mockRejectedValue(new Error('Update failed'));
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('First main point'));
              fireEvent.click(screen.getByText('First main point'));
              await waitFor(() =>
                expect(consoleError).toHaveBeenCalledWith(
                  'Failed to update outline point:',
                  expect.any(Error)
                )
              );
              consoleError.mockRestore();
            }
          }
        ],
        {
          beforeEachScenario: () => {
            jest.clearAllMocks();
          },
          afterEachScenario: cleanup
        }
      );
    });
  });

  describe('Section Filtering', () => {
    it('filters sections according to tags in one place', async () => {
      await runScenarios(
        [
          {
            name: 'main-tag thoughts only see main points',
            run: async () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('Main Points'));
              expect(screen.queryByText('Opening statement')).toBeNull();
            }
          },
          {
            name: 'intro tags restrict to introduction points',
            run: async () => {
              const introThought: Thought = { ...mockThoughtWithoutOutline, tags: ['Вступление'] };
              render(
                <SermonPointSelector
                  thought={introThought}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('Introduction'));
              expect(screen.queryByText('First main point')).toBeNull();
            }
          },
          {
            name: 'conclusion tags restrict to conclusion points',
            run: async () => {
              const conclusionThought: Thought = { ...mockThoughtWithoutOutline, tags: ['Заключение'] };
              render(
                <SermonPointSelector
                  thought={conclusionThought}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('Conclusion'));
              expect(screen.queryByText('First main point')).toBeNull();
            }
          },
          {
            name: 'custom tags show all sections',
            run: async () => {
              const noSectionThought: Thought = { ...mockThoughtWithoutOutline, tags: ['custom-tag'] };
              render(
                <SermonPointSelector
                  thought={noSectionThought}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('Conclusion'));
            }
          },
          {
            name: 'multiple section tags still show all groups',
            run: async () => {
              const multiSectionThought: Thought = {
                ...mockThoughtWithoutOutline,
                tags: ['Вступление', 'Основная часть']
              };
              render(
                <SermonPointSelector
                  thought={multiSectionThought}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('Conclusion'));
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Disabled State', () => {
    it('covers disabled mode behavior with scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'button element becomes disabled',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                  disabled={true}
                />
              );
              expect(screen.getByText('SermonOutline point not assigned').closest('button')).toBeDisabled();
            }
          },
          {
            name: 'dropdown cannot be opened',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                  disabled={true}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              expect(screen.queryByText('Select outline point')).toBeNull();
            }
          },
          {
            name: 'disabled styling cues rendered',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                  disabled={true}
                />
              );
              const button = screen.getByText('SermonOutline point not assigned').closest('button');
              expect(button).toHaveClass('disabled:opacity-50');
              expect(button).toHaveClass('disabled:cursor-not-allowed');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Visual States', () => {
    it('validates hover/selection visuals via scenarios', async () => {
      await runScenarios(
        [
          {
            name: 'selected outline point gets highlight classes',
            run: async () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText(/First main point/));
              await waitFor(() =>
                expect(screen.getByText('First main point').closest('button')).toHaveClass('bg-blue-50')
              );
            }
          },
          {
            name: 'non-selected options expose hover styling',
            run: async () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText(/First main point/));
              await waitFor(() =>
                expect(screen.getByText('Second main point').closest('button')).toHaveClass('hover:bg-gray-100')
              );
            }
          },
          {
            name: 'unassigned state shows dashed border',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText('SermonOutline point not assigned').closest('button')).toHaveClass('border-dashed');
            }
          },
          {
            name: 'assigned state uses solid border',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              const button = screen.getByText(/First main point/).closest('button');
              expect(button).toHaveClass('border');
              expect(button).not.toHaveClass('border-dashed');
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('groups accessibility checks into one test', async () => {
      await runScenarios(
        [
          {
            name: 'button element exposed to assistive tech',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByRole('button')).toBeInTheDocument();
            }
          },
          {
            name: 'keyboard focus works on trigger',
            run: () => {
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              const button = screen.getByText('SermonOutline point not assigned').closest('button');
              button?.focus();
              expect(document.activeElement).toBe(button);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles miscellaneous scenarios collectively', async () => {
      await runScenarios(
        [
          {
            name: 'renders gracefully with partial outline',
            run: () => {
              const partialOutline: SermonOutline = {
                introduction: [],
                main: [{ id: 'main-1', text: 'Only main point' }],
                conclusion: []
              };
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={partialOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText('SermonOutline point not assigned')).toBeInTheDocument();
            }
          },
          {
            name: 'handles invalid outlinePointId on thought',
            run: () => {
              const thoughtWithInvalidId: Thought = { ...mockThoughtWithoutOutline, outlinePointId: 'invalid-id' };
              render(
                <SermonPointSelector
                  thought={thoughtWithInvalidId}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              expect(screen.getByText('SermonOutline point not assigned')).toBeInTheDocument();
            }
          },
          {
            name: 'disables controls during async update',
            run: async () => {
              let resolveUpdate: () => void;
              const updatePromise = new Promise<void>((resolve) => {
                resolveUpdate = resolve;
              });
              mockOnSermonPointChange.mockReturnValue(updatePromise);
              render(
                <SermonPointSelector
                  thought={mockThoughtWithoutOutline}
                  sermonOutline={mockOutline}
                  onSermonPointChange={mockOnSermonPointChange}
                />
              );
              fireEvent.click(screen.getByText('SermonOutline point not assigned'));
              await waitFor(() => screen.getByText('First main point'));
              fireEvent.click(screen.getByText('First main point'));
              await waitFor(() => {
                screen.getAllByRole('button').forEach((btn) => {
                  if (btn.textContent?.includes('point')) {
                    expect(btn).toBeDisabled();
                  }
                });
              });
              resolveUpdate!();
            }
          }
        ],
        {
          beforeEachScenario: () => jest.clearAllMocks(),
          afterEachScenario: cleanup
        }
      );
    });
  });
});
