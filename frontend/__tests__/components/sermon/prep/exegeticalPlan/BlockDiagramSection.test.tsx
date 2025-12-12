import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'wizard.steps.exegeticalPlan.blockDiagram.title': 'Block diagram',
        'wizard.steps.exegeticalPlan.blockDiagram.description': 'From the block diagram, we will compose the exegetical plan',
        'wizard.steps.exegeticalPlan.blockDiagram.comingSoon': 'Coming Soon',
        'wizard.steps.exegeticalPlan.blockDiagram.notAvailableYet': 'This feature is currently under development and will be available in a future update. The block diagram will provide a visual representation of the text structure to help compose the exegetical plan.'
      };
      return translations[key] || key;
    }
  })
}));

import BlockDiagramSection from '@/components/sermon/prep/exegeticalPlan/BlockDiagramSection';

describe('BlockDiagramSection', () => {
  describe('Rendering', () => {
    it('renders all basic elements', () => {
      render(<BlockDiagramSection />);

      expect(screen.getByText('Block diagram')).toBeInTheDocument();
      expect(screen.getByText('From the block diagram, we will compose the exegetical plan')).toBeInTheDocument();
      expect(screen.getByText('Coming Soon')).toBeInTheDocument();
    });

    it('has proper styling classes', () => {
      const { container } = render(<BlockDiagramSection />);
      const section = container.firstChild as HTMLElement;
      
      expect(section).toHaveClass('p-2.5', 'rounded-md');
      expect(section).toHaveClass('bg-amber-50', 'dark:bg-amber-900/10');
    });

    it('renders help circle icon button', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      expect(helpButton).toBeInTheDocument();
      expect(helpButton).toHaveAttribute('title', 'This feature is currently under development and will be available in a future update. The block diagram will provide a visual representation of the text structure to help compose the exegetical plan.');
    });

    it('does not show info text initially', () => {
      render(<BlockDiagramSection />);
      
      const infoTexts = screen.queryAllByText(/This feature is currently under development/);
      expect(infoTexts.filter(el => el.classList.contains('text-[11px]'))).toHaveLength(0);
    });
  });

  describe('User Interactions', () => {
    it('shows info text when help button is clicked', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      fireEvent.click(helpButton);
      
      const infoTexts = screen.getAllByText(/This feature is currently under development/);
      const detailedInfo = infoTexts.find(el => el.classList.contains('text-[11px]'));
      expect(detailedInfo).toBeInTheDocument();
    });

    it('hides info text when help button is clicked again', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      
      fireEvent.click(helpButton);
      let infoTexts = screen.getAllByText(/This feature is currently under development/);
      let detailedInfo = infoTexts.find(el => el.classList.contains('text-[11px]'));
      expect(detailedInfo).toBeInTheDocument();
      
      fireEvent.click(helpButton);
      infoTexts = screen.queryAllByText(/This feature is currently under development/);
      detailedInfo = infoTexts.find(el => el.classList.contains('text-[11px]'));
      expect(detailedInfo).toBeUndefined();
    });

    it('toggles info text multiple times', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      
      for (let i = 0; i < 3; i++) {
        fireEvent.click(helpButton);
        const infoTexts = screen.getAllByText(/This feature is currently under development/);
        const detailedInfo = infoTexts.find(el => el.classList.contains('text-[11px]'));
        expect(detailedInfo).toBeInTheDocument();
        
        fireEvent.click(helpButton);
        const hiddenInfoTexts = screen.queryAllByText(/This feature is currently under development/);
        const hiddenDetailedInfo = hiddenInfoTexts.find(el => el.classList.contains('text-[11px]'));
        expect(hiddenDetailedInfo).toBeUndefined();
      }
    });
  });

  describe('Accessibility', () => {
    it('has proper ARIA attributes for help button', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      expect(helpButton).toHaveAttribute('type', 'button');
      expect(helpButton).toHaveAttribute('title');
    });

    it('displays coming soon badge with proper contrast', () => {
      render(<BlockDiagramSection />);
      
      const badge = screen.getByText('Coming Soon');
      expect(badge).toHaveClass('bg-amber-200', 'dark:bg-amber-800');
      expect(badge).toHaveClass('text-amber-800', 'dark:text-amber-200');
    });
  });

  describe('Component ThoughtsBySection', () => {
    it('renders ListTree icon', () => {
      const { container } = render(<BlockDiagramSection />);
      
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('has proper layout structure', () => {
      const { container } = render(<BlockDiagramSection />);
      
      const flexContainer = container.querySelector('.flex.items-center.gap-1\\.5');
      expect(flexContainer).toBeInTheDocument();
    });

    it('conditionally renders info section with proper border', () => {
      render(<BlockDiagramSection />);
      
      const helpButton = screen.getByRole('button');
      fireEvent.click(helpButton);
      
      const infoTexts = screen.getAllByText(/This feature is currently under development/);
      const detailedInfo = infoTexts.find(el => el.classList.contains('text-[11px]')) as HTMLElement;
      
      expect(detailedInfo).toHaveClass('border-t', 'border-amber-200', 'dark:border-amber-800');
    });
  });
});
