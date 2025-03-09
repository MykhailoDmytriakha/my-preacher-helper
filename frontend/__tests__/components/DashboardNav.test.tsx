import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';
import { User } from 'firebase/auth';

// Mock key dependencies
jest.mock('next/navigation', () => {
  const push = jest.fn();
  return {
    useRouter: () => ({ 
      push,
      refresh: jest.fn()
    }),
    usePathname: () => '/dashboard'
  };
});

// Mock LanguageSwitcher component
jest.mock('@components/navigation/LanguageSwitcher', () => {
  return function MockLanguageSwitcher() {
    return <div data-testid="language-switcher">Language Switcher</div>;
  };
});

// Mock FeedbackModal component
jest.mock('@components/navigation/FeedbackModal', () => {
  return function MockFeedbackModal({ isOpen, onClose, onSubmit }: { 
    isOpen: boolean; 
    onClose: () => void; 
    onSubmit: (text: string, type: string) => Promise<boolean | void>; 
  }) {
    return isOpen ? (
      <div data-testid="feedback-modal">
        <button onClick={onClose} data-testid="close-modal">Close Modal</button>
        <button onClick={() => onSubmit('Feedback text', 'suggestion')} data-testid="submit-feedback">Submit Feedback</button>
      </div>
    ) : null;
  };
});

// Mock MobileMenu component
jest.mock('@components/navigation/MobileMenu', () => {
  return function MockMobileMenu({ isOpen, onLogout }: { 
    isOpen: boolean; 
    onLogout: () => void; 
  }) {
    return isOpen ? (
      <div data-testid="mobile-menu">
        <button onClick={onLogout} data-testid="mobile-logout">Logout</button>
      </div>
    ) : null;
  };
});

// Mock Icons
jest.mock('@components/Icons', () => ({
  ChevronIcon: ({ className }: { className: string }) => (
    <div data-testid="chevron-icon" className={className}>Icon</div>
  )
}));

// Define a handler that will let us control auth state in tests
let authStateCallback: ((user: User | null) => void) | null = null;
const unsubscribeMock = jest.fn();

// Mock Firebase auth
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: (auth: any, callback: any) => {
    // Store the callback for use in tests
    authStateCallback = callback;
    // Return the unsubscribe mock
    return unsubscribeMock;
  },
  getAuth: () => ({}),
  User: jest.fn()
}));

// Mock Firebase auth service
jest.mock('@services/firebaseAuth.service', () => ({
  logOut: jest.fn().mockResolvedValue(undefined),
  auth: { currentUser: null }
}));

// Mock i18n
jest.mock('@locales/i18n', () => ({}), { virtual: true });

// Mock useTranslation
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: { [key: string]: string } = {
        'navigation.dashboard': 'Dashboard',
        'navigation.settings': 'Settings',
        'navigation.logout': 'Logout',
        'navigation.guest': 'Guest',
        'feedback.button': 'Feedback'
      };
      return translations[key] || key;
    },
    i18n: {
      changeLanguage: jest.fn().mockResolvedValue(undefined)
    }
  })
}));

// Mock useFeedback hook
jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => ({
    showFeedbackModal: false,
    handleFeedbackClick: jest.fn(),
    closeFeedbackModal: jest.fn(),
    handleSubmitFeedback: jest.fn().mockResolvedValue(true)
  })
}));

// Mock localStorage
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock sessionStorage
Object.defineProperty(window, 'sessionStorage', {
  value: {
    clear: jest.fn()
  }
});

// Mock document cookie
Object.defineProperty(document, 'cookie', {
  writable: true,
  value: 'lang=en'
});

