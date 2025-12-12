import { render, screen, waitFor, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import React from 'react';

import ProtectedRoute from '@/components/ProtectedRoute';
import { useAuth } from '@/providers/AuthProvider';

// Mock useRouter
jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

// Mock useAuth
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(),
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

// Mock timers
jest.useFakeTimers();

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('ProtectedRoute', () => {
  const mockReplace = jest.fn();

  beforeEach(() => {
    mockUseRouter.mockReturnValue({
      replace: mockReplace,
    } as any);
    
    mockLocalStorage.getItem.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  it('should show loading spinner while authentication is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should render children when user is authenticated', async () => {
    const mockUser = {
      uid: 'test-uid',
      email: 'test@example.com',
    } as any;

    mockUseAuth.mockReturnValue({
      user: mockUser,
      loading: false,
      isAuthenticated: true,
    });

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Wait for the initial auth check timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should render children when guest user is present in localStorage', async () => {
    const guestUser = { uid: 'guest-uid', isAnonymous: true } as any;
    
    mockUseAuth.mockReturnValue({
      user: guestUser,
      loading: false,
      isAuthenticated: true,
    });

    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(guestUser));

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Wait for the initial auth check timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(screen.getByText('Protected Content')).toBeInTheDocument();
    });
  });

  it('should redirect to default route when no user and no guest data', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Wait for the initial auth check timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should redirect to custom route when specified', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <ProtectedRoute redirectTo="/login">
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Wait for the initial auth check timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/login');
    });
  });

  it('should show loading spinner when user is not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Should show loading spinner initially
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();

    // Wait for the initial auth check timer (1 second)
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });

    // After timer, should still show loading spinner (no auth data)
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('should handle auth check timer correctly', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <ProtectedRoute>
        <div>Protected Content</div>
      </ProtectedRoute>
    );

    // Initially should show loading spinner
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();

    // Before timer completes, should still show loading
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();

    // After timer completes, should redirect
    await act(async () => {
      jest.advanceTimersByTime(500);
    });

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });
}); 