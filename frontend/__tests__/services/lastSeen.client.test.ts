import { doc, setDoc } from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { recordLastSeen } from '@/services/lastSeen.client';

jest.mock('firebase/firestore', () => ({
  doc: jest.fn(() => 'user-document'),
  setDoc: jest.fn(() => Promise.resolve()),
}));

jest.mock('@/config/firebaseClientDb', () => ({
  getClientDb: jest.fn(() => 'client-db'),
}));

const mockDoc = doc as jest.MockedFunction<typeof doc>;
const mockSetDoc = setDoc as jest.MockedFunction<typeof setDoc>;
const mockGetClientDb = getClientDb as jest.MockedFunction<typeof getClientDb>;

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

  it('writes one merge heartbeat and records the per-user device timestamp', () => {
    const now = Date.parse('2026-07-13T12:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now);

    recordLastSeen('user-1');

    expect(mockGetClientDb).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith('client-db', 'users', 'user-1');
    expect(mockSetDoc).toHaveBeenCalledWith(
      'user-document',
      { lastSeenAt: '2026-07-13T12:00:00.000Z' },
      { merge: true }
    );
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

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockLocalStorage.setItem).toHaveBeenCalledTimes(1);
  });
});