describe('DashboardNav Component', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    authStateCallback = null;
    // Set initial mobile view state for consistent testing
    window.innerWidth = 1024; // Desktop view by default
  });

  test('renders dashboard link and language switcher', async () => {
    render(<DashboardNav />);
    
    // Simulate auth state with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User',
          photoURL: 'https://example.com/photo.jpg'
        } as User);
      }
    });

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // Use getAllByTestId instead of getByTestId to handle multiple matches
    const languageSwitchers = screen.getAllByTestId('language-switcher');
    expect(languageSwitchers.length).toBeGreaterThan(0);
  });

  test('displays user email initial when user has no photo', async () => {
    render(<DashboardNav />);
    
    // Simulate auth with user without photo
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User',
          photoURL: null
        } as User);
      }
    });
    
    // Should show the first letter of email
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  test('displays user photo when available', async () => {
    render(<DashboardNav />);
    
    // Simulate auth with user with photo
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User',
          photoURL: 'https://example.com/photo.jpg'
        } as User);
      }
    });
    
    const avatar = screen.getByAltText('Avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });

  test('toggles dropdown menu when avatar is clicked', async () => {
    // Mock a desktop viewport
    window.innerWidth = 1024;
    
    render(<DashboardNav />);
    
    // Simulate auth with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User',
          photoURL: 'https://example.com/photo.jpg'
        } as User);
      }
    });
    
    // Initially desktop dropdown should not be visible
    const avatarButton = screen.getByTestId('avatar-button');
    
    // Click avatar to show dropdown
    await act(async () => {
      fireEvent.click(avatarButton);
    });
    
    // Now the dropdown should be visible with Settings and Logout
    // Check specifically for desktop dropdown settings, not mobile ones
    const dropdownSettings = screen.getAllByText('Settings');
    const dropdownLogout = screen.getAllByText('Logout');
    
    // Verify dropdown content is visible
    expect(dropdownSettings.length).toBeGreaterThan(0);
    expect(dropdownLogout.length).toBeGreaterThan(0);
    
    // Icon should have rotate class
    const icon = screen.getByTestId('chevron-icon');
    expect(icon.className).toContain('rotate-180');
    
    // Click again to hide dropdown
    await act(async () => {
      fireEvent.click(avatarButton);
    });
    
    // We can't reliably test that Settings is gone since it exists in mobile menu
    // Instead check the icon rotation is removed
    expect(icon.className).not.toContain('rotate-180');
  });

  test('redirects to home when user is not authenticated', async () => {
    // Get the mocked router
    const { useRouter } = require('next/navigation');
    const router = useRouter();
    
    // Clear all mocks before testing
    jest.clearAllMocks();
    
    // Render with no initial auth state
    render(<DashboardNav />);
    
    // Explicitly trigger the auth callback with null user
    await act(async () => {
      // Make sure callback is available
      expect(authStateCallback).not.toBeNull();
      if (authStateCallback) {
        authStateCallback(null);
      }
    });
    
    // Add a small delay to allow for async operations
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });
    
    // Verify the redirect happened
    expect(router.push).toHaveBeenCalledWith('/');
  });

  test('calls logout function when logout button is clicked', async () => {
    const { logOut } = require('@services/firebaseAuth.service');
    
    render(<DashboardNav />);
    
    // Simulate auth with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User'
        } as User);
      }
    });
    
    // Open dropdown - use the specific avatar button testid
    await act(async () => {
      fireEvent.click(screen.getByTestId('avatar-button'));
    });
    
    // Click logout button - specify which logout button more precisely
    // Get all logout buttons and click the first one (desktop dropdown)
    const logoutButtons = screen.getAllByText('Logout');
    await act(async () => {
      fireEvent.click(logoutButtons[0]);
    });
    
    // Verify logout was called
    expect(logOut).toHaveBeenCalled();
    
    // Check if localStorage.removeItem and sessionStorage.clear were called
    expect(localStorageMock.removeItem).toHaveBeenCalledWith('guestUser');
    expect(sessionStorage.clear).toHaveBeenCalled();
  });

  test('unsubscribes from auth state changes on unmount', () => {
    const { unmount } = render(<DashboardNav />);
    unmount();
    
    // Should call unsubscribe
    expect(unsubscribeMock).toHaveBeenCalled();
  });

  // NEW TESTS TO IMPROVE BRANCH COVERAGE

  test('toggles mobile menu when menu button is clicked', async () => {
    // Mock a mobile viewport
    window.innerWidth = 600;
    
    render(<DashboardNav />);
    
    // Simulate auth with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User'
        } as User);
      }
    });
    
    // Mobile menu should be initially closed
    expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
    
    // Find and click mobile menu button (hamburger icon)
    const menuButton = screen.getByRole('button', { name: /open menu/i });
    await act(async () => {
      fireEvent.click(menuButton);
    });
    
    // Mobile menu should now be open
    expect(screen.getByTestId('mobile-menu')).toBeInTheDocument();
    
    // Click again to close menu - now it should show X icon with "Open menu" accessible name
    await act(async () => {
      fireEvent.click(menuButton);
    });
    
    // Mobile menu should now be closed
    expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
  });

  test('closes mobile menu when path changes', async () => {
    // Mock usePathname to return a function that we can change
    const mockPathname = { value: '/dashboard' };
    jest.spyOn(require('next/navigation'), 'usePathname').mockImplementation(() => mockPathname.value);
    
    // Mock a mobile viewport
    window.innerWidth = 600;
    
    const { rerender } = render(<DashboardNav />);
    
    // Simulate auth with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          email: 'test@example.com',
          displayName: 'Test User'
        } as User);
      }
    });
    
    // Open mobile menu
    const menuButton = screen.getByRole('button', { name: /open menu/i });
    await act(async () => {
      fireEvent.click(menuButton);
    });
    
    // Mobile menu should be open
    expect(screen.getByTestId('mobile-menu')).toBeInTheDocument();
    
    // Simulate path change
    mockPathname.value = '/dashboard/settings';
    
    // Re-render to trigger useEffect
    rerender(<DashboardNav />);
    
    // Mobile menu should now be closed due to path change
    expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
  });

  test('opens feedback modal when feedback button is clicked', async () => {
    // Mock useFeedback to control state
    const mockHandleFeedbackClick = jest.fn();
    const mockShowFeedbackModal = jest.fn();
    
    // Override the mock for this test only
    jest.spyOn(require('@/hooks/useFeedback'), 'useFeedback').mockReturnValue({
      showFeedbackModal: true,
      handleFeedbackClick: mockHandleFeedbackClick,
      closeFeedbackModal: jest.fn(),
      handleSubmitFeedback: jest.fn()
    });
    
    render(<DashboardNav />);
    
    // Find and click desktop feedback button 
    const feedbackButton = screen.getByText('Feedback');
    await act(async () => {
      fireEvent.click(feedbackButton);
    });
    
    // Verify feedback click handler was called
    expect(mockHandleFeedbackClick).toHaveBeenCalled();
    
    // Feedback modal should be visible
    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
  });

  test('handles feedback submission with user info', async () => {
    // Mock useFeedback to control state
    const mockHandleSubmitFeedback = jest.fn().mockResolvedValue(true);
    
    // Override the mock for this test only
    jest.spyOn(require('@/hooks/useFeedback'), 'useFeedback').mockReturnValue({
      showFeedbackModal: true,
      handleFeedbackClick: jest.fn(),
      closeFeedbackModal: jest.fn(),
      handleSubmitFeedback: mockHandleSubmitFeedback
    });
    
    render(<DashboardNav />);
    
    // Simulate auth with logged-in user
    await act(async () => {
      if (authStateCallback) {
        authStateCallback({
          uid: 'user123',
          email: 'test@example.com',
          displayName: 'Test User'
        } as User);
      }
    });
    
    // Submit feedback
    const submitButton = screen.getByTestId('submit-feedback');
    await act(async () => {
      fireEvent.click(submitButton);
    });
    
    // Verify handleSubmitFeedback was called with user ID
    expect(mockHandleSubmitFeedback).toHaveBeenCalledWith('Feedback text', 'suggestion', 'user123');
  });

  test('handles feedback submission with anonymous user', async () => {
    // Mock useFeedback to control state
    const mockHandleSubmitFeedback = jest.fn().mockResolvedValue(true);
    
    // Override the mock for this test only
    jest.spyOn(require('@/hooks/useFeedback'), 'useFeedback').mockReturnValue({
      showFeedbackModal: true,
      handleFeedbackClick: jest.fn(),
      closeFeedbackModal: jest.fn(),
      handleSubmitFeedback: mockHandleSubmitFeedback
    });
    
    render(<DashboardNav />);
    
    // Simulate null user (anonymous)
    await act(async () => {
      if (authStateCallback) {
        authStateCallback(null);
      }
    });
    
    // Submit feedback
    const submitButton = screen.getByTestId('submit-feedback');
    await act(async () => {
      fireEvent.click(submitButton);
    });
    
    // Verify handleSubmitFeedback was called with "anonymous"
    expect(mockHandleSubmitFeedback).toHaveBeenCalledWith('Feedback text', 'suggestion', 'anonymous');
  });

  test('mobile feedback button is displayed on small screens', async () => {
    // Mock a mobile viewport
    window.innerWidth = 600;
    
    render(<DashboardNav />);
    
    // Get all feedback buttons by role
    const feedbackButtons = screen.getAllByRole('button', { name: /provide feedback/i });
    
    // There should be at least one button
    expect(feedbackButtons.length).toBeGreaterThan(0);
    
    // Find the mobile button (the one in the mobile menu div)
    const mobileContainer = screen.getByText('Dashboard').closest('nav')?.querySelector('.flex.md\\:hidden');
    const mobileFeedbackButton = mobileContainer?.querySelector('button[aria-label="Provide feedback"]');
    
    // Verify it exists
    expect(mobileFeedbackButton).toBeInTheDocument();
    
    // The SVG icon should be visible
    expect(mobileFeedbackButton?.querySelector('svg')).toBeInTheDocument();
    
    // Check that this is indeed the mobile version without text
    const buttonText = mobileFeedbackButton?.textContent?.trim();
    expect(buttonText).toBe('');
  });
}); 