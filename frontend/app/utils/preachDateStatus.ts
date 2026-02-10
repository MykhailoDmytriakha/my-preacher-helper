import { PreachDate, PreachDateStatus, Sermon } from '@/models/models';
import { getTodayDateOnlyKey, toDateOnlyKey } from '@/utils/dateOnly';

const PREACHED_STATUS: PreachDateStatus = 'preached';
const PLANNED_STATUS: PreachDateStatus = 'planned';

const isKnownPreachDateStatus = (status: PreachDate['status']): status is PreachDateStatus =>
  status === PLANNED_STATUS || status === PREACHED_STATUS;

const toTimestamp = (value: string): number | null => {
  const dateKey = toDateOnlyKey(value);
  if (!dateKey) {
    return null;
  }

  const timestamp = new Date(`${dateKey}T00:00:00`).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
};

export const getEffectivePreachDateStatus = (
  preachDate: PreachDate,
  sermonIsPreached = false
): PreachDateStatus => {
  if (isKnownPreachDateStatus(preachDate.status)) {
    return preachDate.status;
  }

  if (sermonIsPreached) {
    return PREACHED_STATUS;
  }

  // Legacy fallback: status-less future date is treated as planned, otherwise preached.
  const dateKey = toDateOnlyKey(preachDate.date);
  if (dateKey && dateKey >= getTodayDateOnlyKey()) {
    return PLANNED_STATUS;
  }

  return PREACHED_STATUS;
};

export const isPreachDatePreached = (preachDate: PreachDate, sermonIsPreached = false): boolean =>
  getEffectivePreachDateStatus(preachDate, sermonIsPreached) === PREACHED_STATUS;

export const isPreachDatePlanned = (preachDate: PreachDate, sermonIsPreached = false): boolean =>
  getEffectivePreachDateStatus(preachDate, sermonIsPreached) === PLANNED_STATUS;

export const getPreachDatesByStatus = (
  sermon: Sermon,
  status: PreachDateStatus
): PreachDate[] => {
  const sermonIsPreached = Boolean(sermon.isPreached);
  return (sermon.preachDates || []).filter(
    (preachDate) => getEffectivePreachDateStatus(preachDate, sermonIsPreached) === status
  );
};

export const getEffectiveIsPreached = (sermon: Sermon): boolean => {
  const preachDates = sermon.preachDates || [];

  if (preachDates.length === 0) {
    return Boolean(sermon.isPreached);
  }

  const sermonIsPreached = Boolean(sermon.isPreached);
  return preachDates.some(
    (preachDate) => getEffectivePreachDateStatus(preachDate, sermonIsPreached) === PREACHED_STATUS
  );
};

export const getLatestPreachedDate = (sermon: Sermon): PreachDate | null => {
  const preachedDates = getPreachDatesByStatus(sermon, PREACHED_STATUS)
    .map((preachDate) => ({ preachDate, timestamp: toTimestamp(preachDate.date) }))
    .filter(
      (
        entry
      ): entry is {
        preachDate: PreachDate;
        timestamp: number;
      } => entry.timestamp !== null
    )
    .sort((a, b) => b.timestamp - a.timestamp);

  return preachedDates[0]?.preachDate ?? null;
};

export const getNextPlannedDate = (sermon: Sermon, referenceDate = new Date()): PreachDate | null => {
  const plannedDates = getPreachDatesByStatus(sermon, PLANNED_STATUS)
    .map((preachDate) => ({
      preachDate,
      dateKey: toDateOnlyKey(preachDate.date),
      timestamp: toTimestamp(preachDate.date),
    }))
    .filter(
      (
        entry
      ): entry is {
        preachDate: PreachDate;
        dateKey: string;
        timestamp: number;
      } => entry.timestamp !== null && Boolean(entry.dateKey)
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  if (plannedDates.length === 0) {
    return null;
  }

  const referenceKey = getTodayDateOnlyKey(referenceDate);
  const upcoming = plannedDates.find((entry) => entry.dateKey >= referenceKey);
  if (upcoming) {
    return upcoming.preachDate;
  }

  return plannedDates[plannedDates.length - 1].preachDate;
};

export const getPreferredDateToMarkAsPreached = (
  sermon: Sermon,
  referenceDate = new Date()
): PreachDate | null => {
  const plannedDate = getNextPlannedDate(sermon, referenceDate);
  if (plannedDate) {
    return plannedDate;
  }

  return getLatestPreachedDate(sermon);
};

export const countPreachDatesByStatus = (sermon: Sermon, status: PreachDateStatus): number =>
  getPreachDatesByStatus(sermon, status).length;
