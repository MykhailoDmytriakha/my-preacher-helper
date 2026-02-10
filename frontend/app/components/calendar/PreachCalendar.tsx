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
}

export default function PreachCalendar({
    eventsByDate,
    sermonStatusByDate = {},
    selectedDate,
    onDateSelect,
    currentMonth,
    onMonthChange
}: PreachCalendarProps) {
    const { i18n } = useTranslation();

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

    const hasEvents = (date: Date) => {
        const dateStr = format(date, DATE_KEY_FORMAT);
        const events = eventsByDate[dateStr];
        if (!events || events.length === 0) {
            return false;
        }

        // If this date already has sermon status markers, suppress generic event dot
        // to avoid duplicate indicators (planned/preached + generic).
        const sermonStatus = getSermonStatusForDate(dateStr);
        const hasSermonStatus = ((sermonStatus?.planned || 0) + (sermonStatus?.preached || 0)) > 0;
        return !hasSermonStatus;
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 overflow-hidden">
            <style>{`
        .rdp {
          --rdp-cell-size: 45px;
          --rdp-accent-color: #3b82f6;
          --rdp-background-color: #eff6ff;
          margin: 0;
        }
        .rdp-day_selected, .rdp-day_selected:focus-visible, .rdp-day_selected:hover {
          color: white;
          background-color: var(--rdp-accent-color);
        }
        .rdp-button:hover:not([disabled]):not(.rdp-day_selected) {
          background-color: var(--rdp-background-color);
        }
        .dark .rdp {
          --rdp-background-color: #1e293b;
        }
        .has-event .rdp-day_button,
        .has-planned .rdp-day_button,
        .has-preached .rdp-day_button {
          position: relative;
        }
        .has-event .rdp-day_button::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: #3b82f6;
        }
        .has-planned .rdp-day_button::before {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: #f59e0b;
        }
        .has-preached .rdp-day_button::after {
          content: '';
          position: absolute;
          bottom: 4px;
          left: 50%;
          transform: translateX(-50%);
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background-color: #3b82f6;
        }
        .has-planned.has-preached .rdp-day_button::before {
          left: calc(50% - 6px);
          transform: none;
        }
        .has-planned.has-preached .rdp-day_button::after {
          left: calc(50% + 2px);
          transform: none;
        }
        .rdp-day_selected.has-event .rdp-day_button::after {
          background-color: white;
        }
        .rdp-day_selected.has-planned .rdp-day_button::before,
        .rdp-day_selected.has-preached .rdp-day_button::after {
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
                    hasEvent: (date) => hasEvents(date),
                    hasPlanned: (date) => {
                        const dateStr = format(date, DATE_KEY_FORMAT);
                        return getSermonStatusForDate(dateStr).planned > 0;
                    },
                    hasPreached: (date) => {
                        const dateStr = format(date, DATE_KEY_FORMAT);
                        return getSermonStatusForDate(dateStr).preached > 0;
                    }
                }}
                modifiersClassNames={{
                    hasEvent: "has-event",
                    hasPlanned: "has-planned",
                    hasPreached: "has-preached"
                }}
                className="mx-auto"
            />
        </div>
    );
}
