"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useUserChurches } from "@/hooks/useUserChurches";
import { Church } from "@/models/models";

interface ChurchFieldProps {
  /** The church currently chosen, or undefined when nothing has been named yet. */
  value?: Church;
  /**
   * Raised on every keystroke as well as on a pick from history. `undefined` means the
   * field was cleared, which callers must be able to store as "no church stated".
   */
  onChange: (church: Church | undefined) => void;
  id?: string;
  disabled?: boolean;
  /** Renders without its own label, for callers that print one themselves. */
  hideLabel?: boolean;
  placeholder?: string;
  /** Prints how many churches the history holds. Off by default: it is chrome. */
  showHistoryCount?: boolean;
  inputClassName?: string;
}

const EMPTY_CHURCH_ID = "";

/**
 * ONE church picker for the whole app.
 *
 * Churches are not a collection of their own: the list is derived from every church the
 * person has already named (`useUserChurches`). So the field has to do two things at
 * once — offer that history, and accept a name that has never been used before.
 *
 * DELIBERATELY NOT a Headless UI combobox, and the reason is a bug this replaced: that
 * component owns the input's text and rewrites it to the *selected option* whenever the
 * list closes — Escape, blur, a click elsewhere. A newly typed church matches no option,
 * so the name disappeared from the field while the form still held it, and the screen
 * disagreed with what would be saved. It also made the rest of the form inert while open,
 * putting Save out of reach of the keyboard. A plain input with its own suggestion list
 * has neither problem: nothing but this component ever writes the text.
 *
 * The city travels silently. Picking from history keeps the city that church was recorded
 * with; a fresh name leaves it empty, to be filled in Calendar where there is room.
 */
export default function ChurchField({
  value,
  onChange,
  id,
  disabled = false,
  hideLabel = false,
  placeholder,
  showHistoryCount = false,
  inputClassName,
}: ChurchFieldProps) {
  const { t } = useTranslation();
  const { availableChurches } = useUserChurches();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const inputId = id ?? `church-${generatedId}`;
  const listId = `${inputId}-suggestions`;

  const name = value?.name ?? "";

  const suggestions = useMemo(() => {
    const needle = name.trim().toLowerCase();
    if (!needle) return availableChurches;
    return availableChurches.filter((church) =>
      `${church.name} ${church.city || ""}`.toLowerCase().includes(needle)
    );
  }, [name, availableChurches]);

  const isNewName =
    name.trim().length > 0 &&
    !availableChurches.some((church) => church.name.toLowerCase() === name.trim().toLowerCase());

  // Closing on an outside press, rather than on blur: blur fires before the click on a
  // suggestion lands, which would close the list out from under the finger choosing it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pick = (church: Church) => {
    onChange(church);
    setOpen(false);
    setHighlighted(-1);
  };

  const handleType = (typed: string) => {
    setOpen(true);
    setHighlighted(-1);
    if (!typed.trim()) {
      // An empty field means "no church stated" — NOT a church whose name is blank.
      onChange(undefined);
      return;
    }
    // A hand-typed name keeps the city of the church it is replacing only while the name
    // still matches it; otherwise this is a different congregation.
    const keepsCity = value && value.name === typed;
    onChange({
      id: keepsCity ? value.id : EMPTY_CHURCH_ID,
      name: typed,
      city: keepsCity ? value.city : "",
    });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setHighlighted((current) => (suggestions.length ? (current + 1) % suggestions.length : -1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) =>
        suggestions.length ? (current <= 0 ? suggestions.length - 1 : current - 1) : -1
      );
      return;
    }
    if (event.key === "Enter" && open && highlighted >= 0 && suggestions[highlighted]) {
      // Only swallow Enter when it is actually choosing something; otherwise it must stay
      // available to submit the form this field usually sits in.
      event.preventDefault();
      pick(suggestions[highlighted]);
      return;
    }
    if (event.key === "Escape" && open) {
      // Closes the list and nothing else. The typed name is the person's, not ours.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setHighlighted(-1);
    }
  };

  return (
    <div ref={wrapperRef}>
      {!hideLabel && (
        <label htmlFor={inputId} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
          {t("calendar.church")}
        </label>
      )}
      <div className="relative mt-1">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          value={name}
          disabled={disabled}
          placeholder={placeholder ?? t("calendar.churchAutocomplete.placeholder")}
          onChange={(event) => handleType(event.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className={
            inputClassName ??
            "block w-full rounded-xl border border-gray-300 bg-white p-3 pr-12 text-gray-900 transition focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-700 dark:text-white"
          }
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 disabled:opacity-60"
        >
          <ChevronsUpDown className="h-5 w-5" />
        </button>

        {open && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-gray-200 bg-white py-1 text-sm shadow-lg dark:border-gray-700 dark:bg-gray-800"
          >
            {suggestions.length === 0 ? (
              <li className="px-4 py-2 text-gray-500 dark:text-gray-400">
                {availableChurches.length === 0
                  ? t("calendar.churchAutocomplete.emptyHistory")
                  : t("calendar.churchAutocomplete.noMatch")}
              </li>
            ) : (
              suggestions.map((church, index) => {
                const selected = church.name === name && (church.city || "") === (value?.city || "");
                const active = index === highlighted;
                return (
                  <li key={`${church.name}-${church.city || "no-city"}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      // Pointer-down rather than click: the field's own outside-press
                      // listener must not win the race against choosing a suggestion.
                      onPointerDown={(event) => {
                        event.preventDefault();
                        pick(church);
                      }}
                      onMouseEnter={() => setHighlighted(index)}
                      className={`relative flex w-full items-center gap-2 py-2 pl-9 pr-4 text-left ${
                        active ? "bg-blue-600 text-white" : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {selected && <Check className="absolute left-2 h-4 w-4" aria-hidden="true" />}
                      <span className="block truncate">
                        {church.name}
                        {church.city && (
                          <span
                            className={`ml-1 text-xs ${
                              active ? "text-blue-100" : "text-gray-500 dark:text-gray-400"
                            }`}
                          >
                            ({church.city})
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        )}
      </div>

      {isNewName && (
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("calendar.churchAutocomplete.noMatch")}
        </p>
      )}
      {showHistoryCount && !isNewName && (
        <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {availableChurches.length > 0
            ? t("calendar.churchAutocomplete.historyCount", { count: availableChurches.length })
            : t("calendar.churchAutocomplete.emptyHistory")}
        </p>
      )}
    </div>
  );
}
