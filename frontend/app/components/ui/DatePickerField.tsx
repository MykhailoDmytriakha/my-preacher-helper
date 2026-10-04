"use client";

import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useAppLocale } from '@/hooks/useAppLocale';
import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { getTodayDateOnlyKey, isDateOnlyKey, isMissingDay, parseDateOnlyAsLocalDate } from "@/utils/dateOnly";
import { getWeekStartsOn } from "@/utils/weekStart";

import "react-day-picker/dist/style.css";

const DATE_KEY_FORMAT = "yyyy-MM-dd";
const DESKTOP_POPOVER_WIDTH = 320;
const DESKTOP_POPOVER_HEIGHT = 390;
const VIEWPORT_PADDING = 16;

interface DatePickerFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  wrapperClassName?: string;
  inputClassName?: string;
  calendarButtonLabel?: string;
  /**
   * For a caller that saves on every change. By default every keystroke is handed over, which a
   * form needs: its `pattern` then refuses a half-typed date at submit, and a draft keeps what was
   * typed. A caller that saves each change instead stored the keystrokes — a group meeting dated
   * "2" after the first digit. With this on, only a finished day or an emptied field is handed over;
   * half-typed text stays in the field until it is finished or the person leaves it. An emptied
   * field is handed over at once, so it fits a caller for whom an empty date removes nothing else.
   */
  finishedDatesOnly?: boolean;
  /**
   * For a form that creates a record: refuse a day-shaped value that names no day ("2026-02-31"),
   * as the browser's own date field did — the `pattern` checks only the shape. Not for a form that
   * edits stored data: a record saved with such a day, or a recovered draft holding one, must still
   * save its other fields (BUG-20261003-date-form-accepts-impossible-day).
   */
  refuseMissingDays?: boolean;
}

const getDefaultInputClassName = () =>
  "block w-full rounded-md border border-gray-300 bg-white p-3 pr-12 text-gray-900 shadow-sm transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-700 dark:text-white";

