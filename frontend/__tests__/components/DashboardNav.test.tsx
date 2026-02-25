import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import DashboardNav from '@/components/navigation/DashboardNav';

import { User } from 'firebase/auth';

const mockUsePathname = jest.fn(() => '/dashboard');

// Mock key dependencies
jest.mock('next/navigation', () => {
  const push = jest.fn();
  return {
    useRouter: () => ({
      push,
      replace: jest.fn(),
      refresh: jest.fn()
    }),
    usePathname: () => mockUsePathname(),
    useSearchParams: () => ({ get: () => null, toString: () => '' })
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
        'navigation.sermons': 'Sermons',
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

// Mock usePrepModeAccess hook
jest.mock('@/hooks/usePrepModeAccess', () => ({
  usePrepModeAccess: () => ({ hasAccess: true, loading: false })
}));

// Mock hasGroupsAccess service
jest.mock('@/services/userSettings.service', () => ({
  hasGroupsAccess: jest.fn().mockResolvedValue(true)
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
    mockUsePathname.mockReturnValue('/dashboard');
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

    // On dashboard page, the dynamic title should show "Sermons"
    const sermonsTitle = screen.getAllByText('Sermons');
    expect(sermonsTitle.length).toBeGreaterThan(0);

    // Use getAllByTestId instead of getByTestId to handle multiple matches
    const languageSwitchers = screen.getAllByTestId('language-switcher');
    expect(languageSwitchers.length).toBeGreaterThan(0);
  });

  test('shows dashboard text on non-dashboard pages', async () => {
    // Set auth state with logged-in user
    mockOldAuthState.user = {
      email: 'test@example.com',
      displayName: 'Test User',
      photoURL: 'https://example.com/photo.jpg'
    } as User;

    // Mock pathname to be a different page (not dashboard)
    mockUsePathname.mockReturnValue('/sermons');

    render(<DashboardNav />);

    // mock active item should be 'Sermons' since it matches dashboardMatcher
    // On non-dashboard pages that match sermons, dynamic link "Sermons" should be visible
    const sermonsTitle = screen.getAllByText('Sermons');
    expect(sermonsTitle.length).toBeGreaterThan(0);

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
    // Set initial pathname for mobile
    mockUsePathname.mockReturnValue('/dashboard');

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
    mockUsePathname.mockReturnValue('/dashboard/settings');

    // Re-render to trigger useEffect
    rerender(<DashboardNav />);

    // Mobile menu should now be closed due to path change
    await waitFor(() => {
      expect(screen.queryByTestId('mobile-menu')).not.toBeInTheDocument();
    });
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

  test('renders beta label for groups nav item', async () => {
    mockOldAuthState.user = { uid: 'user123' } as User;
    render(<DashboardNav />);
    // "Groups" nav item should have "Beta" badge
    await waitFor(() => {
      expect(screen.getByText('Beta')).toBeInTheDocument();
    });
  });

  test('renders sermon dropdown and closes on outside click', async () => {
    mockUsePathname.mockReturnValue('/sermons/123');
    render(<DashboardNav />);

    // Should show navigation dropdown button
    const navButton = screen.getByLabelText('Navigation menu');
    expect(navButton).toBeInTheDocument();

    // Click to open dropdown
    fireEvent.click(navButton);
    expect(screen.getByText('Settings')).toBeInTheDocument();

    // Click outside to close (simulated by manual click event if needed, but let's try direct)
    fireEvent.click(document.body);
    await waitFor(() => {
      expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    });
  });

  test('switches between modes in DashboardNav', async () => {
    const { useRouter } = require('next/navigation');
    const { push } = useRouter();

    mockUsePathname.mockReturnValue('/sermons/123');
    render(<DashboardNav />);

    // Should show mode toggle (since showWizardButton mock is true)
    // ModeToggle renders buttons for Classic and Prep
    const prepButton = screen.getByText('wizard.previewButton'); // default label or key
    fireEvent.click(prepButton);

    expect(push).toHaveBeenCalled();
  });
}); 
