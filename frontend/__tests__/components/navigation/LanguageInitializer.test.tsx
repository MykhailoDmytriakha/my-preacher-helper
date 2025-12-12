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

jest.mock('@/../../frontend/locales/getInitialLang', () => ({
  initializeLanguageFromDB: () => mockInitializeLanguageFromDB()
}));

jest.mock('@/services/userSettings.service', () => ({
  getCookieLanguage: () => mockGetCookieLanguage()
}));

describe('LanguageInitializer Component', () => {
  beforeEach(() => {
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

  test('renders nothing', () => {
    const { container } = render(<LanguageInitializer />);
    expect(container).toBeEmptyDOMElement();
  });

  test('initializes language from DB when user is authenticated', async () => {
    // Mock authenticated user
    mockAuthState.user = { uid: 'test-user-id' } as any;
    mockAuthState.isAuthenticated = true;
    mockAuthState.loading = false;
    
    render(<LanguageInitializer />);
    
    await waitFor(() => {
      expect(mockInitializeLanguageFromDB).toHaveBeenCalled();
      expect(mockGetCookieLanguage).not.toHaveBeenCalled();
    });
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

  test('does nothing while authentication is loading', async () => {
    // Mock loading state
    mockAuthState.user = null;
    mockAuthState.loading = true;
    mockAuthState.isAuthenticated = false;
    
    render(<LanguageInitializer />);
    
    // Wait a bit to ensure no async operations start
    await new Promise(resolve => setTimeout(resolve, 100));
    
    expect(mockInitializeLanguageFromDB).not.toHaveBeenCalled();
    expect(mockGetCookieLanguage).not.toHaveBeenCalled();
    expect(mockChangeLanguage).not.toHaveBeenCalled();
  });

  test('handles errors when initializing from DB', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock authenticated user
    mockAuthState.user = { uid: 'test-user-id' } as any;
    mockAuthState.isAuthenticated = true;
    mockAuthState.loading = false;
    
    // Mock DB initialization error
    mockInitializeLanguageFromDB.mockRejectedValueOnce(new Error('DB init failed'));
    
    render(<LanguageInitializer />);
    
    // Wait for the async operation to complete
    await waitFor(() => {
      expect(mockInitializeLanguageFromDB).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to initialize language from DB:'),
        expect.any(Error)
      );
    });
    
    consoleSpy.mockRestore();
  });
}); 