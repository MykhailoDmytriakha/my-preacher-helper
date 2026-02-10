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
