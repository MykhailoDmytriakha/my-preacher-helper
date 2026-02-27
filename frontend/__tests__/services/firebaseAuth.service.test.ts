const mockSignInWithPopup = jest.fn();
const mockSignInAnonymously = jest.fn();
const mockSignOut = jest.fn();
const mockSetPersistence = jest.fn();
const mockGetAuth = jest.fn(() => ({ currentUser: null }));
const mockGoogleAuthProvider = jest.fn(() => ({ providerId: 'google.com' }));
const mockUpdateUserProfile = jest.fn();
const mockToastError = jest.fn();

describe('firebaseAuth.service', () => {
  const originalEnv = process.env;
  const originalDateNow = Date.now;

  const registerMocks = () => {
    jest.doMock('firebase/auth', () => ({
      getAuth: mockGetAuth,
      GoogleAuthProvider: function MockGoogleAuthProvider() {
        return mockGoogleAuthProvider();
      },
      signInWithPopup: mockSignInWithPopup,
      signOut: mockSignOut,
      signInAnonymously: mockSignInAnonymously,
      setPersistence: mockSetPersistence,
      browserLocalPersistence: 'browserLocalPersistence',
    }));

    jest.doMock('@/config/firebaseConfig', () => ({
      __esModule: true,
      default: { name: 'mock-app' },
    }));

    jest.doMock('@services/userSettings.service', () => ({
      updateUserProfile: mockUpdateUserProfile,
    }));

    jest.doMock('sonner', () => ({
      toast: {
        error: mockToastError,
      },
    }));
  };

  const loadModule = () =>
    jest.requireActual('../../app/services/firebaseAuth.service') as typeof import('@/services/firebaseAuth.service');

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.unmock('@/services/firebaseAuth.service');
    registerMocks();
    process.env = { ...originalEnv, NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'example.firebaseapp.com' };
    Date.now = jest.fn(() => new Date('2026-02-27T12:00:00.000Z').getTime());
    localStorage.clear();
  });

  afterAll(() => {
    process.env = originalEnv;
    Date.now = originalDateNow;
  });

  it('configures auth persistence on module load', async () => {
    loadModule();

    expect(mockGetAuth).toHaveBeenCalledWith({ name: 'mock-app' });
    expect(mockSetPersistence).toHaveBeenCalledWith({ currentUser: null }, 'browserLocalPersistence');
  });

  it('checkGuestExpiration returns true for non-anonymous users', async () => {
    const { checkGuestExpiration } = loadModule();

    expect(checkGuestExpiration({ isAnonymous: false } as any)).toBe(true);
  });

  it('checkGuestExpiration returns true while anonymous guest is still valid', async () => {
    const { checkGuestExpiration } = loadModule();

    const user = {
      isAnonymous: true,
      metadata: { creationTime: '2026-02-24T12:00:00.000Z' },
    } as any;

    expect(checkGuestExpiration(user)).toBe(true);
  });

  it('checkGuestExpiration returns false when anonymous guest has expired', async () => {
    const { checkGuestExpiration } = loadModule();

    const user = {
      isAnonymous: true,
      metadata: { creationTime: '2026-02-20T11:59:59.000Z' },
    } as any;

    expect(checkGuestExpiration(user)).toBe(false);
  });

  it('signInWithGoogle signs in and syncs profile fields', async () => {
    const { signInWithGoogle, auth } = loadModule();
    const user = {
      uid: 'google-user',
      email: 'google@example.com',
      displayName: 'Google User',
    };
    mockSignInWithPopup.mockResolvedValue({ user });

    const result = await signInWithGoogle();

    expect(mockSignInWithPopup).toHaveBeenCalledWith(auth, { providerId: 'google.com' });
    expect(mockUpdateUserProfile).toHaveBeenCalledWith('google-user', 'google@example.com', 'Google User');
    expect(result).toBe(user);
  });

  it('signInWithGoogle passes undefined profile fields when email or displayName are missing', async () => {
    const { signInWithGoogle } = loadModule();
    const user = {
      uid: 'google-user',
      email: null,
      displayName: null,
    };
    mockSignInWithPopup.mockResolvedValue({ user });

    await signInWithGoogle();

    expect(mockUpdateUserProfile).toHaveBeenCalledWith('google-user', undefined, undefined);
  });

  it('signInWithGoogle fails fast when auth domain is not configured', async () => {
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = '';
    const { signInWithGoogle } = loadModule();

    await expect(signInWithGoogle()).rejects.toThrow('Firebase auth domain not configured');
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });

  it('signInWithGoogle normalizes popup closed errors', async () => {
    const { signInWithGoogle } = loadModule();
    mockSignInWithPopup.mockRejectedValue(new Error('auth/popup-closed-by-user'));

    await expect(signInWithGoogle()).rejects.toThrow('Sign-in popup was closed');
  });

  it('signInWithGoogle normalizes popup blocked errors', async () => {
    const { signInWithGoogle } = loadModule();
    mockSignInWithPopup.mockRejectedValue(new Error('auth/popup-blocked'));

    await expect(signInWithGoogle()).rejects.toThrow('Sign-in popup was blocked by browser');
  });

  it('signInWithGoogle normalizes network errors', async () => {
    const { signInWithGoogle } = loadModule();
    mockSignInWithPopup.mockRejectedValue(new Error('network request failed'));

    await expect(signInWithGoogle()).rejects.toThrow('Network error during sign-in');
  });

  it('signInWithGoogle rethrows unknown errors unchanged', async () => {
    const { signInWithGoogle } = loadModule();
    const error = new Error('unexpected auth failure');
    mockSignInWithPopup.mockRejectedValue(error);

    await expect(signInWithGoogle()).rejects.toBe(error);
  });

  it('signInAsGuest stores guest data, syncs placeholder profile, and returns user', async () => {
    const { signInAsGuest } = loadModule();
    const user = {
      uid: 'guest123456',
      isAnonymous: true,
    };
    mockSignInAnonymously.mockResolvedValue({ user });

    const result = await signInAsGuest();
    const storedGuest = JSON.parse(localStorage.getItem('guestUser') || '{}');

    expect(mockSignInAnonymously).toHaveBeenCalled();
    expect(storedGuest.uid).toBe('guest123456');
    expect(storedGuest.creationTime).toMatch(/^2026-02-27T/);
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(
      'guest123456',
      'guest-guest1@guest.local',
      'Guest User guest1'
    );
    expect(result).toBe(user);
  });

  it('signInAsGuest shows toast and rethrows on failure', async () => {
    const { signInAsGuest } = loadModule();
    const error = new Error('guest sign-in failed');
    mockSignInAnonymously.mockRejectedValue(error);

    await expect(signInAsGuest()).rejects.toBe(error);
    expect(mockToastError).toHaveBeenCalledWith('Guest sign-in error');
  });

  it('logOut signs out successfully', async () => {
    const { logOut, auth } = loadModule();

    await logOut();

    expect(mockSignOut).toHaveBeenCalledWith(auth);
  });

  it('logOut rethrows sign out failures', async () => {
    const { logOut } = loadModule();
    const error = new Error('sign-out failed');
    mockSignOut.mockRejectedValue(error);

    await expect(logOut()).rejects.toBe(error);
  });
});
