import { readSermonFromServer } from '@/services/sermonReadFallback.client';
import { apiClient } from '@/utils/apiClient';
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import { resolveOwnerUid } from '@/utils/queryKeys';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/utils/authenticatedRequest', () => ({ getAuthenticatedRequestHeaders: jest.fn() }));
jest.mock('@/utils/queryKeys', () => ({ resolveOwnerUid: jest.fn() }));
jest.mock('@/utils/appDiagnostics', () => ({ recordDiagnostic: jest.fn(), diagnosticErrorCode: () => undefined }));

const response = (status: number, value: unknown) => ({ status, ok: status === 200, json: async () => value });
beforeEach(() => {
  jest.clearAllMocks();
  (resolveOwnerUid as jest.Mock).mockReturnValue('owner');
  (getAuthenticatedRequestHeaders as jest.Mock).mockResolvedValue({ Authorization: 'Bearer test' });
  (apiClient as jest.Mock).mockResolvedValue(response(200, { id: 'sermon', userId: 'owner', title: 'Current' }));
});

afterEach(() => jest.useRealTimers());

it('reads without caches, uses authentication, and changes the cache key each time', async () => {
  expect(await readSermonFromServer('sermon')).toMatchObject({ title: 'Current' });
  await readSermonFromServer('sermon');
  const calls = (apiClient as jest.Mock).mock.calls;
  expect(calls[0][0]).toMatch(/^\/api\/sermons\/sermon\?read=/);
  expect(calls[0][0]).not.toBe(calls[1][0]);
  expect(calls[0][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer test' } });
});

it.each([401, 403, 503])('rejects HTTP %s without treating it as a fresh document', async status => {
  (apiClient as jest.Mock).mockResolvedValue(response(status, { error: 'failed' }));
  await expect(readSermonFromServer('sermon')).rejects.toThrow('Server read failed');
});

it('reports deletion only from an authenticated 404 response', async () => {
  (apiClient as jest.Mock).mockResolvedValue(response(404, {}));
  await expect(readSermonFromServer('sermon')).resolves.toBeUndefined();
});

it('does not issue a request without an auth token', async () => {
  (getAuthenticatedRequestHeaders as jest.Mock).mockResolvedValue({});
  await expect(readSermonFromServer('sermon')).rejects.toMatchObject({ code: 'unauthenticated' });
  expect(apiClient).not.toHaveBeenCalled();
});

it('drops a response if the account changes during the request', async () => {
  (apiClient as jest.Mock).mockImplementation(async () => {
    (resolveOwnerUid as jest.Mock).mockReturnValue('other');
    return response(200, { id: 'sermon', userId: 'owner' });
  });
  await expect(readSermonFromServer('sermon')).rejects.toMatchObject({ code: 'unauthenticated' });
});

it.each([null, {}, { id: 'other', userId: 'owner' }, { id: 'sermon', userId: 'other' }])('rejects an invalid document envelope: %p', async value => {
  (apiClient as jest.Mock).mockResolvedValue(response(200, value));
  await expect(readSermonFromServer('sermon')).rejects.toThrow('Invalid sermon response');
});

it('bounds token acquisition and does not send a late request', async () => {
  jest.useFakeTimers();
  let resolve!: (value: unknown) => void;
  (getAuthenticatedRequestHeaders as jest.Mock).mockReturnValue(new Promise(done => { resolve = done; }));
  const check = expect(readSermonFromServer('sermon')).rejects.toMatchObject({ code: 'deadline-exceeded' });
  await jest.advanceTimersByTimeAsync(8000);
  await check;
  resolve({ Authorization: 'Bearer late' });
  await Promise.resolve();
  expect(apiClient).not.toHaveBeenCalled();
});

it('aborts a hanging fetch and ignores its later result', async () => {
  jest.useFakeTimers();
  (apiClient as jest.Mock).mockReturnValue(new Promise(() => {}));
  const check = expect(readSermonFromServer('sermon')).rejects.toMatchObject({ code: 'deadline-exceeded' });
  await jest.advanceTimersByTimeAsync(8000);
  await check;
  expect((apiClient as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
});
