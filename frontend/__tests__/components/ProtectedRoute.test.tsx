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

const mockUseRouter = useRouter as jest.MockedFunction<typeof useRouter>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

describe('ProtectedRoute', () => {
  const mockReplace = jest.fn();

  beforeEach(() => {
    jest.useFakeTimers();
    mockLocalStorage.getItem.mockReset();
    mockUseRouter.mockReturnValue({
      replace: mockReplace,
    } as any);
    
    mockLocalStorage.getItem.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('shows a restored authenticated page without waiting for a timer', () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'test-uid' } as any, loading: false, isAuthenticated: true });
    render(<ProtectedRoute><div>Cached page</div></ProtectedRoute>);
    expect(screen.getByText('Cached page')).toBeInTheDocument();
    expect(screen.queryByTestId('loading-spinner')).not.toBeInTheDocument();
  });

  it('opens the page as soon as authentication restoration completes', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, isAuthenticated: false });
    const { rerender } = render(<ProtectedRoute><div>Cached page</div></ProtectedRoute>);
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
    mockUseAuth.mockReturnValue({ user: { uid: 'test-uid' } as any, loading: false, isAuthenticated: true });
    rerender(<ProtectedRoute><div>Cached page</div></ProtectedRoute>);
    expect(screen.getByText('Cached page')).toBeInTheDocument();
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

    // No restored account: the page stays hidden.
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
  });

  it('keeps the page hidden while Firebase is restoring even after time has passed', () => {
    mockUseAuth.mockReturnValue({ user: null, loading: true, isAuthenticated: false });
    mockLocalStorage.getItem.mockReturnValue(null);
    render(<ProtectedRoute><div>Protected Content</div></ProtectedRoute>);
    act(() => { jest.advanceTimersByTime(10000); });
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('hides the previous page as soon as the account signs out', () => {
    mockUseAuth.mockReturnValue({ user: { uid: 'test-uid' } as any, loading: false, isAuthenticated: true });
    mockLocalStorage.getItem.mockReturnValue(null);
    const { rerender } = render(<ProtectedRoute><div>Protected Content</div></ProtectedRoute>);
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    mockUseAuth.mockReturnValue({ user: null, loading: false, isAuthenticated: false });
    rerender(<ProtectedRoute><div>Protected Content</div></ProtectedRoute>);
    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
