import { requestUserSettings } from '@/services/userSettingsTransport.client';
import { requestOwnerJson } from '@/services/ownerHttpTransport.client';
import { resolveOwnerUid } from '@/utils/queryKeys';

jest.mock('@/services/ownerHttpTransport.client', () => ({
  requestOwnerJson: jest.fn(), accountChangedError: () => Object.assign(new Error('Account changed'), { code: 'unauthenticated' }),
}));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn() }));
const request = jest.mocked(requestOwnerJson);
const owner = jest.mocked(resolveOwnerUid);
beforeEach(() => { jest.clearAllMocks(); owner.mockReturnValue('owner'); request.mockResolvedValue({ status: 200, value: { settings: { id: 'owner', language: 'en' } } }); });

it('uses the shared bounded authenticated transport without permitting conflict responses', async () => {
  await expect(requestUserSettings('owner')).resolves.toEqual({ id: 'owner', language: 'en' });
  expect(request).toHaveBeenCalledWith('/api/me/settings', expect.objectContaining({ method: 'GET', answerStatuses: [] }));
});

it('rejects mismatched owners before requesting or exposing a response', async () => {
  await expect(requestUserSettings('other')).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(request).not.toHaveBeenCalled();
  owner.mockReturnValueOnce('owner').mockReturnValueOnce('other');
  await expect(requestUserSettings('owner')).rejects.toMatchObject({ code: 'unauthenticated' });
});

it('makes only one mutation request and propagates a timeout without a replay', async () => {
  request.mockRejectedValue(Object.assign(new Error('Timed out'), { code: 'deadline-exceeded' }));
  await expect(requestUserSettings('owner', { operation: 'bootstrap', patch: { language: 'ru' } })).rejects.toMatchObject({ code: 'deadline-exceeded' });
  expect(request).toHaveBeenCalledTimes(1);
});
