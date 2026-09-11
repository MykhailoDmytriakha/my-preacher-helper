import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import '@testing-library/jest-dom';
import MobileMenu from '@/components/navigation/MobileMenu';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'navigation.settings': 'Settings',
        'navigation.logout_account': 'Logout Account',
        'navigation.menu': 'Menu',
        'common.close': 'Close',
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
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 690 });
    window.matchMedia = jest.fn(() => ({
      matches: false,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    })) as unknown as typeof window.matchMedia;
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

  test('shows the account name, email and actual profile photo', () => {
    const user = {
      displayName: 'Mykhailo',
      email: 'mykhailo@example.com',
      photoURL: 'https://example.com/avatar.png',
    } as unknown as import('firebase/auth').User;

    render(<MobileMenu isOpen={true} onLogout={mockLogout} user={user} />);

    expect(screen.getByText('Mykhailo')).toBeInTheDocument();
    expect(screen.getByText('mykhailo@example.com')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Avatar' })).toHaveAttribute('src', 'https://example.com/avatar.png');
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

  test('keeps all eight destinations and highlights care on prayer detail routes', () => {
    render(<MobileMenu isOpen onLogout={mockLogout} pathname="/prayers/123" />);
    expect(screen.getAllByRole('link')).toHaveLength(8);
    expect(screen.getByRole('link', { name: 'navigation.care' })).toHaveAttribute('aria-current', 'page');
  });

  test('notifies navigation and closes after selecting a destination', async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    const onClose = jest.fn();
    render(<MobileMenu isOpen onLogout={mockLogout} onNavigate={onNavigate} onClose={onClose} />);
    await user.click(screen.getByRole('link', { name: 'Settings' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('focuses the menu and restores the trigger after Escape', async () => {
    const user = userEvent.setup();
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return <><button onClick={() => setOpen(true)}>Open menu</button>
        <MobileMenu isOpen={open} onLogout={mockLogout} onClose={() => setOpen(false)} /></>;
    }
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    expect(await screen.findByRole('dialog', { name: 'Menu' })).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus());
    await waitFor(() => expect(document.documentElement).toHaveStyle({ overflow: 'hidden' }));
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Logout Account' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open menu' })).toHaveFocus());
    await waitFor(() => expect(document.documentElement).not.toHaveStyle({ overflow: 'hidden' }));
  });

  test('supports the legacy close callback and closes when the viewport becomes desktop', async () => {
    const user = userEvent.setup();
    const onNavigate = jest.fn();
    render(<MobileMenu isOpen onLogout={mockLogout} onNavigate={onNavigate} />);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    act(() => {
      window.innerWidth = 1280;
      window.dispatchEvent(new Event('resize'));
    });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
