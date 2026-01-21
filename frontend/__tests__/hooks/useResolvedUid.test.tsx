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

  it('returns firebase auth uid while auth is loading', () => {
    mutableAuth.currentUser = { uid: 'firebase-user' } as any;
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBe('firebase-user');
    expect(result.current.isAuthLoading).toBe(false);
  });

  it('returns guest uid during auth loading when stored', () => {
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-1' }));
    mockUseAuth.mockReturnValue({
      user: null,
      loading: true,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBe('guest-1');
    expect(result.current.isAuthLoading).toBe(false);
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

  it('returns guest uid after auth resolves without user', () => {
    window.localStorage.setItem('guestUser', JSON.stringify({ uid: 'guest-2' }));
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      isAuthenticated: false,
    } as any);

    const { result } = renderHook(() => useResolvedUid());

    expect(result.current.uid).toBe('guest-2');
    expect(result.current.isAuthLoading).toBe(false);
  });

  it('handles invalid guest data gracefully', () => {
    global.__CONSOLE_OVERRIDDEN_BY_TEST__ = true;
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
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });
});
