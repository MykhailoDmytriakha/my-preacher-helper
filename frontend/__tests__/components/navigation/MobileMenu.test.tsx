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

  /**
   * On a phone the avatar has nowhere to live: the bar is full and everything the desktop
   * dropdown offers — theme, language, logout — already sits in this menu. The one thing
   * missing was the answer to "which account am I in", so it goes on the same row as the
   * switchers, on the left.
   */
  test('says who is signed in, on the switcher row', () => {
    const user = {
      displayName: 'Mykhailo',
      email: 'mykhailo@example.com',
      photoURL: null,
    } as unknown as import('firebase/auth').User;

    render(<MobileMenu isOpen={true} onLogout={mockLogout} user={user} />);

    expect(screen.getByText('Mykhailo')).toBeInTheDocument();
    expect(screen.getByText('mykhailo@example.com')).toBeInTheDocument();
  });

  test('promotes the email when the account has no display name', () => {
    // Signing in with an email and password leaves `displayName` empty, and that is the
    // common case here — a row reading "Guest" over a real account would be a lie.
    const user = {
      displayName: null,
      email: 'mykhailo@example.com',
      photoURL: null,
    } as unknown as import('firebase/auth').User;

    render(<MobileMenu isOpen={true} onLogout={mockLogout} user={user} />);

    expect(screen.getByText('mykhailo@example.com')).toBeInTheDocument();
    expect(screen.queryByText('navigation.guest')).not.toBeInTheDocument();
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

  test('renders groups without a beta label and preserves the active indicator', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} pathname="/settings" />);

    // Released groups navigation has no beta label.
    expect(screen.getByRole('link', { name: 'navigation.groups' })).toHaveAttribute('href', '/groups');
    expect(screen.queryByText('Beta')).not.toBeInTheDocument();

    // Active indicator (bullet point)
    expect(screen.getByText('•')).toBeInTheDocument();
  });
});