import { recordLastSeen } from '@/services/lastSeen.client';
import { requestUserSettings } from '@/services/userSettingsTransport.client';

jest.mock('@/services/userSettingsTransport.client', () => ({ requestUserSettings: jest.fn(() => Promise.resolve(null)) }));
const mockRequest = jest.mocked(requestUserSettings);

describe('recordLastSeen', () => {
  let storage: Record<string, string>;
  const mockLocalStorage = {
    getItem: jest.fn((key: string) => storage[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { storage[key] = value; }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    storage = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: mockLocalStorage,
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('requests one server heartbeat and records the per-user device timestamp', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    recordLastSeen('user-1');

    expect(mockRequest).toHaveBeenCalledWith('user-1', { operation: 'heartbeat', patch: {} });
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'my-preacher-helper:last-seen-at:user-1',
      String(now)
    );
  });

  it('skips another write for the same user within 24 hours', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    jest.spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValueOnce(now + (23 * 60 * 60 * 1_000));

    recordLastSeen('user-1');
    recordLastSeen('user-1');

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
  });
});
