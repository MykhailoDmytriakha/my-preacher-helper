import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import React from 'react';

import LandingPage from '@/(pages)/page';
import '@testing-library/jest-dom';
import { signInWithGoogle } from '@/services/firebaseAuth.service';

const mockPush = jest.fn();
const mockReplace = jest.fn();

// Mock necessary components or hooks used by the landing page
jest.mock('@/components/landing/LoginOptions', () => ({
  onGoogleLogin,
  onTestLogin,
}: {
  onGoogleLogin: () => void;
  onTestLogin: () => void;
}) => (
  <div data-testid="login-options">
    <button type="button" onClick={onGoogleLogin}>Mock Google Login</button>
    <button type="button" onClick={onTestLogin}>Mock Test Login</button>
  </div>
));
jest.mock('@/components/landing/FeatureCards', () => () => <div data-testid="feature-cards">Mocked Feature Cards</div>);
jest.mock('@/components/navigation/LanguageSwitcher', () => () => <div data-testid="language-switcher">Mocked Language Switcher</div>);

// Mock PublicRoute
jest.mock('@/components/PublicRoute', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);

// Mock the useAuth hook
jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    loginWithGoogle: jest.fn(),
    loginAsGuest: jest.fn(),
    loginWithEmailAndPassword: jest.fn()
  }),
}));

// Mock the new AuthProvider useAuth
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: null,
    loading: false,
    isAuthenticated: false,
  }),
}));

// Mock the router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: mockReplace,
  }),
}));

// Mock i18n
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key, // Simple mock return the key
    i18n: {
      language: 'en',
      changeLanguage: jest.fn()
    }
  }),
}));

// Mock locales/i18n
jest.mock('@locales/i18n', () => ({}), { virtual: true });

// Mock Firebase auth service
jest.mock('@/services/firebaseAuth.service', () => ({
  signInWithGoogle: jest.fn(),
  signInAsGuest: jest.fn(),
  auth: {},
}));

// Mock Firebase auth
jest.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: jest.fn(),
}));

describe('Landing Page UI Smoke Test', () => {
  const mockSignInWithGoogle = signInWithGoogle as jest.MockedFunction<typeof signInWithGoogle>;
  const mockSignInWithEmailAndPassword = signInWithEmailAndPassword as jest.MockedFunction<typeof signInWithEmailAndPassword>;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockSignInWithGoogle.mockResolvedValue(null);
    mockSignInWithEmailAndPassword.mockResolvedValue({} as Awaited<ReturnType<typeof signInWithEmailAndPassword>>);

    render(<LandingPage />);
    // Wait for any potential loading states to resolve
    await waitFor(() => {
      expect(screen.queryByRole('progressbar', { hidden: true })).not.toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('renders the main heading', async () => {
    // Page has multiple h1 (hero + header); assert at least one contains the key
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings.some((h) => h.textContent?.includes('landing.title'))).toBe(true);
    });
  });

  it('renders the welcome text', async () => {
    // Welcome text lives in a badge/span, not necessarily an h2
    await waitFor(() => {
      expect(screen.getByText('landing.welcome')).toBeInTheDocument();
    });
  });

  it('renders the subtitle text', async () => {
    // Check for the subtitle paragraph text
    await waitFor(() => {
      const subtitle = screen.getByText('landing.subtitle');
      expect(subtitle).toBeInTheDocument();
    });
  });

  it('renders the Login Options component area', async () => {
    // Check if the mocked component is rendered
    await waitFor(() => {
      expect(screen.getByTestId('login-options')).toBeInTheDocument();
    });
  });

  it('renders the Feature Cards component area', async () => {
    // Check if the mocked component is rendered
    await waitFor(() => {
      expect(screen.getByTestId('feature-cards')).toBeInTheDocument();
    });
  });

  it('renders the Language Switcher component area', async () => {
    // Check if the mocked component is rendered
    await waitFor(() => {
      expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
    });
  });

  it('routes Google login to the dashboard', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mock Google Login' }));

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  it('routes test login to the dashboard', async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Mock Test Login' }));

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        {},
        'testuser@example.com',
        'TestPassword123'
      );
      expect(mockPush).toHaveBeenCalledWith('/dashboard');
    });
  });

  // Add more checks for other essential elements like headers, footers, specific sections if applicable
});
