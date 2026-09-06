import { getDoc } from 'firebase/firestore';

import { getSermonByIdViaClient } from '@/services/sermons.client';
import { readSermonFromServer } from '@/services/sermonReadFallback.client';

jest.mock('@/config/firebaseClientDb', () => ({ getClientDb: () => ({}) }));
jest.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: jest.fn() }));
jest.mock('@/services/sermonReadFallback.client', () => ({ readSermonFromServer: jest.fn() }));

const stored = { id: 'sermon', userId: 'test-user-id', title: 'Stored' };
const remote = { ...stored, title: 'Remote', rev: { sermon: 2 } };
const snapshot = (metadata = { fromCache: false, hasPendingWrites: false }) => ({
  id: 'sermon', exists: () => true, data: () => stored, metadata,
});
beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  (getDoc as jest.Mock).mockResolvedValue(snapshot());
  (readSermonFromServer as jest.Mock).mockResolvedValue(remote);
});
afterEach(() => jest.useRealTimers());

it('keeps the normal SDK path when it has answered from the server', async () => {
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(stored);
  expect(readSermonFromServer).not.toHaveBeenCalled();
});
it('recovers a hanging SDK read through the independent server path', async () => {
  jest.useFakeTimers();
  (getDoc as jest.Mock).mockReturnValue(new Promise(() => {}));
  const result = getSermonByIdViaClient('sermon');
  await jest.advanceTimersByTimeAsync(4000);
  await expect(result).resolves.toEqual(remote);
});
it('checks an online cache-only result but preserves it if recovery is unreachable', async () => {
  (getDoc as jest.Mock).mockResolvedValue(snapshot({ fromCache: true, hasPendingWrites: false }));
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(remote);
  (readSermonFromServer as jest.Mock).mockRejectedValue(new Error('Offline'));
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(stored);
});
it.each([
  { fromCache: true, hasPendingWrites: true },
  { fromCache: false, hasPendingWrites: true },
])('preserves local pending writes: %p', async metadata => {
  (getDoc as jest.Mock).mockResolvedValue(snapshot(metadata));
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(stored);
  expect(readSermonFromServer).not.toHaveBeenCalled();
});
it('opens the offline SDK copy without an HTTP request', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  (getDoc as jest.Mock).mockResolvedValue(snapshot({ fromCache: true, hasPendingWrites: false }));
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(stored);
  expect(readSermonFromServer).not.toHaveBeenCalled();
});
it('does not reinterpret denied access as a transport failure', async () => {
  (getDoc as jest.Mock).mockRejectedValue({ code: 'permission-denied' });
  await expect(getSermonByIdViaClient('sermon')).rejects.toMatchObject({ code: 'permission-denied' });
  expect(readSermonFromServer).not.toHaveBeenCalled();
});

it('does not send recovery requests for unrelated programming errors', async () => {
  (getDoc as jest.Mock).mockRejectedValue(new TypeError('invalid call'));
  await expect(getSermonByIdViaClient('sermon')).rejects.toThrow('invalid call');
  expect(readSermonFromServer).not.toHaveBeenCalled();
});

it('recovers a transient SDK network failure immediately', async () => {
  (getDoc as jest.Mock).mockRejectedValue({ code: 'unavailable' });
  await expect(getSermonByIdViaClient('sermon')).resolves.toEqual(remote);
});
