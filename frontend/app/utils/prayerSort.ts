import { PrayerRequest, PrayerStatus } from '@/models/models';

export type PrayerFilterStatus = 'all' | PrayerStatus;
export type PrayerSortKey = 'updatedAt' | 'createdAt' | 'answeredAt';

const FILTER_STATUSES: PrayerFilterStatus[] = ['all', 'active', 'answered', 'not_answered'];
const SORT_KEYS: PrayerSortKey[] = ['updatedAt', 'createdAt', 'answeredAt'];

const SORT_OPTIONS_BY_FILTER: Record<PrayerFilterStatus, PrayerSortKey[]> = {
  all: ['updatedAt', 'createdAt', 'answeredAt'],
  active: ['updatedAt', 'createdAt'],
  answered: ['answeredAt', 'updatedAt', 'createdAt'],
  not_answered: ['updatedAt', 'createdAt'],
};

const DEFAULT_SORT_BY_FILTER: Record<PrayerFilterStatus, PrayerSortKey> = {
  all: 'updatedAt',
  active: 'updatedAt',
  answered: 'answeredAt',
  not_answered: 'updatedAt',
};

function getTimestamp(value?: string): number {
  const timestamp = Date.parse(value ?? '');
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function normalizePrayerFilterStatus(value?: string | null): PrayerFilterStatus {
  if (FILTER_STATUSES.includes(value as PrayerFilterStatus)) {
    return value as PrayerFilterStatus;
  }

  return 'active';
}

export function normalizePrayerSortKey(value?: string | null): PrayerSortKey {
  if (SORT_KEYS.includes(value as PrayerSortKey)) {
    return value as PrayerSortKey;
  }

  return 'updatedAt';
}

export function getPrayerSortOptions(filterStatus: PrayerFilterStatus): PrayerSortKey[] {
  return SORT_OPTIONS_BY_FILTER[filterStatus];
}

export function getDefaultPrayerSortKey(filterStatus: PrayerFilterStatus): PrayerSortKey {
  return DEFAULT_SORT_BY_FILTER[filterStatus];
}

export function clampPrayerSortKey(
  filterStatus: PrayerFilterStatus,
  sortKey?: string | null
): PrayerSortKey {
  const normalizedSortKey = normalizePrayerSortKey(sortKey);
  const allowedSorts = getPrayerSortOptions(filterStatus);

  if (allowedSorts.includes(normalizedSortKey)) {
    return normalizedSortKey;
  }

  return getDefaultPrayerSortKey(filterStatus);
}

export function resolvePrayerSortKey(
  filterStatus: PrayerFilterStatus,
  sortKey?: string | null,
  previousFilterStatus?: PrayerFilterStatus | null
): PrayerSortKey {
  const clampedSortKey = clampPrayerSortKey(filterStatus, sortKey);

  if (!previousFilterStatus || previousFilterStatus === filterStatus) {
    return clampedSortKey;
  }

  const normalizedSortKey = normalizePrayerSortKey(sortKey);
  const previousDefaultSortKey = getDefaultPrayerSortKey(previousFilterStatus);

  if (normalizedSortKey === previousDefaultSortKey) {
    return getDefaultPrayerSortKey(filterStatus);
  }

  return clampedSortKey;
}

export function sortPrayerRequests(prayers: PrayerRequest[], sortKey: PrayerSortKey): PrayerRequest[] {
  return [...prayers].sort((left, right) => {
    const leftPrimary = getTimestamp(
      sortKey === 'answeredAt' ? left.answeredAt : left[sortKey]
    );
    const rightPrimary = getTimestamp(
      sortKey === 'answeredAt' ? right.answeredAt : right[sortKey]
    );

    if (rightPrimary !== leftPrimary) {
      return rightPrimary - leftPrimary;
    }

    return getTimestamp(right.updatedAt) - getTimestamp(left.updatedAt);
  });
}
