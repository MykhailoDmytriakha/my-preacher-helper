import {
  clampPrayerSortKey,
  getDefaultPrayerSortKey,
  getPrayerSortOptions,
  normalizePrayerFilterStatus,
  normalizePrayerSortKey,
  resolvePrayerSortKey,
  sortPrayerRequests,
} from '@/utils/prayerSort';
import { PrayerRequest } from '@/models/models';

const prayers: PrayerRequest[] = [
  {
    id: 'older', userId: 'user-1', title: 'Older', status: 'answered', updates: [],
    createdAt: '2026-03-10T09:00:00.000Z', updatedAt: '2026-03-17T10:00:00.000Z',
    answeredAt: '2026-03-18T10:00:00.000Z',
  },
  {
    id: 'newer', userId: 'user-1', title: 'Newer', status: 'answered', updates: [],
    createdAt: '2026-03-12T09:00:00.000Z', updatedAt: '2026-03-18T12:00:00.000Z',
    answeredAt: '2026-03-18T10:00:00.000Z',
  },
  {
    id: 'invalid', userId: 'user-1', title: 'Invalid', status: 'answered', updates: [],
    createdAt: 'not-a-date', updatedAt: 'not-a-date', answeredAt: 'not-a-date',
  },
];

describe('prayerSort', () => {
  it('normalizes statuses and keys and exposes filter defaults', () => {
    expect(normalizePrayerFilterStatus('unexpected')).toBe('active');
    expect(normalizePrayerSortKey('unexpected')).toBe('updatedAt');
    expect(getPrayerSortOptions('answered')).toEqual(['answeredAt', 'updatedAt', 'createdAt']);
    expect(getDefaultPrayerSortKey('answered')).toBe('answeredAt');
    expect(clampPrayerSortKey('active', 'answeredAt')).toBe('updatedAt');
  });

  it('resolves transitional defaults while preserving explicit selections', () => {
    expect(resolvePrayerSortKey('answered', 'updatedAt', 'active')).toBe('answeredAt');
    expect(resolvePrayerSortKey('active', 'answeredAt', 'answered')).toBe('updatedAt');
    expect(resolvePrayerSortKey('answered', 'createdAt', 'active')).toBe('createdAt');
  });

  it('sorts by the selected date, uses updatedAt ties, handles invalid dates, and preserves input', () => {
    const original = [...prayers];
    const result = sortPrayerRequests(prayers, 'answeredAt');

    expect(result.map((prayer) => prayer.id)).toEqual(['newer', 'older', 'invalid']);
    expect(prayers).toEqual(original);
    expect(result).not.toBe(prayers);
  });
});
