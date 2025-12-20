"use client";

import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";
import { Sermon } from "@/models/models";

interface PreachCalendarProps {
    sermonsByDate: Record<string, Sermon[]>;
    selectedDate: Date;
    onDateSelect: (date: Date) => void;
    currentMonth?: Date;
    onMonthChange?: (month: Date) => void;
}

export default function PreachCalendar({
    sermonsByDate,
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

    const hasEvents = (date: Date) => {
        const dateStr = format(date, 'yyyy-MM-dd');
        return sermonsByDate[dateStr] && sermonsByDate[dateStr].length > 0;
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
        .has-event {
          position: relative;
        }
        .has-event::after {
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
        .rdp-day_selected.has-event::after {
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
                    hasEvent: (date) => hasEvents(date)
                }}
                modifiersClassNames={{
                    hasEvent: "has-event"
                }}
                className="mx-auto"
            />
        </div>
    );
}
