'use client';

import { useTranslation } from 'react-i18next';

import { CALENDAR_KIND_STYLE } from '@/components/calendar/calendarKinds';
import { CALENDAR_KINDS, type CalendarKind } from '@/utils/calendarEntries';

/**
 * WHAT THE CALENDAR IS SHOWING, AND THE SWITCH FOR IT — in one place, so the switch always
 * stands where it acts. It used to live inside the month calendar only, which meant a person
 * could turn councils off, open the agenda, and find things missing with nothing on screen to
 * explain why or to put them back.
 */
export function CalendarKindFilters({
  shown,
  onToggleKind,
  className = '',
}: {
  shown: Record<CalendarKind, boolean>;
  onToggleKind: (kind: CalendarKind) => void;
  className?: string;
}) {
  const { t } = useTranslation();

  return (
    <div className={`flex w-full flex-wrap justify-center gap-2 px-1 ${className}`}>
      {CALENDAR_KINDS.map((kind) => {
        const style = CALENDAR_KIND_STYLE[kind];
        const on = shown[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onToggleKind(kind)}
            aria-pressed={on}
            data-testid={`calendar-filter-${kind}`}
            className={`flex items-center gap-1.5 rounded-full px-2 py-1.5 transition-colors sm:px-3 ${
              on ? style.legendOn : 'opacity-50 hover:bg-gray-100 dark:hover:bg-gray-800'
            }`}
          >
            <div className={`h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5 ${style.dot}`} />
            <span
              className={`whitespace-nowrap text-[11px] font-medium sm:text-xs ${
                on ? style.legendLabel : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {t(style.legendKey)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
