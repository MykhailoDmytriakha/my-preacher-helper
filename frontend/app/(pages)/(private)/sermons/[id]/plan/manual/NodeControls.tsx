"use client";

import { Check, Plus, Trash2, X } from "lucide-react";
import React, { useState } from "react";

/**
 * ADDING A NODE WITHOUT LEAVING THE PAGE.
 *
 * "I threw the points and sub-points together from my phone, then filled them in" only
 * works if the skeleton grows where the writing happens. Sending someone to the plan
 * editor and back is two screens for one thought, and the thought cools on the way.
 *
 * Collapsed to a single line until pressed, so a finished outline stays quiet. The
 * confirm button is visible on purpose: the bare field taught nothing, and "press Enter"
 * is an instruction the form should not need. Committing on blur is deliberately absent —
 * a click meant to cancel must not create a point.
 */
export const AddNodeButton = ({
  label,
  placeholder,
  confirmLabel,
  cancelLabel,
  onAdd,
  className = "",
}: {
  label: string;
  placeholder: string;
  confirmLabel: string;
  cancelLabel: string;
  onAdd: (text: string) => void;
  className?: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");

  const commit = () => {
    const value = text.trim();
    if (value) {
      onAdd(value);
    }
    setText("");
    setIsOpen(false);
  };

  const cancel = () => {
    setText("");
    setIsOpen(false);
  };

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 transition-colors hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-200 ${className}`}
      >
        <Plus className="h-4 w-4" />
        {label}
      </button>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        autoFocus
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Escape") {
            cancel();
          }
        }}
        className="flex-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:border-blue-400 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
      />
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={commit}
        disabled={text.trim() === ""}
        className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Check className="h-4 w-4" />
        {confirmLabel}
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={cancel}
        className="inline-flex items-center rounded-md border border-gray-300 p-1.5 text-gray-500 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
        title={cancelLabel}
        aria-label={cancelLabel}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
};

/**
 * TWO-STEP DELETE, NO BLOCKING DIALOG.
 *
 * `window.confirm` is ruled out for the same reason the plan editor rules it out
 * (`components/plan-editor/OutlineBoard.tsx`): it blocks, and this project confirms with
 * its own components. First press arms the button and says what will happen, second
 * carries it out, moving away disarms it.
 *
 * Confirming at all is not ceremony: a node usually holds writing by the time someone
 * decides it does not belong, and losing that to a mis-tap is damage this screen must not
 * do quietly.
 */
export const DeleteNodeButton = ({
  title,
  armedTitle,
  armedLabel,
  onDelete,
  compact = false,
}: {
  title: string;
  /** The full consequence — what will be lost or moved. Tooltip and screen reader. */
  armedTitle: string;
  /** The short word shown inside the armed button, so a heading row keeps its shape. */
  armedLabel: string;
  onDelete: () => void;
  compact?: boolean;
}) => {
  const [isArmed, setIsArmed] = useState(false);

  const sizeClasses = compact ? "p-1" : "px-2 py-1 h-8";
  const iconClasses = compact ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <button
      type="button"
      onClick={() => {
        if (isArmed) {
          setIsArmed(false);
          onDelete();
          return;
        }
        setIsArmed(true);
      }}
      onBlur={() => setIsArmed(false)}
      onMouseLeave={() => setIsArmed(false)}
      className={`inline-flex shrink-0 items-center gap-1.5 self-center rounded-md text-sm font-medium transition-colors ${sizeClasses} ${
        isArmed
          ? "bg-red-600 text-white hover:bg-red-700"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
      }`}
      title={isArmed ? armedTitle : title}
      aria-label={isArmed ? armedTitle : title}
    >
      <Trash2 className={iconClasses} />
      {isArmed && <span>{armedLabel}</span>}
    </button>
  );
};
