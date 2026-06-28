import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import { SectionVisibilityPills } from '../SectionVisibilityPills';

// t returns the key; getSectionLabel still resolves a (key-based) label, and the
// pills render in a fixed order so we can address them by index.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe('SectionVisibilityPills', () => {
  const setup = (visibleSections: string[]) => {
    const onToggle = jest.fn();
    render(<SectionVisibilityPills visibleSections={visibleSections} onToggle={onToggle} />);
    // Order is introduction, main, conclusion.
    return { onToggle, buttons: screen.getAllByRole('button') };
  };

  it('renders one pill per section, all pressed and enabled when all are visible', () => {
    const { buttons } = setup(['introduction', 'main', 'conclusion']);
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => {
      expect(b).toHaveAttribute('aria-pressed', 'true');
      expect(b).toBeEnabled();
    });
  });

  it('marks a hidden section as not pressed', () => {
    const { buttons } = setup(['introduction', 'conclusion']); // main hidden
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true'); // introduction
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false'); // main
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true'); // conclusion
  });

  it('disables the single remaining pill so at least one section stays open', () => {
    const { buttons } = setup(['main']);
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toBeDisabled();
    expect(buttons[0]).toBeEnabled();
    expect(buttons[2]).toBeEnabled();
  });

  it('calls onToggle with the section id when a pill is clicked', () => {
    const { buttons, onToggle } = setup(['introduction', 'main', 'conclusion']);
    fireEvent.click(buttons[1]); // main
    expect(onToggle).toHaveBeenCalledWith('main');
  });
});
