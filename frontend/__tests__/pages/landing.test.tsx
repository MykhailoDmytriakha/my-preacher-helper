import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import LandingPage from '@/(pages)/page';
import '@testing-library/jest-dom';

// Mock necessary components or hooks used by the landing page
jest.mock('@/components/landing/LoginOptions', () => () => <div data-testid="login-options">Mocked Login Options</div>);
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
    push: jest.fn(),
    replace: jest.fn(),
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
  beforeEach(async () => {
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

  // Add more checks for other essential elements like headers, footers, specific sections if applicable
}); 