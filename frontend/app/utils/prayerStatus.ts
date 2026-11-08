import type { PrayerStatus } from '@/models/models';

export const isPrayerStatus = (value: unknown): value is PrayerStatus =>
  value === 'active' || value === 'answered' || value === 'not_answered';
