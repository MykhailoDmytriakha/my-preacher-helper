"use client";

import { Bars3Icon } from '@heroicons/react/24/outline';
import { Trash2 } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PointNote from '@/components/PointNote';

import type { DragHandleProps } from '@/components/plan-editor/OutlineBoard';
import type { ScratchNote } from '@/models/models';
import type { ScratchPlacement } from '@/utils/scratchPlacementRemap';

export interface ScratchPlaceTarget {
  key: string;
  label: string;
  depth: 0 | 1;
  target: ScratchPlacement | null;
}

interface ScratchNoteCardProps {
  note: ScratchNote;
  isReadOnly?: boolean;
  /** The copy that flies under the finger: the text to recognise it by and the handle, nothing to press. */
  isOverlay?: boolean;
  dragHandleProps?: DragHandleProps | null;
  onEdit: (noteId: string, text: string) => void;
  onDelete: (noteId: string) => void;
  onUnplace?: (noteId: string) => void;
  /** Where the note can be filed without dragging; the entry it is in now is left out. */
  placeTargets?: ScratchPlaceTarget[];
  currentTargetKey?: string;
  onPlaceInto?: (noteId: string, target: ScratchPlacement | null) => void;
}

const NOTE_CARD_CLASS = 'group rounded-lg border border-gray-200 bg-white p-3 shadow-sm transition-all duration-150 dark:border-gray-700 dark:bg-gray-800';

/**
 * The scratch board edits scratch notes with the plan editor's `PointNote`. Left alone,
 * that shared component labels everything "reminder note" — a DIFFERENT entity in this
 * app (a hint pinned to a finished plan point), which made the whole screen read as if
 * it were about notes rather than scratch. Same wording for the pool cards and for the
 * point notes, because on this board they hold the same thing: a placed scratch note.
 */
export function useScratchNoteLabels() {
  const { t } = useTranslation();
  return useMemo(
    () => ({
      label: t("scratch.card.label"),
      placeholder: t("scratch.card.placeholder"),
      clear: t("scratch.card.delete"),
      add: t("scratch.card.add"),
    }),
    [t]
  );
}

