"use client";

import { LockClosedIcon, LockOpenIcon } from "@heroicons/react/24/outline";
import React from "react";

const BASE_CLASS =
  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 dark:focus-visible:ring-blue-300";
const LOCKED_CLASS =
  "border-slate-300 bg-slate-200 text-slate-700 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-600";
const UNLOCKED_CLASS =
  "border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-gray-800 dark:text-slate-300 hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-gray-700";

type LockToggleButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "title" | "aria-label" | "aria-pressed"
> & {
  isLocked: boolean;
  /**
   * What pressing does now: "Lock thought", "Unlock all thoughts in this structure point".
   * The label carries the state, so the button has no aria-pressed: a screen reader would
   * otherwise hear "Unlock thought, pressed" (WAI-ARIA button pattern — one or the other).
   */
  label: string;
  /** Section tint for the open lock; the closed lock keeps the neutral locked tone. */
  unlockedIconClassName?: string;
};

/**
 * The one lock toggle of the structure screen. A thought card locks one thought and a
 * plan point header locks all of its thoughts — the same action, so both draw this button.
 */
export function LockToggleButton({
  isLocked,
  label,
  unlockedIconClassName = "",
  className = "",
  type = "button",
  ...buttonProps
}: LockToggleButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      className={`${BASE_CLASS} ${isLocked ? LOCKED_CLASS : UNLOCKED_CLASS} ${className}`}
      title={label}
      aria-label={label}
      data-state={isLocked ? "locked" : "unlocked"}
    >
      {isLocked ? (
        <LockClosedIcon className="h-5 w-5" />
      ) : (
        <LockOpenIcon className={`h-5 w-5 ${unlockedIconClassName}`} />
      )}
    </button>
  );
}
