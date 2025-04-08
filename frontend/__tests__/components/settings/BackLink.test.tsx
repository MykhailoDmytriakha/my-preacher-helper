import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import BackLink from '@components/settings/BackLink';

// --- Mocks --- //

jest.mock('next/link', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return ({ children, href }: any) => <a href={href}>{children}</a>;
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// Mock Icon
jest.mock('@components/Icons', () => ({
  BackArrowIcon: () => <span data-testid="back-arrow-icon">←</span>,
}));

// --- Test Suite --- //

describe('BackLink', () => {

  it('renders with default label and correct href', () => {
    const destination = '/dashboard';
    render(<BackLink to={destination} />);

    // Check icon is present
    expect(screen.getByTestId('back-arrow-icon')).toBeInTheDocument();

    // Check default text (using the translation key as mock output)
    const linkElement = screen.getByRole('link', { name: /settings.backToDashboard/i });
    expect(linkElement).toBeInTheDocument();

    // Check href attribute
    expect(linkElement).toHaveAttribute('href', destination);
  });

  it('renders with custom label and correct href', () => {
    const destination = '/previous-page';
    const customLabel = 'Go Back';
    render(<BackLink to={destination} label={customLabel} />);

    // Check icon is present
    expect(screen.getByTestId('back-arrow-icon')).toBeInTheDocument();

    // Check custom label text, including the icon text in the name calculation
    const linkElement = screen.getByRole('link', { name: `← ${customLabel}` });
    expect(linkElement).toBeInTheDocument();

    // Check href attribute
    expect(linkElement).toHaveAttribute('href', destination);
  });

}); 