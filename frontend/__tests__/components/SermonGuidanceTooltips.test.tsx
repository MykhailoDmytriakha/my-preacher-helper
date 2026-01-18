import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { OutlinePointGuidanceTooltip } from '@/components/SermonGuidanceTooltips';

// Translation function for tests
const mockT = (key: string) => {
  const translations: Record<string, string> = {
    'structure.outlineHelp.ariaLabel': 'Quick help for outline point',
    'structure.outlineHelp.title': 'Outline Point Help',
    'structure.outlineHelp.verse': 'Verse: Reference text',
    'structure.outlineHelp.explanation': 'Explanation: What the text says',
    'structure.outlineHelp.illustration': 'Illustration: Example showing truth',
    'structure.outlineHelp.argumentation': 'Argumentation: Logical reasoning',
    'structure.outlineHelp.application': 'Application: How to apply',
  };
  return translations[key] || key;
};

describe('OutlinePointGuidanceTooltip', () => {
  it('renders tooltip button', () => {
    render(<OutlinePointGuidanceTooltip t={mockT} />);

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    expect(button).toBeInTheDocument();
  });

  it('shows tooltip on click', async () => {
    render(<OutlinePointGuidanceTooltip t={mockT} />);

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Outline Point Help')).toBeInTheDocument();
    });
  });

  it('closes tooltip on outside click', async () => {
    render(<OutlinePointGuidanceTooltip t={mockT} />);

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Outline Point Help')).toBeInTheDocument();
    });

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(screen.queryByText('Outline Point Help')).not.toBeInTheDocument();
    });
  });

  it('applies dynamic positioning classes based on boundary detection', async () => {
    // Test that the tooltip element gets the positioning ref and classes applied
    render(
      <div className="overflow-y-auto">
        <OutlinePointGuidanceTooltip t={mockT} />
      </div>
    );

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    fireEvent.click(button);

    await waitFor(() => {
      // Find the tooltip positioning container (the absolute positioned div)
      const tooltipContainer = screen.getByText('Outline Point Help').parentElement?.parentElement;
      // Verify the tooltip has positioning classes
      expect(tooltipContainer).toHaveClass('absolute');
      expect(tooltipContainer).toHaveClass('z-[60]');
      expect(tooltipContainer).toHaveClass('w-[300px]');
    });
  });

  it('respects right alignment prop', async () => {
    render(
      <div className="overflow-y-auto">
        <OutlinePointGuidanceTooltip t={mockT} popoverAlignment="right" />
      </div>
    );

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    fireEvent.click(button);

    await waitFor(() => {
      // Find the tooltip positioning container
      const tooltipContainer = screen.getByText('Outline Point Help').parentElement?.parentElement;
      expect(tooltipContainer).toHaveClass('right-0');
    });
  });

  it('displays all tooltip content correctly', async () => {
    render(<OutlinePointGuidanceTooltip t={mockT} />);

    const button = screen.getByRole('button', { name: 'Quick help for outline point' });
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Outline Point Help')).toBeInTheDocument();
    });

    // Verify all content items are present
    expect(screen.getByText('Verse: Reference text')).toBeInTheDocument();
    expect(screen.getByText('Explanation: What the text says')).toBeInTheDocument();
    expect(screen.getByText('Illustration: Example showing truth')).toBeInTheDocument();
    expect(screen.getByText('Argumentation: Logical reasoning')).toBeInTheDocument();
    expect(screen.getByText('Application: How to apply')).toBeInTheDocument();
  });
});