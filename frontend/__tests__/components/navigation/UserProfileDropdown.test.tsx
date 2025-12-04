import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import UserProfileDropdown from '@/components/navigation/UserProfileDropdown';
import { User } from 'firebase/auth';
import type { ThemePreference } from '@/hooks/useThemePreference';

const translations: Record<string, string> = {
  'navigation.logout': 'Logout',
  'navigation.guest': 'Guest',
  'settings.appearance.themeMode': 'Theme mode',
  'settings.appearance.dark': 'Dark',
  'settings.appearance.system': 'System default',
  'settings.appearance.light': 'Light',
};

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => translations[key] ?? options?.defaultValue ?? key
  })
}));

const mockSetPreference = jest.fn();
const mockUseThemePreference = jest.fn();

jest.mock('@/hooks/useThemePreference', () => ({
  useThemePreference: () => mockUseThemePreference()
}));

// Mock Icons
jest.mock('@components/Icons', () => ({
  ChevronIcon: ({ className }: { className: string }) => (
    <div data-testid="chevron-icon" className={className}>Icon</div>
  )
}));

describe('UserProfileDropdown Component', () => {
  const mockUser = {
    email: 'test@example.com',
    displayName: 'Test User',
    photoURL: 'https://example.com/photo.jpg'
  } as User;

  const mockLogout = jest.fn().mockResolvedValue(undefined);

  const renderWithPreference = (preference: ThemePreference = 'system') => {
    mockUseThemePreference.mockReturnValue({
      preference,
      setPreference: mockSetPreference,
      ready: true,
    });
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);
  };

  const openDropdown = () => {
    fireEvent.click(screen.getByTestId('avatar-button'));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseThemePreference.mockReturnValue({
      preference: 'system',
      setPreference: mockSetPreference,
      ready: true,
    });

    // Reset document listeners between tests
    document.removeEventListener = jest.fn();
    document.addEventListener = jest.fn();
  });

  test('renders avatar with user photo when available', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);
    
    const avatar = screen.getByAltText('Avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });

  test('renders avatar with user email initial when no photo', () => {
    const userWithoutPhoto = { ...mockUser, photoURL: null };
    
    render(<UserProfileDropdown user={userWithoutPhoto} onLogout={mockLogout} />);
    
    // Should show the first letter of email
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  test('renders guest initial when no user provided', () => {
    render(<UserProfileDropdown user={null} onLogout={mockLogout} />);
    
    expect(screen.getByText('G')).toBeInTheDocument();
  });

  test('toggles dropdown when avatar button is clicked', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);

    // Initially dropdown should not be visible
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();

    // Click avatar to show dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));

    // Now dropdown should be visible
    expect(screen.getByText('Logout')).toBeInTheDocument();

    // Click avatar again to hide dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));

    // Dropdown should be closed
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
  });

  test('calls onLogout when logout button is clicked', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);
    
    // Open dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));
    
    // Click logout button
    fireEvent.click(screen.getByText('Logout'));
    
    // Verify logout was called
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });


  test('shows user display name and email in dropdown', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);
    
    // Open dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));
    
    // Verify user info is displayed
    expect(screen.getByText('Test User')).toBeInTheDocument();
    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  test('shows Guest for display name when user has no display name', () => {
    const userWithoutName = { ...mockUser, displayName: null };
    
    render(<UserProfileDropdown user={userWithoutName} onLogout={mockLogout} />);
    
    // Open dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));
    
    // Verify Guest is displayed
    expect(screen.getByText('Guest')).toBeInTheDocument();
  });

  test('updates theme preference when toggler button is pressed', () => {
    renderWithPreference('system');
    openDropdown();
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(mockSetPreference).toHaveBeenCalledWith('dark');
  });

  test('shows theme header and translation for current preference', () => {
    renderWithPreference('system');
    openDropdown();

    expect(screen.getByText('Theme mode')).toBeInTheDocument();
    expect(screen.getAllByText('System default').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('button', { name: /(Dark|System default|Light)/ })).toHaveLength(3);
  });

  test('displays light label when preference is light', () => {
    renderWithPreference('light');
    openDropdown();

    expect(screen.getAllByText('Light').length).toBeGreaterThanOrEqual(1);
  });

  test('closes dropdown when clicking outside', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);

    // Open dropdown
    fireEvent.click(screen.getByTestId('avatar-button'));

    // Should be visible
    expect(screen.getByText('Logout')).toBeInTheDocument();

    // Simulate document click event (outside of dropdown)
    act(() => {
      const handleClickOutside = (document.addEventListener as jest.Mock).mock.calls.find(
        call => call[0] === 'click'
      )[1];

      handleClickOutside({ target: document.body });
    });

    // Dropdown should be closed
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
  });

  test('handles image load error', () => {
    render(<UserProfileDropdown user={mockUser} onLogout={mockLogout} />);
    
    const avatar = screen.getByAltText('Avatar');
    fireEvent.error(avatar);
    
    // After error, should show initial
    expect(screen.getByText('T')).toBeInTheDocument();
  });
}); 
