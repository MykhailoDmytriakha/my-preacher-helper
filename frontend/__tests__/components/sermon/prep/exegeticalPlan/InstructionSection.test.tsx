import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

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
    it('renders title and intro when collapsed', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      expect(screen.getByText('Exegetical Plan')).toBeInTheDocument();
      expect(screen.getByText('An exegetical plan helps see the overall flow of what the text says.')).toBeInTheDocument();
    });

    it('shows "Show instruction" button when collapsed', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      expect(screen.getByText('Show instruction')).toBeInTheDocument();
    });

    it('does not show detailed instructions when collapsed', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      expect(screen.queryByText('Simple study of the text structure')).not.toBeInTheDocument();
    });
  });

  describe('Rendering - Expanded State', () => {
    it('shows "Hide instruction" button when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('Hide instruction')).toBeInTheDocument();
    });

    it('displays all instruction content when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('This section explains how to compose the exegetical plan.')).toBeInTheDocument();
      expect(screen.getByText('Simple study of the text structure')).toBeInTheDocument();
      expect(screen.getByText('A passage plan is a structural expression of the development of its main idea.')).toBeInTheDocument();
    });

    it('displays all requirements when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('First, it must come from the text.')).toBeInTheDocument();
      expect(screen.getByText('Second, it should reveal the main idea.')).toBeInTheDocument();
      expect(screen.getByText('Third, it should be parallel with other points.')).toBeInTheDocument();
      expect(screen.getByText('Fourth, it should be short and precise.')).toBeInTheDocument();
    });

    it('displays the example section when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('Example from 1 Peter')).toBeInTheDocument();
      expect(screen.getByText('Write your example or expand the plan.')).toBeInTheDocument();
      expect(screen.getByText('On submission (3:1–6)')).toBeInTheDocument();
    });

    it('displays all example points when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('i. Command to submit')).toBeInTheDocument();
      expect(screen.getByText('ii. Purpose of submission')).toBeInTheDocument();
      expect(screen.getByText('iii. Character of submission')).toBeInTheDocument();
      expect(screen.getByText('iv. Example of submission')).toBeInTheDocument();
    });

    it('displays nested example details when expanded', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('1) What does not testify')).toBeInTheDocument();
      expect(screen.getByText('a) Outward braiding')).toBeInTheDocument();
      expect(screen.getByText('b) Gold adornments')).toBeInTheDocument();
      expect(screen.getByText('c) Fine clothing')).toBeInTheDocument();
      expect(screen.getByText('2) What testifies')).toBeInTheDocument();
      expect(screen.getByText('a) Gentle spirit')).toBeInTheDocument();
      expect(screen.getByText('b) Quiet spirit')).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onToggle when show button is clicked', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      const button = screen.getByText('Show instruction');
      fireEvent.click(button);

      expect(mockOnToggle).toHaveBeenCalledTimes(1);
    });

    it('calls onToggle when hide button is clicked', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const button = screen.getByText('Hide instruction');
      fireEvent.click(button);

      expect(mockOnToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('Component Structure', () => {
    it('has proper styling for the instruction container', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const container = screen.getByText('Simple study of the text structure').closest('.p-3');
      expect(container).toHaveClass('rounded-md', 'bg-gray-50', 'dark:bg-gray-800/50');
    });

    it('renders Info icon', () => {
      const { container } = render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('has proper styling for example section', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const exampleContainer = screen.getByText('Example from 1 Peter').closest('.p-2\\.5');
      expect(exampleContainer).toHaveClass('rounded-md', 'bg-blue-50', 'dark:bg-blue-900/20');
    });

    it('renders ListTree icon in expanded state', () => {
      const { container } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const listTreeIcon = container.querySelector('svg.w-3.h-3.text-gray-500');
      expect(listTreeIcon).toBeInTheDocument();
    });

    it('renders BookOpen icon in example section', () => {
      const { container } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const bookIcon = container.querySelector('svg.w-3.h-3.text-blue-600');
      expect(bookIcon).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('toggle button has proper type attribute', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      const button = screen.getByText('Show instruction');
      expect(button).toHaveAttribute('type', 'button');
    });

    it('uses semantic HTML with proper headings', () => {
      render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const heading = screen.getByText('Exegetical Plan').closest('h4');
      expect(heading).toBeInTheDocument();
    });

    it('uses lists for structured content', () => {
      const { container } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      const lists = container.querySelectorAll('ul.list-disc');
      expect(lists.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('handles rapid toggling', () => {
      render(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);

      const button = screen.getByText('Show instruction');
      
      for (let i = 0; i < 5; i++) {
        fireEvent.click(button);
      }

      expect(mockOnToggle).toHaveBeenCalledTimes(5);
    });

    it('maintains content integrity when toggling', () => {
      const { rerender } = render(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);

      expect(screen.getByText('Simple study of the text structure')).toBeInTheDocument();

      rerender(<InstructionSection isVisible={false} onToggle={mockOnToggle} />);
      expect(screen.queryByText('Simple study of the text structure')).not.toBeInTheDocument();

      rerender(<InstructionSection isVisible={true} onToggle={mockOnToggle} />);
      expect(screen.getByText('Simple study of the text structure')).toBeInTheDocument();
    });
  });
});
