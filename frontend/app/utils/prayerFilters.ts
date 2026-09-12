import { PrayerRequest } from '@/models/models';

import {
  matchesPrayerQuery,
  PrayerSearchOptions,
} from './prayerSearch';
import {
  clampPrayerSortKey,
  sortPrayerRequests,
  PrayerFilterStatus,
  PrayerSortKey,
} from './prayerSort';

export type { PrayerFilterStatus, PrayerSortKey } from './prayerSort';
export type {
  PrayerSearchOptions,
  PrayerSearchTarget,
  PrayerSearchTargetType,
} from './prayerSearch';
export {
  getPrayerSearchTarget,
  getPrayerUpdateSearchSnippet,
  matchesPrayerQuery,
} from './prayerSearch';
export {
  clampPrayerSortKey,
  getDefaultPrayerSortKey,
  getPrayerSortOptions,
  normalizePrayerFilterStatus,
  normalizePrayerSortKey,
  resolvePrayerSortKey,
} from './prayerSort';

export interface FilterPrayerRequestsOptions extends PrayerSearchOptions {
  filterStatus: PrayerFilterStatus;
  searchQuery: string;
  sortKey: PrayerSortKey;
}

export function filterPrayerRequests(
  prayers: PrayerRequest[],
  options: FilterPrayerRequestsOptions
): PrayerRequest[] {
  const { filterStatus, searchQuery, sortKey, ...searchOptions } = options;
  const normalizedSortKey = clampPrayerSortKey(filterStatus, sortKey);

  const filtered = prayers.filter((prayer) => {
    const matchesStatus =
      filterStatus === 'all' ? true : prayer.status === filterStatus;

    if (!matchesStatus) {
      return false;
    }

    return matchesPrayerQuery(prayer, searchQuery, searchOptions);
  });

  return sortPrayerRequests(filtered, normalizedSortKey);
}
