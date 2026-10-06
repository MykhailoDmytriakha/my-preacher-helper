const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/;

const toLocalYmd = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getTodayDateOnlyKey = (referenceDate = new Date()): string => toLocalYmd(referenceDate);

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/**
 * A finished day as a date field stores it: `YYYY-MM-DD` naming a day the calendar has.
 * "2026-0" is still being typed and "2026-02-31" does not exist; neither is a date to save.
 * Counted, not parsed: a `Date` answers by the device's clock, and a day the local zone
 * skipped (Samoa, 2011-12-30) would read as missing.
 */
export const isDateOnlyKey = (value: string): boolean => {
  if (!DATE_ONLY_REGEX.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return day <= (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]);
};

/** Shaped like a day, names none: "2026-02-31", "2026-13-01", "0000-01-01". */
export const isMissingDay = (value: string): boolean => DATE_ONLY_REGEX.test(value) && !isDateOnlyKey(value);


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

/** Full dates in formats older records used: a day, a day with a time, a day with the year last. */
const FULL_STORED_DATE_REGEX = /^(?:\d{4}-\d{2}-\d{2}(?:[T ].*)?|\d{1,2}[./]\d{1,2}[./]\d{4})$/;

/**
 * The text a date field shows for a value it did not get from the person's typing: the day of a full
 * stored date — a timestamp, an older format, padding — and anything else exactly as it is, so a
 * partial value such as "2" never looks like a plausible day (BUG-20261003-date-form-accepts-impossible-day).
 */
export const shownDayOf = (value: string): string => {
  const trimmed = value.trim();
  return (FULL_STORED_DATE_REGEX.test(trimmed) ? toDateOnlyKey(trimmed) : null) ?? value;
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
