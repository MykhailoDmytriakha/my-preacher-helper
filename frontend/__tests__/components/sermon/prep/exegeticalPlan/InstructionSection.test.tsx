import React from 'react';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { runScenarios } from '@test-utils/scenarioRunner';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.title': 'Exegetical Plan',
        'wizard.steps.exegeticalPlan.intro': 'An exegetical plan helps see the overall flow of what the text says.',
        'wizard.steps.exegeticalPlan.instruction.show': 'Show instruction',
        'wizard.steps.exegeticalPlan.instruction.hide': 'Hide instruction',
        'wizard.steps.exegeticalPlan.simpleStudy.note': 'This section explains how to compose the exegetical plan.',
        'wizard.steps.exegeticalPlan.simpleStudy.title': 'Simple study of the text structure',
        'wizard.steps.exegeticalPlan.simpleStudy.definition': 'A passage plan is a structural expression of the development of its main idea.',
        'wizard.steps.exegeticalPlan.simpleStudy.requirementsIntro': 'Each point should meet several requirements:',
        'wizard.steps.exegeticalPlan.simpleStudy.req1': 'First, it must come from the text.',
        'wizard.steps.exegeticalPlan.simpleStudy.req2': 'Second, it should reveal the main idea.',
        'wizard.steps.exegeticalPlan.simpleStudy.req3': 'Third, it should be parallel with other points.',
        'wizard.steps.exegeticalPlan.simpleStudy.req4': 'Fourth, it should be short and precise.',
        'wizard.steps.exegeticalPlan.simpleStudy.goal': 'The goal is not perfection, but reflection of the main idea.',
        'wizard.steps.exegeticalPlan.exampleTitle': 'Example from 1 Peter',
        'wizard.steps.exegeticalPlan.exampleHint': 'Write your example or expand the plan.',
        'wizard.steps.exegeticalPlan.example.topic': 'On submission (3:1–6)',
        'wizard.steps.exegeticalPlan.example.iCommand': 'i. Command to submit',
        'wizard.steps.exegeticalPlan.example.iiPurpose': 'ii. Purpose of submission',
        'wizard.steps.exegeticalPlan.example.iiiCharacter': 'iii. Character of submission',
        'wizard.steps.exegeticalPlan.example.notEvidenceTitle': '1) What does not testify',
        'wizard.steps.exegeticalPlan.example.notEvidenceA': 'a) Outward braiding',
        'wizard.steps.exegeticalPlan.example.notEvidenceB': 'b) Gold adornments',
        'wizard.steps.exegeticalPlan.example.notEvidenceC': 'c) Fine clothing',
        'wizard.steps.exegeticalPlan.example.evidenceTitle': '2) What testifies',
        'wizard.steps.exegeticalPlan.example.evidenceA': 'a) Gentle spirit',
        'wizard.steps.exegeticalPlan.example.evidenceB': 'b) Quiet spirit',
        'wizard.steps.exegeticalPlan.example.ivExample': 'iv. Example of submission',
        'wizard.steps.exegeticalPlan.example.holyWomen': '1) Holy women',
        'wizard.steps.exegeticalPlan.example.sarah': '2) Sarah'
      };
      return translations[key] || key;
    }
  })
}));

import InstructionSection from '@/components/sermon/prep/exegeticalPlan/InstructionSection';

