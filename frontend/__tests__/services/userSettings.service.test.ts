import { requestUserSettings } from '@/services/userSettingsTransport.client';
import * as service from '@/services/userSettings.service';
import { __resetConnectivityForTests, reportServerReachable, reportServerUnreachable } from '@/utils/connectivity';
import { COOKIE_LANG_KEY } from '@locales/constants';

jest.mock('@/services/userSettingsTransport.client', () => ({ requestUserSettings: jest.fn() }));
const request = jest.mocked(requestUserSettings);
const online = (value: boolean) => Object.defineProperty(navigator, 'onLine', { value, configurable: true });

beforeEach(() => {
  jest.clearAllMocks();
  __resetConnectivityForTests();
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_ENABLED;
  delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
  document.cookie = `${COOKIE_LANG_KEY}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  online(true);
  request.mockResolvedValue(null);
});
afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; online(true); });

it('reads settings without loading browser Firestore', async () => {
  request.mockResolvedValue({ id: 'owner', userId: 'owner', language: 'en' });
  await expect(service.getUserSettings('')).resolves.toBeNull();
  await expect(service.getUserSettings('owner')).resolves.toEqual({ id: 'owner', userId: 'owner', language: 'en' });
  expect(request).toHaveBeenCalledTimes(1);
});

it('uses cookie immediately for guests and offline language reads', async () => {
  service.setLanguageCookie('uk');
  await expect(service.getUserLanguage('')).resolves.toBe('uk');
  online(false);
  reportServerUnreachable();
  await expect(service.getUserLanguage('owner')).resolves.toBe('uk');
  expect(request).not.toHaveBeenCalled();
});

/*
 * Whether the server answers decides, not the phone's flag (BUG-20261011-raw-phone-flag-in-read-paths):
 * an iPad back from the background keeps "offline" while requests already get through, and the
 * person lost the preparation mode and their language until the flag changed.
 */
it('reads access and language from the server when the phone says offline but the server answers', async () => {
  online(false);
  reportServerReachable();
  request.mockResolvedValue({ id: 'owner', userId: 'owner', language: 'ru', enablePrepMode: true, enableStructurePreview: true });

  await expect(service.hasPrepModeAccess('owner')).resolves.toBe(true);
  await expect(service.hasStructurePreviewAccess('owner')).resolves.toBe(true);
  await expect(service.getUserLanguage('owner')).resolves.toBe('ru');
});

// A request that did not reach, while the phone says "network", is not "no access" (review of the fix).
it('still reads access and language after a request that did not reach, while the phone says online', async () => {
  reportServerUnreachable();
  request.mockResolvedValue({ id: 'owner', userId: 'owner', language: 'ru', enablePrepMode: true, enableStructurePreview: true });
  await expect(service.hasPrepModeAccess('owner')).resolves.toBe(true);
  await expect(service.hasStructurePreviewAccess('owner')).resolves.toBe(true);
  await expect(service.getUserLanguage('owner')).resolves.toBe('ru');
});

it('does not ask while the phone says offline and nothing has reached the server', async () => {
  online(false);
  await expect(service.hasPrepModeAccess('owner')).resolves.toBe(false);
  await expect(service.hasStructurePreviewAccess('owner')).resolves.toBe(false);
  expect(request).not.toHaveBeenCalled();
});

it('updates the cookie from the server language and initializes a missing language', async () => {
  request.mockResolvedValueOnce({ id: 'owner', userId: 'owner', language: 'ru' }).mockResolvedValueOnce(null);
  await expect(service.getUserLanguage('owner')).resolves.toBe('ru');
  await service.getUserLanguage('owner');
  expect(request).toHaveBeenLastCalledWith('owner', { operation: 'bootstrap', patch: { language: 'ru' } });
});

it('routes authenticated public language changes through one bounded request', async () => {
  await service.updateUserLanguage('owner', 'ru');
  expect(service.getCookieLanguage()).toBe('ru');
  expect(request).toHaveBeenCalledWith('owner', { operation: 'language', patch: { language: 'ru' } });
});

it('bootstraps only supplied profile fields without passing a body owner', async () => {
  await service.updateUserProfile('owner', 'name@example.com', 'Name');
  expect(request).toHaveBeenLastCalledWith('owner', { operation: 'bootstrap', patch: { email: 'name@example.com', displayName: 'Name' } });
  await service.initializeUserSettings('owner', 'en');
  expect(request).toHaveBeenLastCalledWith('owner', { operation: 'bootstrap', patch: { language: 'en' } });
});

it('never starts a second offline queue for public bootstrap', async () => {
  online(false);
  await service.initializeUserSettings('owner', 'uk');
  await service.updateUserLanguage('owner', 'ru');
  expect(service.getCookieLanguage()).toBe('ru');
  expect(request).not.toHaveBeenCalled();
});

it('sends language and profile when the phone says offline but the server answers', async () => {
  online(false);
  reportServerReachable();
  await service.updateUserLanguage('owner', 'ru');
  await service.updateUserProfile('owner', 'name@example.com');
  await service.initializeUserSettings('owner', 'uk');
  expect(request).toHaveBeenCalledWith('owner', { operation: 'language', patch: { language: 'ru' } });
  expect(request).toHaveBeenCalledWith('owner', { operation: 'bootstrap', patch: { email: 'name@example.com' } });
  expect(request).toHaveBeenCalledWith('owner', { operation: 'bootstrap', patch: { language: 'uk' } });
});

it('fails closed for every old persisted settings mutation after activation', async () => {
  process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'users';
  const actions = [
    () => service.updatePrepModeAccess('owner', true),
    () => service.updateAudioGenerationAccess('owner', true),
    () => service.updateStructurePreviewAccess('owner', true),
    () => service.updateShowAppVersion('owner', true),
    () => service.updateGroupsAccess('owner', true),
    () => service.updateFirstDayOfWeek('owner', 'monday'),
    () => service.updateModelPreference('owner', { preferredProviderId: 'openai', preferredModelId: 'model' }),
    () => service.updateFunctionModelPreference('owner', { preferredText: { providerId: 'openai', modelId: 'model' } }),
  ];
  for (const action of actions) await expect(action()).rejects.toMatchObject({ code: 'data-engine-required' });
  expect(request).not.toHaveBeenCalled();
});

it('routes unconverted settings writes through the guarded server operation', async () => {
  await service.updateFirstDayOfWeek('owner', 'monday');
  expect(request).toHaveBeenCalledWith('owner', { operation: 'legacy', patch: { firstDayOfWeek: 'monday' } });
});