export default function DatePickerField({
  id,
  value,
  onChange,
  required = false,
  disabled = false,
  placeholder,
  wrapperClassName = "",
  inputClassName,
  calendarButtonLabel,
  finishedDatesOnly = false,
  refuseMissingDays = false,
}: DatePickerFieldProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const { t } = useTranslation();
  const { dateLocale } = useAppLocale();
  const { user } = useAuth();
  const { settings } = useUserSettings(user?.uid);
  const selectedDate = parseDateOnlyAsLocalDate(value);
  const [month, setMonth] = useState<Date>(selectedDate || new Date());
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({
    left: VIEWPORT_PADDING,
    top: VIEWPORT_PADDING,
    width: DESKTOP_POPOVER_WIDTH,
  });
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // finishedDatesOnly: what the field shows, which may run ahead of `value` while a date is typed.
  const [text, setText] = useState(value);
  const valueRef = useRef(value);
  // True while the field holds typed text that was not handed over.
  const unsentRef = useRef(false);
  const shown = finishedDatesOnly ? text : value;
  const missingDayMessage = t("common.dateDoesNotExist", { defaultValue: "There is no such day in the calendar" });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // A new value is shown unless the person is typing something not handed over yet: that text
    // stays theirs, and leaving the field shows the saved day.
    valueRef.current = value;
    if (!unsentRef.current) {
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    const refused = refuseMissingDays && isMissingDay(shown.trim());
    inputRef.current?.setCustomValidity(refused ? missingDayMessage : "");
  }, [refuseMissingDays, shown, missingDayMessage]);

  useEffect(() => {
    const parsed = parseDateOnlyAsLocalDate(value);
    if (parsed) {
      setMonth(parsed);
    }
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateViewportMode = () => setIsCompactViewport(mediaQuery.matches);
    updateViewportMode();

    mediaQuery.addEventListener?.("change", updateViewportMode);
    return () => mediaQuery.removeEventListener?.("change", updateViewportMode);
  }, []);

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === "undefined" || isCompactViewport) {
      return;
    }

    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    const maxLeft = window.innerWidth - DESKTOP_POPOVER_WIDTH - VIEWPORT_PADDING;
    const left = Math.max(
      VIEWPORT_PADDING,
      Math.min(rect.left, Math.max(VIEWPORT_PADDING, maxLeft))
    );
    const hasSpaceBelow = window.innerHeight - rect.bottom >= DESKTOP_POPOVER_HEIGHT;
    const top = hasSpaceBelow
      ? rect.bottom + 8
      : Math.max(VIEWPORT_PADDING, rect.top - DESKTOP_POPOVER_HEIGHT - 8);

    setPopoverStyle({
      left,
      top,
      width: DESKTOP_POPOVER_WIDTH,
    });
  }, [isCompactViewport]);

  useEffect(() => {
    if (!open) {
      return;
    }

    updatePopoverPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (wrapperRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // This Escape closes the calendar only; the form the field sits in stays open.
        event.stopPropagation();
        setOpen(false);
      }
    };

    window.addEventListener("resize", updatePopoverPosition);
    window.addEventListener("scroll", updatePopoverPosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updatePopoverPosition);
      window.removeEventListener("scroll", updatePopoverPosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, updatePopoverPosition]);

  const openCalendar = () => {
    if (!disabled) {
      setOpen(true);
    }
  };

  // A day picked in the calendar replaces anything half-typed. The field then shows the saved value
  // until the caller takes the new one, so a refused pick does not look accepted.
  const hand = (next: string) => {
    unsentRef.current = false;
    setText(valueRef.current);
    onChange(next);
  };

  const handleType = (raw: string) => {
    if (!finishedDatesOnly) {
      onChange(raw);
      return;
    }
    setText(raw);
    const next = raw.trim();
    unsentRef.current = !(next === "" || isDateOnlyKey(next));
    if (!unsentRef.current) {
      onChange(next);
    }
  };

  // Leaving the field shows what is saved: half-typed text was never handed over, and a handed-over
  // day the caller refused was never saved.
  const handleBlur = () => {
    if (!finishedDatesOnly) {
      return;
    }
    unsentRef.current = false;
    if (text !== value) {
      setText(value);
    }
  };

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      return;
    }

    hand(format(date, DATE_KEY_FORMAT));
    setMonth(date);
    setOpen(false);
  };

  const handleToday = () => {
    const todayKey = getTodayDateOnlyKey();
    hand(todayKey);
    const today = parseDateOnlyAsLocalDate(todayKey) || new Date();
    setMonth(today);
    setOpen(false);
  };

  const handleClear = () => {
    hand("");
    setOpen(false);
  };

  const label = calendarButtonLabel || t("common.openCalendar", { defaultValue: "Open calendar" });
  const resolvedPlaceholder = placeholder || t("common.datePlaceholder", { defaultValue: "yyyy-mm-dd" });
  const weekStartsOn = getWeekStartsOn(settings?.firstDayOfWeek);

  const calendar = open && mounted
    ? createPortal(
      <>
        {isCompactViewport && (
          <button
            type="button"
            aria-label={t("common.close", { defaultValue: "Close" })}
            className="fixed inset-0 z-[219] cursor-default bg-black/30"
            onClick={() => setOpen(false)}
          />
        )}
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={label}
          data-testid={`${inputId}-calendar-popover`}
          className={`z-[220] rounded-xl border border-gray-200 bg-white p-3 shadow-2xl dark:border-gray-700 dark:bg-gray-800 ${isCompactViewport
            ? "fixed inset-x-3 bottom-3 max-h-[82vh] overflow-auto"
            : "fixed"
            }`}
          style={isCompactViewport ? undefined : popoverStyle}
        >
          <style>{`
            .date-picker-field-calendar .rdp-root,
            .date-picker-field-calendar .rdp {
              --rdp-accent-color: #2563eb;
              --rdp-accent-background-color: #eff6ff;
              --rdp-background-color: #eff6ff;
              --rdp-selected-border: 2px solid #1d4ed8;
              --date-picker-selected-background: #2563eb;
              --date-picker-selected-border: #1d4ed8;
              --date-picker-selected-shadow: rgba(37, 99, 235, 0.24);
              margin: 0;
            }
            .date-picker-field-calendar .rdp-months {
              justify-content: center;
            }
            .date-picker-field-calendar .rdp-selected {
              color: white;
              font-weight: 700;
            }
            .date-picker-field-calendar .rdp-selected .rdp-day_button,
            .date-picker-field-calendar .rdp-day_selected,
            .date-picker-field-calendar .rdp-selected .rdp-day_button:focus-visible,
            .date-picker-field-calendar .rdp-day_selected:focus-visible,
            .date-picker-field-calendar .rdp-selected .rdp-day_button:hover,
            .date-picker-field-calendar .rdp-day_selected:hover {
              color: white;
              background-color: var(--date-picker-selected-background);
              border-color: var(--date-picker-selected-border);
              box-shadow: 0 0 0 2px var(--date-picker-selected-shadow);
            }
            .date-picker-field-calendar .rdp-day:not(.rdp-selected) .rdp-day_button:hover:not([disabled]) {
              background-color: var(--rdp-background-color);
            }
            .dark .date-picker-field-calendar .rdp-root,
            .dark .date-picker-field-calendar .rdp {
              --rdp-accent-color: #93c5fd;
              --rdp-accent-background-color: #1e3a8a;
              --rdp-background-color: #1e293b;
              --rdp-selected-border: 2px solid #bfdbfe;
              --date-picker-selected-background: #2563eb;
              --date-picker-selected-border: #93c5fd;
              --date-picker-selected-shadow: rgba(147, 197, 253, 0.35);
            }
          `}</style>
          <div className="date-picker-field-calendar">
            <DayPicker
              mode="single"
              selected={selectedDate || undefined}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleSelect}
              locale={dateLocale}
              weekStartsOn={weekStartsOn}
            />
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 dark:border-gray-700">
            <button
              type="button"
              onClick={handleClear}
              disabled={required}
              className="rounded-md px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 disabled:pointer-events-none disabled:opacity-0 dark:text-blue-300 dark:hover:bg-blue-900/30"
            >
              {t("common.clear", { defaultValue: "Clear" })}
            </button>
            <button
              type="button"
              onClick={handleToday}
              className="rounded-md px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-50 dark:text-blue-300 dark:hover:bg-blue-900/30"
            >
              {t("common.today", { defaultValue: "Today" })}
            </button>
          </div>
        </div>
      </>,
      document.body
    )
    : null;

  return (
    <>
      <div ref={wrapperRef} className={`relative ${wrapperClassName}`}>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={shown}
          onChange={(event) => handleType(event.target.value)}
          onBlur={handleBlur}
          onClick={openCalendar}
          placeholder={resolvedPlaceholder}
          required={required}
          disabled={disabled}
          pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
          className={`${inputClassName || getDefaultInputClassName()} pr-12`}
        />
        <button
          type="button"
          onClick={openCalendar}
          disabled={disabled}
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-gray-900 transition hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-100 dark:hover:bg-gray-600"
        >
          <CalendarDaysIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {calendar}
    </>
  );
}
