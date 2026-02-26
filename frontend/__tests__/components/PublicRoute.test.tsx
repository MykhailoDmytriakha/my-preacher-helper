import { render, screen, waitFor } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import React from 'react';

import PublicRoute from '@/components/PublicRoute';
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

describe('PublicRoute', () => {
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
  });

  it('should show loading spinner while authentication is loading', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    });

    render(
      <PublicRoute>
        <div>Public Content</div>
      </PublicRoute>
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Public Content')).not.toBeInTheDocument();
  });

  it('should render children when user is not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    });

    mockLocalStorage.getItem.mockReturnValue(null);

    render(
      <PublicRoute>
        <div>Public Content</div>
      </PublicRoute>
    );

    await waitFor(() => {
      expect(screen.getByText('Public Content')).toBeInTheDocument();
    });
  });

  it('should redirect to default dashboard when user is authenticated', async () => {
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
      <PublicRoute>
        <div>Public Content</div>
      </PublicRoute>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/sermons');
    });

    expect(screen.queryByText('Public Content')).not.toBeInTheDocument();
  });

  it('should redirect to custom route when specified', async () => {
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
      <PublicRoute redirectTo="/custom-dashboard">
        <div>Public Content</div>
      </PublicRoute>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/custom-dashboard');
    });
  });

  it('should redirect when guest user is present in localStorage', async () => {
    const guestUser = { uid: 'guest-uid', isAnonymous: true } as any;
    
    mockUseAuth.mockReturnValue({
      user: guestUser,
      loading: false,
      isAuthenticated: true,
    });

    mockLocalStorage.getItem.mockReturnValue(JSON.stringify(guestUser));

    render(
      <PublicRoute>
        <div>Public Content</div>
      </PublicRoute>
    );

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith('/sermons');
    });

    expect(screen.queryByText('Public Content')).not.toBeInTheDocument();
  });

  it('should show loading spinner when user is authenticated', () => {
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
      <PublicRoute>
        <div>Public Content</div>
      </PublicRoute>
    );

    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument();
    expect(screen.queryByText('Public Content')).not.toBeInTheDocument();
  });
}); 