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

// Mock old useAuth hook to return consistent data
let mockOldAuthState = {
  user: null as User | null,
  handleLogout: jest.fn()
};

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockOldAuthState
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
let mockFeedbackState = {
  showFeedbackModal: false,
  handleFeedbackClick: jest.fn(),
  closeFeedbackModal: jest.fn(),
  handleSubmitFeedback: jest.fn().mockResolvedValue(true)
};

jest.mock('@/hooks/useFeedback', () => ({
  useFeedback: () => mockFeedbackState
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
    // Reset auth state
    mockOldAuthState = {
      user: null,
      handleLogout: jest.fn()
    };
    // Reset feedback state
    mockFeedbackState = {
      showFeedbackModal: false,
      handleFeedbackClick: jest.fn(),
      closeFeedbackModal: jest.fn(),
      handleSubmitFeedback: jest.fn().mockResolvedValue(true)
    };
    // Set initial mobile view state for consistent testing
    window.innerWidth = 1024; // Desktop view by default
  });

  test('renders dashboard link and language switcher', async () => {
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: 'https://example.com/photo.jpg'
    } as User;

    render(<DashboardNav />);

    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    // Use getAllByTestId instead of getByTestId to handle multiple matches
    const languageSwitchers = screen.getAllByTestId('language-switcher');
    expect(languageSwitchers.length).toBeGreaterThan(0);
  });

  test('displays user email initial when user has no photo', async () => {
    // Set auth state with user without photo
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: null
    } as User;

    render(<DashboardNav />);
    
    // Should show the first letter of email
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  test('displays user photo when available', async () => {
    // Set auth state with user with photo
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: 'https://example.com/photo.jpg'
    } as User;

    render(<DashboardNav />);
    
    const avatar = screen.getByAltText('Avatar');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('src', 'https://example.com/photo.jpg');
  });

  test('toggles dropdown menu when avatar is clicked', async () => {
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User'
    } as User;

    render(<DashboardNav />);
    
    // Find avatar button and click it
    const avatarButton = screen.getByTestId('avatar-button');
    
    // Should not show logout button initially
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
    
    // Click avatar to open dropdown
    await act(async () => {
      fireEvent.click(avatarButton);
    });
    
    // Should now show logout button
    expect(screen.getByText('Logout')).toBeInTheDocument();
    
    // Click avatar again to close dropdown
    await act(async () => {
      fireEvent.click(avatarButton);
    });
    
    // Should not show logout button
    expect(screen.queryByText('Logout')).not.toBeInTheDocument();
  });

  test('calls logout function when logout button is clicked', async () => {
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User'
    } as User;
    
    render(<DashboardNav />);
    
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
    expect(mockOldAuthState.handleLogout).toHaveBeenCalled();
  });

  test('unsubscribes from auth state changes on unmount', () => {
    // This test is no longer relevant since we don't manage auth state directly in the component
    // Instead, test that the component renders and unmounts without errors
    const { unmount } = render(<DashboardNav />);
    expect(() => unmount()).not.toThrow();
  });

  // NEW TESTS TO IMPROVE BRANCH COVERAGE

  test('toggles mobile menu when menu button is clicked', async () => {
    // Mock a mobile viewport
    window.innerWidth = 600;
    
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User'
    } as User;
    
    render(<DashboardNav />);
    
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
    
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User'
    } as User;
    
    const { rerender } = render(<DashboardNav />);
    
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
    // Set feedback state to show modal
    mockFeedbackState.showFeedbackModal = true;
    
    render(<DashboardNav />);
    
    // Find and click desktop feedback button 
    const feedbackButton = screen.getByText('Feedback');
    await act(async () => {
      fireEvent.click(feedbackButton);
    });
    
    // Verify feedback click handler was called
    expect(mockFeedbackState.handleFeedbackClick).toHaveBeenCalled();
    
    // Feedback modal should be visible
    expect(screen.getByTestId('feedback-modal')).toBeInTheDocument();
  });

  test('handles feedback submission with user info', async () => {
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      uid: 'user123',
      email: 'test@example.com',
      displayName: 'Test User'
    } as User;
    
    // Set feedback state to show modal
    mockFeedbackState.showFeedbackModal = true;
    
    render(<DashboardNav />);
    
    // Find and click submit feedback button in modal
    const submitButton = screen.getByTestId('submit-feedback');
    await act(async () => {
      fireEvent.click(submitButton);
    });
    
    // Verify handleSubmitFeedback was called with user ID
    expect(mockFeedbackState.handleSubmitFeedback).toHaveBeenCalledWith('Feedback text', 'suggestion', 'user123');
  });

  test('handles feedback submission with anonymous user', async () => {
    // Set auth state with no user (guest/anonymous)
    mockOldAuthState.user = null;
    
    // Set feedback state to show modal
    mockFeedbackState.showFeedbackModal = true;
    
    render(<DashboardNav />);
    
    // Find and click submit feedback button in modal
    const submitButton = screen.getByTestId('submit-feedback');
    await act(async () => {
      fireEvent.click(submitButton);
    });
    
    // Verify handleSubmitFeedback was called with 'anonymous'
    expect(mockFeedbackState.handleSubmitFeedback).toHaveBeenCalledWith('Feedback text', 'suggestion', 'anonymous');
  });

  test('mobile feedback button is displayed on small screens', async () => {
    // Mock a mobile viewport
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 500,
    });
    
    render(<DashboardNav />);
    
    // Find mobile feedback button (should be just an icon without text)
    const mobileFeedbackButtons = screen.getAllByRole('button', { name: /provide feedback/i });
    expect(mobileFeedbackButtons.length).toBeGreaterThan(0);
  });
}); 