describe('InstructionSection', () => {
  const mockOnToggle = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rendering - Collapsed State', () => {
    it('covers collapsed-state expectations', async () => {
      await runScenarios(
        [
          {
            name: 'shows summary title and intro',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(screen.getByText('Exegetical Plan')).toBeInTheDocument();
            }
          },
          {
            name: 'shows expand button',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(screen.getByText('Show instruction')).toBeInTheDocument();
            }
          },
          {
            name: 'hides detailed sections',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(screen.queryByText('Simple study of the text structure')).not.toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Rendering - Expanded State', () => {
    it('renders comprehensive instructions when expanded', async () => {
      await runScenarios(
        [
          {
            name: 'shows hide button and intro',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              expect(screen.getByText('Hide instruction')).toBeInTheDocument();
              expect(screen.getByText('This section explains how to compose the exegetical plan.')).toBeInTheDocument();
            }
          },
          {
            name: 'lists requirements',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              ['First, it must come from the text.', 'Second, it should reveal the main idea.', 'Third, it should be parallel with other points.', 'Fourth, it should be short and precise.'].forEach(t => {
                expect(screen.getByText(t)).toBeInTheDocument();
              });
            }
          },
          {
            name: 'shows example overview',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              expect(screen.getByText('Example from 1 Peter')).toBeInTheDocument();
              expect(screen.getByText('On submission (3:1–6)')).toBeInTheDocument();
            }
          },
          {
            name: 'shows numbered example points',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              ['i. Command to submit', 'ii. Purpose of submission', 'iii. Character of submission', 'iv. Example of submission'].forEach(t => {
                expect(screen.getByText(t)).toBeInTheDocument();
              });
            }
          },
          {
            name: 'shows nested example details',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              ['1) What does not testify', 'a) Outward braiding', 'b) Gold adornments', 'c) Fine clothing', '2) What testifies', 'a) Gentle spirit', 'b) Quiet spirit'].forEach(t => {
                expect(screen.getByText(t)).toBeInTheDocument();
              });
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('User Interactions', () => {
    it('toggles visibility via buttons', async () => {
      await runScenarios(
        [
          {
            name: 'show button triggers toggle',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              fireEvent.click(screen.getByText('Show instruction'));
              expect(mockOnToggle).toHaveBeenCalled();
            }
          },
          {
            name: 'hide button triggers toggle',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              fireEvent.click(screen.getByText('Hide instruction'));
              expect(mockOnToggle).toHaveBeenCalled();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnToggle.mockClear(); } }
      );
    });
  });

  describe('Component Structure', () => {
    it('applies structural styling and icons', async () => {
      await runScenarios(
        [
          {
            name: 'instruction container styling',
            run: () => {
              render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              const container = screen.getByText('Simple study of the text structure').closest('.p-3');
              expect(container).toHaveClass('bg-gray-50');
            }
          },
          {
            name: 'info icon renders while collapsed',
            run: () => {
              const { container } = render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(container.querySelector('svg')).toBeInTheDocument();
            }
          },
          {
            name: 'example section styling and icons',
            run: () => {
              const { container } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              const exampleContainer = screen.getByText('Example from 1 Peter').closest('.p-2\\.5');
              expect(exampleContainer).toHaveClass('bg-blue-50');
              expect(container.querySelector('svg.w-3.h-3.text-gray-500')).toBeInTheDocument();
              expect(container.querySelector('svg.w-3.h-3.text-blue-600')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Accessibility', () => {
    it('covers semantic structure', async () => {
      await runScenarios(
        [
          {
            name: 'toggle button type',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(screen.getByText('Show instruction')).toHaveAttribute('type', 'button');
            }
          },
          {
            name: 'headings and lists exist',
            run: () => {
              const { container } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              expect(screen.getByText('Exegetical Plan').closest('h4')).toBeInTheDocument();
              expect(container.querySelectorAll('ul.list-disc').length).toBeGreaterThan(0);
            }
          }
        ],
        { afterEachScenario: cleanup }
      );
    });
  });

  describe('Edge Cases', () => {
    it('handles rapid toggling and content persistence', async () => {
      await runScenarios(
        [
          {
            name: 'rapid toggle clicks invoke callback',
            run: () => {
              render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              const button = screen.getByText('Show instruction');
              for (let i = 0; i < 5; i++) fireEvent.click(button);
              expect(mockOnToggle).toHaveBeenCalledTimes(5);
            }
          },
          {
            name: 'rerender maintains content integrity',
            run: () => {
              const { rerender } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              expect(screen.getByText('Simple study of the text structure')).toBeInTheDocument();
              rerender(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
              expect(screen.queryByText('Simple study of the text structure')).not.toBeInTheDocument();
              rerender(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
              expect(screen.getByText('Simple study of the text structure')).toBeInTheDocument();
            }
          }
        ],
        { afterEachScenario: () => { cleanup(); mockOnToggle.mockClear(); } }
      );
    });
  });
});
