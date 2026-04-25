export const FIRST_DAY_OF_WEEK_VALUES = ['sunday', 'monday'] as const;

export type FirstDayOfWeek = (typeof FIRST_DAY_OF_WEEK_VALUES)[number];
export type DayPickerWeekStartsOn = 0 | 1;

export const DEFAULT_FIRST_DAY_OF_WEEK: FirstDayOfWeek = 'sunday';

export const isFirstDayOfWeek = (value: unknown): value is FirstDayOfWeek =>
  value === 'sunday' || value === 'monday';

export const normalizeFirstDayOfWeek = (value: unknown): FirstDayOfWeek =>
  isFirstDayOfWeek(value) ? value : DEFAULT_FIRST_DAY_OF_WEEK;

export const getWeekStartsOn = (value: unknown): DayPickerWeekStartsOn =>
  normalizeFirstDayOfWeek(value) === 'monday' ? 1 : 0;
