import { render, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import LanguageInitializer from '@/components/navigation/LanguageInitializer';

// Create mock functions
const mockChangeLanguage = jest.fn().mockResolvedValue(undefined);
const mockInitializeLanguageFromDB = jest.fn().mockResolvedValue(undefined);
const mockGetCookieLanguage = jest.fn().mockReturnValue('en');

// Mock AuthProvider
let mockAuthState = {
  user: null,
  loading: false,
  isAuthenticated: false
};

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => mockAuthState
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: {
      language: 'en',
      changeLanguage: mockChangeLanguage
    }
  })
}));

jest.mock('@locales/getInitialLang', () => ({
  initializeLanguageFromDB: () => mockInitializeLanguageFromDB()
}));

jest.mock('@/services/userSettings.service', () => ({
  getCookieLanguage: () => mockGetCookieLanguage()
}));

describe('LanguageInitializer Component', () => {
  const previousEnabled = process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  const previousCollections = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  afterEach(() => {
    if (previousEnabled === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    else process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = previousEnabled;
    if (previousCollections === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previousCollections;
  });
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    jest.clearAllMocks();
    mockAuthState = {
      user: null,
      loading: false,
      isAuthenticated: false
    };
    mockChangeLanguage.mockClear();
    mockInitializeLanguageFromDB.mockClear();
    mockGetCookieLanguage.mockReturnValue('en');
  });

  test('applies the device language right after hydration, without waiting for the account', async () => {
    // BUG-20260902-ssr-renders-english-labels-then-swaps: the page hydrates in the default
    // language (locales/i18n.ts), and the switch must not wait on sign-in.
    mockAuthState.loading = true;
    mockGetCookieLanguage.mockReturnValue('ru');

    render(<LanguageInitializer />);

    await waitFor(() => expect(mockChangeLanguage).toHaveBeenCalledWith('ru'));
    expect(mockChangeLanguage).toHaveBeenCalledTimes(1);
  });

  test('does not start a competing database language read when users are engine-owned by default', async () => {
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    mockAuthState.user = { uid: 'owner-a' } as any;
    mockAuthState.isAuthenticated = true;
    // The root layout mounts this initializer outside UserSettingsProvider.
    const view = render(<LanguageInitializer />);
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();

    mockAuthState.user = { uid: 'owner-b' } as any;
    view.rerender(<LanguageInitializer />);
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();

    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockGetCookieLanguage.mockReturnValue('ru');
    view.rerender(<LanguageInitializer />);
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    // The common hook catches the guest language even when its subscriber commits later.
    await waitFor(() => expect(mockChangeLanguage).toHaveBeenCalledWith('ru'));
  });

  test('also defers signed-in initialization when the global engine switch is enabled', () => {
    process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED = 'true';
    mockAuthState.user = { uid: 'owner' } as any;
    mockAuthState.isAuthenticated = true;
    render(<LanguageInitializer />);
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
  });

  test('renders nothing', () => {
    const { container } = render(<LanguageInitializer />);
    expect(container).toBeEmptyDOMElement();
  });

  test('does not initialize authenticated language through the legacy database path', async () => {
    mockAuthState.user = { uid: 'test-user-id' } as any;
    mockAuthState.isAuthenticated = true;
    mockAuthState.loading = false;
    
    render(<LanguageInitializer />);
    
    await waitFor(() => expect(mockGetCookieLanguage).toHaveBeenCalled());
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  test('uses cookie language for guest users', async () => {
    // Mock different cookie language
    mockGetCookieLanguage.mockReturnValue('ru');
    
    // Set unauthenticated state
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockAuthState.loading = false;
    
    render(<LanguageInitializer />);
    
    // Wait for effects to complete
    await waitFor(() => {
      expect(mockGetCookieLanguage).toHaveBeenCalled();
    });
    
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    
    // Since language is different, changeLanguage should be called
    expect(mockChangeLanguage).toHaveBeenCalledWith('ru');
  });

  test('does not change language when cookie language matches current language', async () => {
    // Mock cookie language same as current
    mockGetCookieLanguage.mockReturnValue('en');
    
    // Set unauthenticated state
    mockAuthState.user = null;
    mockAuthState.isAuthenticated = false;
    mockAuthState.loading = false;
    
    render(<LanguageInitializer />);
    
    // Wait for effects to complete
    await waitFor(() => {
      expect(mockGetCookieLanguage).toHaveBeenCalled();
    });
    
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    
    // Since languages match, changeLanguage should not be called
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  test('starts no account path while authentication is loading', () => {
    // Mock loading state
    mockAuthState.user = null;
    mockAuthState.loading = true;
    mockAuthState.isAuthenticated = false;
    
    render(<LanguageInitializer />);

    // The loading guard is synchronous inside the mounted effect; no wall-clock
    // sleep is needed to prove that none of the account paths starts. The switch after
    // hydration reads the cookie, which matches the language already in use here.
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  test('does not report a legacy database initialization failure for engine-owned settings', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthState.user = { uid: 'test-user-id' } as any;
    mockAuthState.isAuthenticated = true;
    mockAuthState.loading = false;
    mockInitializeLanguageFromDB.mockRejectedValueOnce(new Error('DB init failed'));

    render(<LanguageInitializer />);

    await waitFor(() => expect(mockGetCookieLanguage).toHaveBeenCalled());
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
