import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import MobileMenu from '@/components/navigation/MobileMenu';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'navigation.settings': 'Settings',
        'navigation.logout_account': 'Logout Account'
      };
      return translations[key] || key;
    }
  })
}));

// Mock LanguageSwitcher component
jest.mock('@/components/navigation/LanguageSwitcher', () => {
  return function MockLanguageSwitcher() {
    return <div data-testid="language-switcher">Language Switcher</div>;
  };
});

// Mock ThemeModeToggle component
jest.mock('@/components/navigation/ThemeModeToggle', () => {
  return function MockThemeModeToggle() {
    return <div data-testid="theme-mode-toggle">Theme Mode Toggle</div>;
  };
});

describe('MobileMenu Component', () => {
  const mockLogout = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders nothing when isOpen is false', () => {
    render(<MobileMenu isOpen={false} onLogout={mockLogout} />);

    expect(screen.queryByText(/Settings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Logout Account/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
    expect(screen.queryByTestId('theme-mode-toggle')).not.toBeInTheDocument();
  });

  test('renders menu items when isOpen is true', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);

    expect(screen.getByText(/Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Logout Account/i)).toBeInTheDocument();
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('theme-mode-toggle')).toBeInTheDocument();
  });

  test('calls onLogout when logout button is clicked', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);

    fireEvent.click(screen.getByText(/Logout Account/i));

    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  test('settings link has the correct href', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);

    const settingsLink = screen.getByText(/Settings/i).closest('a');
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });

  test('renders beta label and active indicator when appropriate', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} pathname="/settings" />);

    // Beta label for groups
    expect(screen.getByText('Beta')).toBeInTheDocument();

    // Active indicator (bullet point)
    expect(screen.getByText('•')).toBeInTheDocument();
  });
});