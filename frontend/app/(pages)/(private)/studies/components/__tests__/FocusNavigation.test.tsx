import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import FocusNavigation from '../FocusNavigation';

describe('FocusNavigation', () => {
  const defaultProps = {
    currentIndex: 1,
    totalCount: 5,
    onPrev: jest.fn(),
    onNext: jest.fn(),
    onClose: jest.fn(),
    hasPrev: true,
    hasNext: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders counter with translation key', () => {
    render(<FocusNavigation {...defaultProps} />);

    // In tests, t() returns the key; interpolation shows the key name
    expect(screen.getByText('studiesWorkspace.focusMode.noteOf')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    render(<FocusNavigation {...defaultProps} />);

    const closeButton = screen.getByRole('button', {
      name: 'studiesWorkspace.focusMode.exitFocus',
    });
    await userEvent.click(closeButton);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onPrev when prev button is clicked', async () => {
    render(<FocusNavigation {...defaultProps} />);

    const prevButton = screen.getByRole('button', {
      name: 'studiesWorkspace.focusMode.prevNote',
    });
    await userEvent.click(prevButton);

    expect(defaultProps.onPrev).toHaveBeenCalledTimes(1);
  });

  it('calls onNext when next button is clicked', async () => {
    render(<FocusNavigation {...defaultProps} />);

    const nextButton = screen.getByRole('button', {
      name: 'studiesWorkspace.focusMode.nextNote',
    });
    await userEvent.click(nextButton);

    expect(defaultProps.onNext).toHaveBeenCalledTimes(1);
  });

  it('disables prev button when hasPrev is false', async () => {
    render(<FocusNavigation {...defaultProps} hasPrev={false} />);

    const prevButton = screen.getByRole('button', {
      name: 'studiesWorkspace.focusMode.prevNote',
    });
    expect(prevButton).toBeDisabled();
  });

  it('disables next button when hasNext is false', async () => {
    render(<FocusNavigation {...defaultProps} hasNext={false} />);

    const nextButton = screen.getByRole('button', {
      name: 'studiesWorkspace.focusMode.nextNote',
    });
    expect(nextButton).toBeDisabled();
  });

  it('uses amber styling when isQuestion is true', () => {
    const { container } = render(<FocusNavigation {...defaultProps} isQuestion={true} />);

    // Check for amber background class on header
    const header = container.querySelector('.bg-amber-50\\/50');
    expect(header).toBeInTheDocument();
  });

  it('uses emerald styling when isQuestion is false', () => {
    const { container } = render(<FocusNavigation {...defaultProps} isQuestion={false} />);

    // Check for emerald background class on header
    const header = container.querySelector('.bg-emerald-50\\/50');
    expect(header).toBeInTheDocument();
  });
});

