const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/;

const toLocalYmd = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodayDateOnlyKey = (referenceDate = new Date()): string => toLocalYmd(referenceDate);

export const toDateOnlyKey = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (DATE_ONLY_REGEX.test(trimmed)) {
    return trimmed;
  }

  const isoPrefixMatch = trimmed.match(ISO_DATE_PREFIX_REGEX);
  if (isoPrefixMatch) {
    return isoPrefixMatch[1];
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return toLocalYmd(parsed);
};

export const parseDateOnlyAsLocalDate = (value: string | null | undefined): Date | null => {
  const dateKey = toDateOnlyKey(value);
  if (!dateKey) {
    return null;
  }

  const parsed = new Date(`${dateKey}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
};

/**
 * THE LOCAL DAY OF AN INSTANT — for stamps like `createdAt`, which name a moment, not a day.
 *
 * `toDateOnlyKey` keeps the leading `YYYY-MM-DD` of an ISO string on purpose: preach and meeting
 * dates were stored as UTC midnight, and that prefix IS the day the person chose. A `createdAt`
 * is different — the clock writes it, in UTC — so a note saved at half past eleven at night in
 * Seattle is already "tomorrow" by its prefix. This reads the instant and answers in the person's
 * own day. A date-only string has no instant and passes through untouched.
 */
export const toLocalDateOnlyKey = (value: string | null | undefined): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  // local-day-of-instant
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return toLocalYmd(parsed);
};
