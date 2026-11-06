import { formatDay } from '@/utils/appLocale';

import type { Locale } from 'date-fns';
import type { TFunction } from 'i18next';

/** One application-language reading for how recently a card was touched. */
export function relativeDay(dateStr: string, t: TFunction, dateLocale: Locale, now: Date = new Date()): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return '';
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t('common.today');
  if (diffDays === 1) return t('common.yesterday');
  if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
  if (diffDays < 30) return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
  return formatDay(date, dateLocale);
}
