import { renderHook } from '@testing-library/react';

import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useAuth } from '@/providers/AuthProvider';
import { auth } from '@/services/firebaseAuth.service';

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mutableAuth = auth as { currentUser: unknown };

describe('useResolvedUid', () => {
  const defaultAuthUser = auth.currentUser;

  beforeEach(() => {
    window.localStorage.clear();
    mutableAuth.currentUser = defaultAuthUser;
  });

  it('returns auth user uid when available', () => {
    mockUseAuth.mockReturnValue({
      user: { uid: 'auth-user' } as any,
      loading: false,
      isAuthenticated: true,
    });

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBe('auth-user');
    expect(result.current.isAuthLoading).toBe(false);
  });

  it('waits for the provider to publish restored Firebase identity', () => {
    mutableAuth.currentUser = { uid: 'firebase-user' } as any;
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBeUndefined();
    expect(result.current.isAuthLoading).toBe(true);
  });

  it('ignores an obsolete guest mirror during Firebase restoration', () => {
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-1' }));
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBeUndefined();
    expect(result.current.isAuthLoading).toBe(true);
  });

  it('returns loading state when auth is loading and no uid available', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBeUndefined();
    expect(result.current.isAuthLoading).toBe(true);
  });

  it('ignores an obsolete guest mirror after Firebase signed out', () => {
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-2' }));
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBeUndefined();
    expect(result.current.isAuthLoading).toBe(false);
  });

  it('handles invalid guest data gracefully', () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    window.localStorage.setItem('guestUser', 'invalid-json');
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBeUndefined();
    expect(result.current.isAuthLoading).toBe(false);
    expect(errorSpy).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
