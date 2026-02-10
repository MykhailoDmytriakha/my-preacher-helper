import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

import { parseDateOnlyAsLocalDate } from './dateOnly';

const NO_DATE_LABEL = 'No date';
const INVALID_DATE_LABEL = 'Invalid date';

const parseDateTime = (value: string): Date | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parsedDateOnly = parseDateOnlyAsLocalDate(trimmed);
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && parsedDateOnly) {
    return parsedDateOnly;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return parsedDateOnly;
};

export const formatDate = (dateStr: string | undefined | null) => {
  try {
    if (!dateStr || dateStr === '') {
      console.warn('formatDate received empty date string:', dateStr);
      return NO_DATE_LABEL;
    }
    const date = parseDateTime(dateStr);
    if (!date) {
      console.error('formatDate received invalid date string:', dateStr);
      return INVALID_DATE_LABEL;
    }
    if (isNaN(date.getTime())) {
      console.error('formatDate received invalid date string:', dateStr);
      return INVALID_DATE_LABEL;
    }
    return format(date, 'dd.MM.yyyy, HH:mm', { locale: ru });
  } catch (error) {
    console.error('Error formatting date:', error, 'for input:', dateStr);
    return INVALID_DATE_LABEL;
  }
};

export const formatDateOnly = (dateStr: string | undefined | null) => {
  try {
    if (!dateStr || dateStr === '') {
      console.warn('formatDateOnly received empty date string:', dateStr);
      return NO_DATE_LABEL;
    }

    const date = parseDateOnlyAsLocalDate(dateStr);
    if (!date || isNaN(date.getTime())) {
      console.error('formatDateOnly received invalid date string:', dateStr);
      return INVALID_DATE_LABEL;
    }

    return format(date, 'dd.MM.yyyy', { locale: ru });
  } catch (error) {
    console.error('Error formatting date-only value:', error, 'for input:', dateStr);
    return INVALID_DATE_LABEL;
  }
};

export { toDateOnlyKey, getTodayDateOnlyKey } from './dateOnly';