export default function ScratchNoteCard({
  note,
  isReadOnly = false,
  isOverlay = false,
  dragHandleProps,
  onEdit,
  onDelete,
  onUnplace,
  placeTargets,
  currentTargetKey,
  onPlaceInto,
}: ScratchNoteCardProps) {
  const { t } = useTranslation();
  const scratchNoteLabels = useScratchNoteLabels();
  const [isPlaceMenuOpen, setIsPlaceMenuOpen] = useState(false);
  const placeMenuRef = useRef<HTMLDivElement | null>(null);
  const placeMenuListRef = useRef<HTMLDivElement | null>(null);
  const placeMenuTriggerRef = useRef<HTMLButtonElement | null>(null);

  /** Close, and hand focus back to the button that opened it — a menu must not swallow focus. */
  const closePlaceMenu = useCallback((restoreFocus: boolean) => {
    setIsPlaceMenuOpen(false);
    if (restoreFocus) placeMenuTriggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isPlaceMenuOpen) return;
    // Focus lands on the first choice, so arrows and Enter work at once.
    placeMenuListRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!placeMenuRef.current?.contains(event.target as Node)) setIsPlaceMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [isPlaceMenuOpen]);

  const onPlaceMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(placeMenuListRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (index: number) => items[(index + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusAt(current - 1);
        break;
      case "Home":
        event.preventDefault();
        focusAt(0);
        break;
      case "End":
        event.preventDefault();
        focusAt(items.length - 1);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        closePlaceMenu(true);
        break;
      default:
        break;
    }
  };

  if (isOverlay) {
    /*
     * A tall note in the air is clipped to a few lines — the eye needs to recognise
     * it, not read it — and the handle row stays at the bottom, where the finger
     * picked the card up. No editor, no buttons: nothing here can be pressed.
     */
    return (
      <div
        className={[NOTE_CARD_CLASS, "pointer-events-none border-indigo-300 shadow-2xl shadow-indigo-900/30 dark:border-indigo-500/60"].join(" ")}
        data-testid={`scratch-note-overlay-${note.id}`}
      >
        <div className="line-clamp-4 whitespace-pre-wrap break-words text-sm italic text-gray-700 dark:text-gray-200">
          {note.text}
        </div>
        <div className="mt-2 flex items-center border-t border-gray-100 pt-2 dark:border-gray-700/60">
          <span className="flex h-10 w-11 items-center justify-center text-gray-400 dark:text-gray-500">
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
      </div>
    );
  }

  const handleNoteChange = (nextNote: string | undefined) => {
    if (nextNote) {
      onEdit(note.id, nextNote);
      return;
    }
    onDelete(note.id);
  };

  const placeChoices = (placeTargets ?? []).filter((choice) => choice.key !== currentTargetKey);
  const actionControls = !isReadOnly ? (
    <div className="flex shrink-0 items-center gap-1">
      {onPlaceInto && placeChoices.length > 0 && (
        /*
         * THE PATH WITHOUT DRAGGING. On a phone the pool is a screen above the
         * plan, and a keyboard cannot drag at all; the same outcome as a drop —
         * "this note goes there" — has to be reachable with one tap. The note
         * lands at the end of the chosen container.
         */
        <div ref={placeMenuRef} className="relative" onKeyDown={isPlaceMenuOpen ? onPlaceMenuKeyDown : undefined}>
          <button
            ref={placeMenuTriggerRef}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setIsPlaceMenuOpen((open) => !open);
            }}
            aria-haspopup="menu"
            aria-expanded={isPlaceMenuOpen}
            className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            {t("scratch.card.placeInto")}
          </button>
          {isPlaceMenuOpen && (
            <div
              ref={placeMenuListRef}
              role="menu"
              aria-label={t("scratch.card.placeIntoMenu")}
              className="absolute right-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
            >
              {placeChoices.map((choice) => (
                <button
                  key={choice.key}
                  type="button"
                  role="menuitem"
                  onClick={(event) => {
                    event.stopPropagation();
                    closePlaceMenu(true);
                    onPlaceInto(note.id, choice.target);
                  }}
                  className={`block w-full truncate px-3 py-1.5 text-left text-sm transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-700 dark:focus:bg-gray-700 ${
                    choice.depth === 1 ? "pl-7 text-gray-600 dark:text-gray-300" : "text-gray-800 dark:text-gray-100"
                  }`}
                  title={choice.label}
                >
                  {choice.depth === 1 ? "↳ " : ""}
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {onUnplace && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onUnplace(note.id);
          }}
          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
        >
          {t("scratch.board.unplace")}
        </button>
      )}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(note.id);
        }}
        className="rounded-md p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-300"
        aria-label={t("scratch.card.delete")}
      >
        <Trash2 className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  ) : null;

  return (
    <div
      className={[
        NOTE_CARD_CLASS,
      ].join(" ")}
      data-testid={`scratch-note-card-${note.id}`}
    >
      <div className="min-w-0">
        <div className="min-w-0">
          <div
            className="-mt-1"
            data-testid={`scratch-note-point-note-${note.id}`}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {/* This card holds a SCRATCH note, not a plan point's reminder note — the
                editor is shared, so its wording has to be overridden here. */}
            <PointNote
              note={note.text}
              onChange={handleNoteChange}
              isReadOnly={isReadOnly}
              addRevealClass="opacity-100"
              hideClearButton
              tone="neutral"
              labels={scratchNoteLabels}
            />
          </div>
        </div>
        {!isReadOnly && (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-gray-100 pt-2 dark:border-gray-700/60">
            {dragHandleProps && (
              <button
                type="button"
                {...dragHandleProps}
                /*
                 * 44px, and `touch-none`: on a phone the handle must own the gesture,
                 * otherwise the page scrolls out from under the finger and cancels it.
                 */
                className="flex h-10 w-11 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                aria-label={t("common.dragToReorder")}
                onClick={(event) => event.stopPropagation()}
              >
                <Bars3Icon className="h-5 w-5" aria-hidden="true" />
              </button>
            )}
            <div className="ml-auto">{actionControls}</div>
          </div>
        )}
      </div>
    </div>
  );
}
