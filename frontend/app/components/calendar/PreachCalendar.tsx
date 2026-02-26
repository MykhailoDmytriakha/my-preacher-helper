"use client";

import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import { useEffect, useMemo } from "react";
import { DayPicker } from "react-day-picker";
import { useTranslation } from "react-i18next";

import { PreachDate, Sermon } from "@/models/models";
import { debugLog } from "@/utils/debugMode";
import { getEffectivePreachDateStatus } from "@/utils/preachDateStatus";

import "react-day-picker/dist/style.css";

const DATE_KEY_FORMAT = 'yyyy-MM-dd';
const EMPTY_SERMON_STATUS = { planned: 0, preached: 0 } as const;

type SermonCalendarEvent = Sermon & { currentPreachDate?: PreachDate };

const hasCurrentPreachDate = (event: unknown): event is SermonCalendarEvent & { currentPreachDate: PreachDate } => {
    if (!event || typeof event !== 'object') {
        return false;
    }
    return 'currentPreachDate' in event && Boolean((event as SermonCalendarEvent).currentPreachDate);
};

interface PreachCalendarProps {
    eventsByDate: Record<string, unknown[]>;
    sermonStatusByDate?: Record<string, { planned: number; preached: number }>;
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
    currentMonth?: Date;
    onMonthChange?: (month: Date) => void;
    filterSermons?: boolean;
    filterGroups?: boolean;
    onToggleSermons?: () => void;
    onToggleGroups?: () => void;
}

