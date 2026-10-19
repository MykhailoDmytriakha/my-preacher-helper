import { act, render, renderHook, screen } from '@testing-library/react';
import type { User } from 'firebase/auth';

import ProtectedRoute from '@/components/ProtectedRoute';
import PublicRoute from '@/components/PublicRoute';
import { useAuth as useAuthActions } from '@/hooks/useAuth';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useAuth } from '@/providers/AuthProvider';
import { resolveOwnerUid } from '@/utils/queryKeys';

let mockFirebaseUser: User | null = null;
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockRefresh = jest.fn();
const mockGoogle = jest.fn();
const mockGuest = jest.fn();
const mockLogout = jest.fn();
const mockChangeLanguage = jest.fn();

jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: mockReplace, push: mockPush, refresh: mockRefresh }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { get currentUser() { return mockFirebaseUser; } },
  signInWithGoogle: (...args: unknown[]) => mockGoogle(...args),
  signInAsGuest: (...args: unknown[]) => mockGuest(...args),
  logOut: (...args: unknown[]) => mockLogout(...args),
}));
jest.mock('@services/userSettings.service', () => ({ updateUserProfile: jest.fn() }));
jest.mock('@locales/useTranslation', () => ({ useTranslation: () => ({ i18n: { changeLanguage: mockChangeLanguage } }) }));

const user = (uid: string, isAnonymous = false) => ({ uid, isAnonymous }) as User;
const identity = (value: User | null, loading = false) => jest.mocked(useAuth).mockReturnValue({ user: value, loading, isAuthenticated: Boolean(value) });
const finishOldGracePeriod = () => act(() => jest.advanceTimersByTime(1100));

// BUG-20260810-auth-mirrors-in-localstorage: storage can retain records after Firebase has signed out.
describe('one Firebase identity for the application', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.clear();
    mockFirebaseUser = null;
    identity(null);
    mockChangeLanguage.mockResolvedValue(undefined);
    mockLogout.mockResolvedValue(undefined);
  });
  afterEach(() => { jest.restoreAllMocks(); jest.clearAllTimers(); jest.useRealTimers(); });

  it('redirects a completed sign-out even if a Firebase-looking key remains', () => {
    localStorage.setItem('firebase:authUser:orphan:[DEFAULT]', '{}');
    render(<ProtectedRoute><p>Private words</p></ProtectedRoute>);
    finishOldGracePeriod();
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(screen.queryByText('Private words')).not.toBeInTheDocument();
  });

  it('does not open a private page from an obsolete guest mirror', () => {
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    render(<ProtectedRoute><p>Private words</p></ProtectedRoute>);
    finishOldGracePeriod();
    expect(screen.queryByText('Private words')).not.toBeInTheDocument();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('keeps sign-in available after Firebase signed out despite an obsolete mirror', () => {
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    render(<PublicRoute><p>Sign in</p></PublicRoute>);
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it.each([true, false])('does not resolve the previous owner from storage while loading=%s', loading => {
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    identity(null, loading);
    const { result } = renderHook(() => useResolvedUid());
    expect(result.current).toEqual({ uid: undefined, isAuthLoading: loading });
  });

  it('waits for the provider instead of publishing a second provisional identity', () => {
    mockFirebaseUser = user('sdk-user');
    identity(null, true);
    const { result, rerender } = renderHook(() => useResolvedUid());
    expect(result.current).toEqual({ uid: undefined, isAuthLoading: true });
    identity(mockFirebaseUser);
    rerender();
    expect(result.current).toEqual({ uid: 'sdk-user', isAuthLoading: false });
  });

  it('does not invent an action owner after the SDK has signed out', () => {
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    expect(resolveOwnerUid()).toBeUndefined();
  });

  it('uses the real SDK owner for an action, including an existing anonymous session', () => {
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    mockFirebaseUser = user('current-guest', true);
    expect(resolveOwnerUid()).toBe('current-guest');
  });

  it('opens a restored existing anonymous session without an arbitrary extra timer', () => {
    identity(user('current-guest', true));
    render(<ProtectedRoute><p>Guest work</p></ProtectedRoute>);
    expect(screen.getByText('Guest work')).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('does not infer sign-out from elapsed time during Firebase restoration', () => {
    identity(null, true);
    const view = render(<ProtectedRoute><p>Restored work</p></ProtectedRoute>);
    act(() => jest.advanceTimersByTime(10000));
    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.queryByText('Restored work')).not.toBeInTheDocument();
    identity(user('restored-owner'));
    view.rerender(<ProtectedRoute><p>Restored work</p></ProtectedRoute>);
    expect(screen.getByText('Restored work')).toBeInTheDocument();
  });

  it.each(['google', 'guest'] as const)('a successful %s sign-in does not depend on saving an extra mirror', async kind => {
    const signedIn = user('existing-session', kind === 'guest');
    mockGoogle.mockResolvedValue(signedIn);
    mockGuest.mockResolvedValue(signedIn);
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage refused mirror'); });
    const { result } = renderHook(() => useAuthActions());
    let answer: User | null | undefined;
    await act(async () => { answer = await (kind === 'google' ? result.current.loginWithGoogle() : result.current.loginAsGuest()); });
    expect(answer).toBe(signedIn);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('a completed SDK sign-out still reaches sign-in when legacy mirror cleanup would fail', async () => {
    const removeItem = jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Storage refused mirror cleanup'); });
    const { result } = renderHook(() => useAuthActions());
    await act(async () => result.current.handleLogout());
    expect(mockLogout).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/');
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
  });
});
