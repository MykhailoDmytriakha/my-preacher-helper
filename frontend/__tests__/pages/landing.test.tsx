import React from 'react';
import { render, screen } from '@testing-library/react';
import LandingPage from '@/(pages)/page'; // Corrected import path
import '@testing-library/jest-dom';

// Mock necessary components or hooks used by the landing page
// Example: Mock LoginOptions if it makes external calls or uses complex state
jest.mock('@/components/landing/LoginOptions', () => () => <div data-testid="login-options">Mocked Login Options</div>);
jest.mock('@/components/landing/FeatureCards', () => () => <div data-testid="feature-cards">Mocked Feature Cards</div>);
jest.mock('@/components/navigation/LanguageSwitcher', () => () => <div data-testid="language-switcher">Mocked Language Switcher</div>);

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

// Mock the router
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
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

describe('Landing Page UI Smoke Test', () => {
  beforeEach(() => {
    render(<LandingPage />);
  });

  it('renders the main heading', () => {
    // Check for the main title
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain('landing.title');
  });

  it('renders the welcome heading', () => {
    // Check for the welcome heading
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toContain('landing.welcome');
  });

  it('renders the subtitle text', () => {
    // Check for the subtitle paragraph text
    const subtitle = screen.getByText('landing.subtitle');
    expect(subtitle).toBeInTheDocument();
  });

  it('renders the Login Options component area', () => {
    // Check if the mocked component is rendered
    expect(screen.getByTestId('login-options')).toBeInTheDocument();
  });

  it('renders the Feature Cards component area', () => {
    // Check if the mocked component is rendered
    expect(screen.getByTestId('feature-cards')).toBeInTheDocument();
  });

  it('renders the Language Switcher component area', () => {
    // Check if the mocked component is rendered
    expect(screen.getByTestId('language-switcher')).toBeInTheDocument();
  });

  // Add more checks for other essential elements like headers, footers, specific sections if applicable
}); 