export default function PreachCalendar({
    eventsByDate,
    sermonStatusByDate = {},
    selectedDate,
    onDateSelect,
    currentMonth,
    onMonthChange,
    filterSermons = true,
    filterGroups = true,
    onToggleSermons,
    onToggleGroups
}: PreachCalendarProps) {
    const { t, i18n } = useTranslation();

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    const derivedSermonStatusByDate = useMemo(() => {
        return Object.entries(eventsByDate).reduce((acc, [dateKey, events]) => {
            events.forEach((event) => {
                if (!hasCurrentPreachDate(event)) {
                    return;
                }

                if (!acc[dateKey]) {
                    acc[dateKey] = { planned: 0, preached: 0 };
                }

                const status = getEffectivePreachDateStatus(
                    event.currentPreachDate,
                    Boolean(event.isPreached)
                );
                acc[dateKey][status] += 1;
            });
            return acc;
        }, {} as Record<string, { planned: number; preached: number }>);
    }, [eventsByDate]);

    // Source of truth:
    // - Use statuses derived from `eventsByDate` when available (same source as right panel list).
    // - Fallback to external map only for compatibility when event payload lacks preach-date context.
    const effectiveSermonStatusByDate =
        Object.keys(derivedSermonStatusByDate).length > 0
            ? derivedSermonStatusByDate
            : sermonStatusByDate;

    const getSermonStatusForDate = (dateStr: string) =>
        effectiveSermonStatusByDate[dateStr] || EMPTY_SERMON_STATUS;

    useEffect(() => {
        const plannedKeys = Object.entries(effectiveSermonStatusByDate)
            .filter(([, value]) => value.planned > 0)
            .map(([date]) => date)
            .sort();
        const preachedKeys = Object.entries(effectiveSermonStatusByDate)
            .filter(([, value]) => value.preached > 0)
            .map(([date]) => date)
            .sort();

        debugLog('[calendar][PreachCalendar] marker sources', {
            eventKeys: Object.keys(eventsByDate).sort(),
            derivedStatusKeys: Object.keys(derivedSermonStatusByDate).sort(),
            fallbackStatusKeys: Object.keys(sermonStatusByDate).sort(),
            effectiveStatusKeys: Object.keys(effectiveSermonStatusByDate).sort(),
            plannedKeys,
            preachedKeys,
        });
    }, [eventsByDate, derivedSermonStatusByDate, sermonStatusByDate, effectiveSermonStatusByDate]);

    const hasSermonsDate = (date: Date) => {
        if (!filterSermons) return false;
        const dateStr = format(date, DATE_KEY_FORMAT);
        const events = eventsByDate[dateStr] || [];
        const hasSermonEvent = events.some(hasCurrentPreachDate);
        const sermonStatus = getSermonStatusForDate(dateStr);
        const hasSermonStatus = ((sermonStatus?.planned || 0) + (sermonStatus?.preached || 0)) > 0;
        return hasSermonEvent || hasSermonStatus;
    };

    const hasGroupsDate = (date: Date) => {
        if (!filterGroups) return false;
        const dateStr = format(date, DATE_KEY_FORMAT);
        const events = eventsByDate[dateStr] || [];
        // Groups are events without currentPreachDate
        return events.some(event => !hasCurrentPreachDate(event));
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 overflow-hidden flex flex-col items-center">
            <style>{`
        .rdp {
          --rdp-cell-size: 38px; /* Slightly smaller for narrower viewports on desktop/tablet */
          --rdp-accent-color: #3b82f6;
          --rdp-background-color: #eff6ff;
          margin: 0;
        }
        @media (min-width: 1280px) {
          .rdp {
            --rdp-cell-size: 45px; /* Original size for larger screens */
          }
        }
        .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover {
          color: white;
          background-color: var(--rdp-accent-color);
        }
        .rdp-caption {
          padding-left: 8px;
          padding-right: 8px;
        }
        .rdp-caption_label {
          padding-left: 16px;
          padding-right: 8px;
          overflow: visible;
        }
        .rdp-button:hover:not([disabled]):not(.rdp-day_selected) {
          background-color: var(--rdp-background-color);
        }
        .dark .rdp {
          --rdp-background-color: #1e293b;
        }
        .has-sermon .rdp-day_button,
        .has-group .rdp-day_button {
          position: relative;
        }
        .has-sermon .rdp-day_button::before {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: #3b82f6; /* bg-blue-500 */
        }
        .has-group .rdp-day_button::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: #10b981; /* bg-emerald-500 */
        }
        .has-sermon.has-group .rdp-day_button::before {
          left: calc(50% - 3px);
          transform: translateX(-50%);
        }
        .has-sermon.has-group .rdp-day_button::after {
          left: calc(50% + 3px);
          transform: translateX(-50%);
        }
        .rdp-day_selected.has-sermon .rdp-day_button::before,
        .rdp-day_selected.has-group .rdp-day_button::after {
          background-color: white;
        }
      `}</style>
            <DayPicker
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && onDateSelect(date)}
                month={currentMonth || selectedDate}
                onMonthChange={onMonthChange}
                locale={getDateLocale()}
                modifiers={{
                    hasSermon: (date) => hasSermonsDate(date),
                    hasGroup: (date) => hasGroupsDate(date)
                }}
                modifiersClassNames={{
                    hasSermon: "has-sermon",
                    hasGroup: "has-group"
                }}
                className="w-full flex justify-center"
            />

            {/* Legend Toggles */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 w-full flex flex-wrap justify-center gap-2 px-1">
                <button
                    onClick={onToggleSermons}
                    className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full transition-colors ${filterSermons
                        ? 'bg-blue-50 dark:bg-blue-900/40 hover:bg-blue-100 dark:hover:bg-blue-900/60'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 opacity-50'
                        }`}
                >
                    <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-blue-500 shrink-0"></div>
                    <span className={`text-[11px] sm:text-xs font-medium whitespace-nowrap ${filterSermons ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500 dark:text-gray-400'}`}>
                        {t('calendar.legend.sermons', { defaultValue: 'Sermons' })}
                    </span>
                </button>
                <button
                    onClick={onToggleGroups}
                    className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full transition-colors ${filterGroups
                        ? 'bg-emerald-50 dark:bg-emerald-900/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-800 opacity-50'
                        }`}
                >
                    <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-emerald-500 shrink-0"></div>
                    <span className={`text-[11px] sm:text-xs font-medium whitespace-nowrap ${filterGroups ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-500 dark:text-gray-400'}`}>
                        {t('calendar.legend.groups', { defaultValue: 'Groups' })}
                    </span>
                </button>
            </div>
        </div>
    );
}
