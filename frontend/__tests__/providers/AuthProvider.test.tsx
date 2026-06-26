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

  it('treats an anonymous (guest) Firebase user as authenticated', async () => {
    const guestUser = { uid: 'guest-uid', isAnonymous: true } as User;

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(guestUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('user-present');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
    });
  });

  it('signs out cleanly even if a stale guestUser cache lingers (no phantom resurrection)', async () => {
    // handleLogout removes `guestUser` only AFTER logOut() resolves, so Firebase
    // fires onAuthStateChanged(null) while the cache is still present. The
    // provider must NOT re-authenticate the just-logged-out user from that cache.
    mockLocalStorage.getItem.mockReturnValue(JSON.stringify({ uid: 'stale-uid' }));
    const realUser = { uid: 'real-uid' } as User;

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(realUser);
    });
    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('user-present');
    });

    await act(async () => {
      authStateCallback?.(null);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('no-user');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
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

  it('does not clear a valid session when another tab fires a storage event', async () => {
    const mockUser = { uid: 'test-uid', email: 'test@example.com' } as User;

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(mockUser);
    });

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('user-present');
    });

    // Another tab removes the legacy custom mirror key. The provider must ignore
    // cross-tab storage events — Firebase's own onAuthStateChanged is the sole
    // authority for sign-out — so the valid session here stays intact.
    await act(async () => {
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'firebase:authUser', oldValue: '{}', newValue: null })
      );
    });

    expect(screen.getByTestId('user')).toHaveTextContent('user-present');
    expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
  });

  it('does not write a custom auth mirror to localStorage on sign-in', async () => {
    const mockUser = { uid: 'test-uid' } as User;

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    );

    await act(async () => {
      authStateCallback?.(mockUser);
    });

    expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
      'firebase:authUser',
      expect.anything()
    );
  });
});
