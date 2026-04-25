"use client";

import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { format } from "date-fns";
import { enUS, ru, uk } from "date-fns/locale";
import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { DayPicker } from "react-day-picker";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { useUserSettings } from "@/hooks/useUserSettings";
import { useAuth } from "@/providers/AuthProvider";
import { getTodayDateOnlyKey, parseDateOnlyAsLocalDate } from "@/utils/dateOnly";
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
}: DatePickerFieldProps) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const { t, i18n } = useTranslation();
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

  const getDateLocale = () => {
    switch (i18n.language) {
      case "ru": return ru;
      case "uk": return uk;
      default: return enUS;
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

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

  const handleSelect = (date: Date | undefined) => {
    if (!date) {
      return;
    }

    onChange(format(date, DATE_KEY_FORMAT));
    setMonth(date);
    setOpen(false);
  };

  const handleToday = () => {
    const todayKey = getTodayDateOnlyKey();
    onChange(todayKey);
    const today = parseDateOnlyAsLocalDate(todayKey) || new Date();
    setMonth(today);
    setOpen(false);
  };

  const handleClear = () => {
    onChange("");
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
            .date-picker-field-calendar .rdp {
              --rdp-accent-color: #2563eb;
              --rdp-background-color: #eff6ff;
              margin: 0;
            }
            .date-picker-field-calendar .rdp-months {
              justify-content: center;
            }
            .date-picker-field-calendar .rdp-day_selected,
            .date-picker-field-calendar .rdp-day_selected:focus-visible,
            .date-picker-field-calendar .rdp-day_selected:hover {
              color: white;
              background-color: var(--rdp-accent-color);
            }
            .date-picker-field-calendar .rdp-button:hover:not([disabled]):not(.rdp-day_selected) {
              background-color: var(--rdp-background-color);
            }
            .dark .date-picker-field-calendar .rdp {
              --rdp-background-color: #1e293b;
            }
          `}</style>
          <div className="date-picker-field-calendar">
            <DayPicker
              mode="single"
              selected={selectedDate || undefined}
              month={month}
              onMonthChange={setMonth}
              onSelect={handleSelect}
              locale={getDateLocale()}
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
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={value}
          onChange={(event) => onChange(event.target.value)}
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
