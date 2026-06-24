import { COOKIE_LANG_KEY, DEFAULT_LANGUAGE } from '@/../../frontend/locales/constants';

const mockDb = { app: 'client-db' };
const mockDoc = jest.fn((_db: unknown, path: string, id: string) => ({ path, id }));
const mockGetDoc = jest.fn();
const mockSetDoc = jest.fn();
const mockGetClientDb = jest.fn(() => mockDb);
const mockFetch = jest.fn();

async function importServiceWithClientMocks() {
  jest.resetModules();
  process.env.NEXT_PUBLIC_API_BASE = '';

  jest.doMock('@/config/firebaseClientDb', () => ({
    getClientDb: mockGetClientDb,
  }));
  jest.doMock('firebase/firestore', () => ({
    doc: mockDoc,
    getDoc: mockGetDoc,
    setDoc: mockSetDoc,
  }));

  return import('@/services/userSettings.service');
}

const docSnap = (id: string, data: Record<string, unknown>, exists = true) => ({
  id,
  exists: () => exists,
  data: () => data,
});

describe('userSettings.service', () => {
  const clearLanguageCookie = () => {
    document.cookie = `${COOKIE_LANG_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  };

  const setNavigatorOnline = (online: boolean) => {
    Object.defineProperty(navigator, 'onLine', { value: online, configurable: true });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch as unknown as typeof fetch;
    clearLanguageCookie();
    setNavigatorOnline(true);
    mockSetDoc.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE;
    jest.dontMock('@/config/firebaseClientDb');
    jest.dontMock('firebase/firestore');
  });

  it('reads settings through the client SDK and returns null for empty or missing users', async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap('user1', { language: 'en', enablePrepMode: true }))
      .mockResolvedValueOnce(docSnap('missing', {}, false));

    const service = await importServiceWithClientMocks();
    await expect(service.getUserSettings('')).resolves.toBeNull();
    await expect(service.getUserSettings('user1')).resolves.toEqual({
      id: 'user1',
      language: 'en',
      enablePrepMode: true,
    });
    await expect(service.getUserSettings('missing')).resolves.toBeNull();

    expect(mockGetDoc).toHaveBeenCalledTimes(2);
    expect(mockDoc).toHaveBeenCalledWith(mockDb, 'users', 'user1');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps cookie fallback behavior for language reads', async () => {
    const service = await importServiceWithClientMocks();
    service.setLanguageCookie('uk');

    await expect(service.getUserLanguage('')).resolves.toBe('uk');
    expect(mockGetDoc).not.toHaveBeenCalled();

    setNavigatorOnline(false);
    await expect(service.getUserLanguage('user1')).resolves.toBe('uk');
    expect(mockGetDoc).not.toHaveBeenCalled();
  });

  it('syncs language from the client settings doc into the cookie', async () => {
    const service = await importServiceWithClientMocks();
    service.setLanguageCookie('ru');
    mockGetDoc.mockResolvedValueOnce(docSnap('user1', { language: 'en' }));

    await expect(service.getUserLanguage('user1')).resolves.toBe('en');

    expect(service.getCookieLanguage()).toBe('en');
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('persists a non-default cookie when the settings doc has no language', async () => {
    const service = await importServiceWithClientMocks();
    service.setLanguageCookie('uk');
    mockGetDoc.mockResolvedValueOnce(docSnap('user1', {}));

    await expect(service.getUserLanguage('user1')).resolves.toBe('uk');

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { language: 'uk' },
      { merge: true }
    );
  });

  it('updates language cookie immediately and writes authenticated online users through client SDK', async () => {
    const service = await importServiceWithClientMocks();
    await expect(service.updateUserLanguage('', 'uk')).resolves.toBeUndefined();
    expect(service.getCookieLanguage()).toBe('uk');
    expect(mockSetDoc).not.toHaveBeenCalled();

    await expect(service.updateUserLanguage('user1', 'ru')).resolves.toBeUndefined();
    expect(service.getCookieLanguage()).toBe('ru');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { language: 'ru' },
      { merge: true }
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('updates profile and initialization fields through client SDK with whitelist filtering', async () => {
    const service = await importServiceWithClientMocks();
    await expect(service.updateUserProfile('user1', 'user@example.com', 'Test User')).resolves.toBeUndefined();
    await expect(service.initializeUserSettings('user1', 'uk', 'user@example.com', 'Test User')).resolves.toBeUndefined();

    expect(mockSetDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { email: 'user@example.com', displayName: 'Test User' },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { language: 'uk', email: 'user@example.com', displayName: 'Test User' },
      { merge: true }
    );
    expect(service.getCookieLanguage()).toBe('uk');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('keeps no-op and offline guards for profile, language, and initialization helpers', async () => {
    const service = await importServiceWithClientMocks();
    await expect(service.updateUserProfile('', 'user@example.com')).resolves.toBeUndefined();
    await expect(service.updateUserProfile('user1')).resolves.toBeUndefined();

    setNavigatorOnline(false);
    await expect(service.updateUserLanguage('user1', 'ru')).resolves.toBeUndefined();
    await expect(service.updateUserProfile('user1', 'user@example.com')).resolves.toBeUndefined();
    await expect(service.initializeUserSettings('user1', 'uk')).resolves.toBeUndefined();

    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(service.getCookieLanguage()).toBe('uk');
  });

  it('updates feature flags and calendar preferences through client SDK', async () => {
    const service = await importServiceWithClientMocks();
    await service.updatePrepModeAccess('user1', true);
    await service.updateAudioGenerationAccess('user1', true);
    await service.updateShowAppVersion('user1', false);
    await service.updateGroupsAccess('user1', true);
    await service.updateStructurePreviewAccess('user1', true);
    await service.updateFirstDayOfWeek('user1', 'monday');

    expect(mockSetDoc).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { enablePrepMode: true },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { enableAudioGeneration: true },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { showAppVersion: false },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { enableGroups: true },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      5,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { enableStructurePreview: true },
      { merge: true }
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      6,
      expect.objectContaining({ path: 'users', id: 'user1' }),
      { firstDayOfWeek: 'monday' },
      { merge: true }
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces client SDK write failures for throwing update helpers', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockSetDoc.mockRejectedValueOnce(new Error('write failed'));

    const service = await importServiceWithClientMocks();
    await expect(service.updatePrepModeAccess('user1', true)).rejects.toThrow('write failed');
    expect(consoleSpy).toHaveBeenCalledWith('Error updating prep mode access:', expect.any(Error));

    consoleSpy.mockRestore();
  });

  it('evaluates access helpers from client settings and preserves offline/guest behavior', async () => {
    mockGetDoc
      .mockResolvedValueOnce(docSnap('user1', { enablePrepMode: true }))
      .mockResolvedValueOnce(docSnap('user1', { enableGroups: true }))
      .mockResolvedValueOnce(docSnap('user1', { enableStructurePreview: true }));

    const service = await importServiceWithClientMocks();
    await expect(service.hasPrepModeAccess('')).resolves.toBe(true);
    await expect(service.hasPrepModeAccess('user1')).resolves.toBe(true);
    await expect(service.hasGroupsAccess('user1')).resolves.toBe(true);
    await expect(service.hasStructurePreviewAccess('user1')).resolves.toBe(true);

    setNavigatorOnline(false);
    await expect(service.hasPrepModeAccess('user1')).resolves.toBe(false);
    await expect(service.hasGroupsAccess('user1')).resolves.toBe(false);
    await expect(service.hasStructurePreviewAccess('user1')).resolves.toBe(false);
  });

  it('falls back to the default language when no cookie is present', async () => {
    const service = await importServiceWithClientMocks();
    expect(service.getCookieLanguage()).toBe(DEFAULT_LANGUAGE);
  });
});
