import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

jest.mock('@locales/i18n', () => ({}));

import PrepStepCard from '@/components/sermon/prep/PrepStepCard';

describe('PrepStepCard', () => {
  const baseProps = {
    stepId: 'spiritual',
    stepNumber: 1,
    title: 'Step Title',
    icon: <span data-testid="icon" />,
    isActive: true,
    isExpanded: true,
    onToggle: jest.fn(),
    children: <div data-testid="content">Content</div>,
  } as const;

  it('renders title, number and icon', () => {
    render(<PrepStepCard {...baseProps} />);
    expect(screen.getByText('Step Title')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('sets aria-expanded depending on expanded state', () => {
    const { rerender } = render(<PrepStepCard {...baseProps} isExpanded={true} />);
    expect(screen.getByRole('button', { name: /step title/i })).toHaveAttribute('aria-expanded', 'true');

    rerender(<PrepStepCard {...baseProps} isExpanded={false} />);
    expect(screen.getByRole('button', { name: /step title/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onToggle when header is clicked', () => {
    const onToggle = jest.fn();
    render(<PrepStepCard {...baseProps} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /step title/i }));
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows done badge when done=true', () => {
    render(<PrepStepCard {...baseProps} done />);
    expect(screen.getByLabelText('Done')).toBeInTheDocument();
  });
});


