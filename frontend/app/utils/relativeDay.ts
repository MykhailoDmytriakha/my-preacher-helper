import { formatDay } from './appLocale';

import type { Locale } from 'date-fns';
import type { TFunction } from 'i18next';

/**
 * WHEN SOMETHING WAS LAST TOUCHED, said as a person says it — «сегодня», «вчера», «3 дня назад», «2 недели назад»,
 * then the date in the interface's language. One reading for the cards of Studies: a note's and a comment's footers
 * say time the same way.
 */
export function relativeDay(dateStr: string, t: TFunction, dateLocale: Locale, now: Date = new Date()): string {
  const date = new Date(dateStr);
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return t('common.today');
  if (diffDays === 1) return t('common.yesterday');
  if (diffDays < 7) return t('common.daysAgo', { count: diffDays });
  if (diffDays < 30) return t('common.weeksAgo', { count: Math.floor(diffDays / 7) });
  return formatDay(date, dateLocale);
}
