import { render, screen, waitFor, act } from '@testing-library/react';
import { onAuthStateChanged, User } from 'firebase/auth';
import React from 'react';

import { AuthProvider, useAuth } from '@/providers/AuthProvider';


// Mock Firebase auth
jest.mock('firebase/auth', () => ({
  onAuthStateChanged: jest.fn(),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: {},
}));

// Mock localStorage
const mockLocalStorage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
});

// Test component that uses useAuth
function TestComponent() {
  const { user, loading, isAuthenticated } = useAuth();
  
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
      <div data-testid="user">{user ? 'user-present' : 'no-user'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
    </div>
  );
}

const mockOnAuthStateChanged = onAuthStateChanged as jest.MockedFunction<typeof onAuthStateChanged>;

describe('AuthProvider', () => {
  let authStateCallback: ((user: User | null) => void) | null = null;
  let unsubscribeMock: jest.Mock;

  beforeEach(() => {
    authStateCallback = null;
    unsubscribeMock = jest.fn();
    
    mockOnAuthStateChanged.mockImplementation((_auth, callback) => {
      authStateCallback = callback as (user: User | null) => void;
      return unsubscribeMock;
    });
    
    mockLocalStorage.getItem.mockClear();
    mockLocalStorage.setItem.mockClear();
    mockLocalStorage.removeItem.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should provide initial loading state', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    expect(screen.getByTestId('loading')).toHaveTextContent('loading');
    expect(screen.getByTestId('user')).toHaveTextContent('no-user');
  });

  it('should update user state when Firebase auth state changes', async () => {
    const mockUser = {
      uid: 'test-uid',
      email: 'test@example.com',
      displayName: 'Test User',
    } as User;

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Simulate Firebase auth state change
    await act(async () => {
      if (authStateCallback) {
        authStateCallback(mockUser);
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      expect(screen.getByTestId('user')).toHaveTextContent('user-present');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
    });
  });

  it('should handle user logout', async () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Simulate logout
    await act(async () => {
      if (authStateCallback) {
        authStateCallback(null);
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      expect(screen.getByTestId('user')).toHaveTextContent('no-user');
    });
  });

  it('should check localStorage for guest user', async () => {
    const guestUser = {
      uid: 'guest-uid',
      isAnonymous: true,
    };

    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(guestUser));

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      if (authStateCallback) {
        authStateCallback(null);
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
    });
  });

  it('should clean up auth listener on unmount', () => {
    const { unmount } = render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    unmount();

    expect(unsubscribeMock).toHaveBeenCalled();
  });

  it('should render component without errors when properly wrapped', () => {
    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    // Should render without throwing
    expect(screen.getByTestId('loading')).toBeInTheDocument();
    expect(screen.getByTestId('user')).toBeInTheDocument();
    expect(screen.getByTestId('authenticated')).toBeInTheDocument();
  });
}); 
