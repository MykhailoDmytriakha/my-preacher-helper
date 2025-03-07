import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import MobileMenu from '@/components/navigation/MobileMenu';

// Mock dependencies
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'navigation.settings': 'Settings',
        'navigation.logout': 'Logout'
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

describe('MobileMenu Component', () => {
  const mockLogout = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders nothing when isOpen is false', () => {
    render(<MobileMenu isOpen={false} onLogout={mockLogout} />);
    
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    expect(screen.queryByTestId('language-switcher')).not.toBeInTheDocument();
  });

  test('renders menu items when isOpen is true', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);
    
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
  });

  test('calls onLogout when logout button is clicked', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);
    
    fireEvent.click(screen.getByText('Logout'));
    
    expect(mockLogout).toHaveBeenCalledTimes(1);
  });

  test('settings link has the correct href', () => {
    render(<MobileMenu isOpen={true} onLogout={mockLogout} />);
    
    const settingsLink = screen.getByText('Settings').closest('a');
    expect(settingsLink).toHaveAttribute('href', '/settings');
  });
}); 