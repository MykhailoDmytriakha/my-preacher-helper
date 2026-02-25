import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import BackLink from '@components/settings/BackLink';

// --- Mocks --- //

const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    back: mockRouterBack,
    push: mockRouterPush,
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock Icon
jest.mock('@components/Icons', () => ({
  BackArrowIcon: () => <span data-testid="back-arrow-icon">←</span>,
}));

// --- Test Suite --- //

describe('BackLink', () => {

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders a button (not a link) with default label', () => {
    render(<BackLink to="/dashboard" />);

    expect(screen.getByTestId('back-arrow-icon')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /settings.backToDashboard/i });
    expect(button).toBeInTheDocument();
  });

  it('renders with custom label', () => {
    const customLabel = 'Go Back';
    render(<BackLink to="/previous-page" label={customLabel} />);

    expect(screen.getByTestId('back-arrow-icon')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go Back/ })).toBeInTheDocument();
  });

  it('renders without to prop using default fallback', () => {
    render(<BackLink />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls router.back() when history.length > 1', () => {
    Object.defineProperty(window, 'history', {
      writable: true,
      value: { length: 5 },
    });

    render(<BackLink to="/dashboard" />);
    fireEvent.click(screen.getByRole('button'));

    expect(mockRouterBack).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it('calls router.push(to) when history.length <= 1', () => {
    Object.defineProperty(window, 'history', {
      writable: true,
      value: { length: 1 },
    });

    render(<BackLink to="/dashboard" />);
    fireEvent.click(screen.getByRole('button'));

    expect(mockRouterPush).toHaveBeenCalledWith('/dashboard');
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it('calls router.push("/") as default fallback when no to prop and history.length <= 1', () => {
    Object.defineProperty(window, 'history', {
      writable: true,
      value: { length: 1 },
    });

    render(<BackLink />);
    fireEvent.click(screen.getByRole('button'));

    expect(mockRouterPush).toHaveBeenCalledWith('/');
  });

});
