"use client";

import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import { createContext, useContext, useEffect, useRef } from "react";
import { DayPicker } from "react-day-picker";
import { useTranslation } from "react-i18next";

import { CalendarKindFilters } from "@/components/calendar/CalendarKindFilters";
import { CALENDAR_KIND_STYLE } from "@/components/calendar/calendarKinds";
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { type CalendarKind } from "@/utils/calendarEntries";
import { getWeekStartsOn } from "@/utils/weekStart";

import type { DayButtonProps } from "react-day-picker";

import "react-day-picker/dist/style.css";

const DATE_KEY_FORMAT = 'yyyy-MM-dd';

interface PreachCalendarProps {
    /** Which kinds fall on each day — already filtered to what the person chose to see. */
    kindsByDate: Record<string, CalendarKind[]>;
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
    currentMonth?: Date;
    onMonthChange?: (month: Date) => void;
    shown: Record<CalendarKind, boolean>;
    onToggleKind: (kind: CalendarKind) => void;
}

/**
 * What each day holds, reaching the day cell without changing the cell's identity. Handing the
 * component itself a new closure on every change would rebuild every button in the month, and the
 * keyboard would lose the day it was standing on mid-arrow-key.
 */
const DayKinds = createContext<Record<string, CalendarKind[]>>({});

/**
 * THE DAY CELL DRAWS WHAT IS THERE, AND ASKS NOTHING ELSE.
 *
 * It used to decide a kind by what an event was missing — "no preach date, therefore a group" —
 * which was true only while there were exactly two kinds, and silently wrong the moment a third
 * arrived. Now the page hands the kinds down.
 *
 * The dots are real elements in the button, not `::before` and `::after`: there are only two of
 * those, both were already spent, and two hand-tuned offsets do not become three.
 */
function DayButtonWithDots({ day, modifiers, children, ...buttonProps }: DayButtonProps) {
    const kindsByDate = useContext(DayKinds);
    const button = useRef<HTMLButtonElement>(null);
    const kinds = kindsByDate[format(day.date, DATE_KEY_FORMAT)] ?? [];

    /*
     * The library's own day button does this, and taking it over means taking it on: without it
     * the arrow keys move the calendar's idea of the focused day while the focus itself stays
     * behind, and keyboard navigation stops at the day it started on.
     */
    useEffect(() => {
        if (modifiers.focused) button.current?.focus();
    }, [modifiers.focused]);

    return (
        <button {...buttonProps} ref={button} className={`${buttonProps.className ?? ''} preach-day`}>
            {children}
            {kinds.length > 0 && (
                <span className="preach-day-dots" aria-hidden="true">
                    {kinds.map((kind) => (
                        <span
                            key={kind}
                            data-kind={kind}
                            className={`preach-day-dot ${modifiers.selected ? 'bg-white' : CALENDAR_KIND_STYLE[kind].dot}`}
                        />
                    ))}
                </span>
            )}
        </button>
    );
}

/** One object, once: a new one each render would remount every cell. */
const DAY_COMPONENTS = { DayButton: DayButtonWithDots };

export default function PreachCalendar({
    kindsByDate,
    selectedDate,
    onDateSelect,
    currentMonth,
    onMonthChange,
    shown,
    onToggleKind
}: PreachCalendarProps) {
    const { t, i18n } = useTranslation();
    const { user } = useAuth();
    const { settings } = useUserSettings(user?.uid);
    const weekStartsOn = getWeekStartsOn(settings?.firstDayOfWeek);

    const getDateLocale = () => {
        switch (i18n.language) {
            case 'ru': return ru;
            case 'uk': return uk;
            default: return enUS;
        }
    };

    return (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 overflow-hidden flex flex-col items-center">
            <style>{`
        .rdp-root,
        .rdp {
          --rdp-cell-size: 38px; /* Slightly smaller for narrower viewports on desktop/tablet */
          --rdp-accent-color: #3b82f6;
          --rdp-accent-background-color: #eff6ff;
          --rdp-background-color: #eff6ff;
          --rdp-selected-border: 2px solid #2563eb;
          --preach-calendar-selected-background: #2563eb;
          --preach-calendar-selected-border: #2563eb;
          --preach-calendar-selected-shadow: rgba(37, 99, 235, 0.24);
          margin: 0;
        }
        @media (min-width: 1280px) {
          .rdp-root,
          .rdp {
            --rdp-cell-size: 45px; /* Original size for larger screens */
          }
        }
        .rdp-selected {
          color: white;
          font-weight: 700;
        }
        .rdp-selected .rdp-day_button,
        .rdp-day_selected,
        .rdp-selected .rdp-day_button:focus-visible,
        .rdp-day_selected:focus-visible,
        .rdp-selected .rdp-day_button:hover,
        .rdp-day_selected:hover {
          color: white;
          background-color: var(--preach-calendar-selected-background);
          border-color: var(--preach-calendar-selected-border);
          box-shadow: 0 0 0 2px var(--preach-calendar-selected-shadow);
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
        .rdp-day:not(.rdp-selected) .rdp-day_button:hover:not([disabled]) {
          background-color: var(--rdp-background-color);
        }
        .dark .rdp-root,
        .dark .rdp {
          --rdp-accent-color: #93c5fd;
          --rdp-accent-background-color: #1e3a8a;
          --rdp-background-color: #1e293b;
          --rdp-selected-border: 2px solid #bfdbfe;
          --preach-calendar-selected-background: #2563eb;
          --preach-calendar-selected-border: #93c5fd;
          --preach-calendar-selected-shadow: rgba(147, 197, 253, 0.35);
        }
        .preach-day {
          position: relative;
        }
        .preach-day-dots {
          position: absolute;
          bottom: 3px;
          left: 0;
          right: 0;
          display: flex;
          justify-content: center;
          gap: 3px;
          pointer-events: none;
        }
        .preach-day-dot {
          width: 4px;
          height: 4px;
          border-radius: 9999px;
        }
      `}</style>
            <DayKinds.Provider value={kindsByDate}>
            <DayPicker
                mode="single"
                selected={selectedDate}
                onSelect={(date) => date && onDateSelect(date)}
                month={currentMonth || selectedDate}
                onMonthChange={onMonthChange}
                locale={getDateLocale()}
                weekStartsOn={weekStartsOn}
                components={DAY_COMPONENTS}
                className="w-full flex justify-center"
            />
            </DayKinds.Provider>

            <CalendarKindFilters shown={shown} onToggleKind={onToggleKind} className="mt-4 border-t border-gray-100 pt-4 dark:border-gray-700" />
        </div>
    );
}
