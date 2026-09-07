'use client';

import { XMarkIcon } from '@heroicons/react/20/solid';
import React from 'react';

import { buildChipClasses, type ChipSize, type ChipTone, type ChipWeight } from '@/utils/chipClasses';
import { CHIP_TONES } from '@/utils/themeColors';

export type { ChipSize, ChipTone, ChipWeight };

export interface ChipProps {
  /** What the chip says. Short — a chip is a label, not a sentence. */
  children: React.ReactNode;
  /** Category colour. See `CHIP_TONES` in `utils/themeColors.ts` for the full set. */
  tone?: ChipTone;
  /**
   * `md` is the app's chip: the size the Scripture reference on a study note has always
   * been, and now the size every other content label is. `sm` is for dense rows where
   * chips sit inside a card among running text; `xs` for micro labels like a calendar
   * row's PREACHED.
   */
  size?: ChipSize;
  /**
   * Ask for `bold` here rather than passing `font-bold` in `className` — Tailwind writes
   * `.font-medium` after `.font-bold`, so a className override loses without a warning.
   */
  weight?: ChipWeight;
  /** Drawn as picked out of a set: a heavier plate plus a ring. */
  selected?: boolean;
  /**
   * Makes the whole chip activatable — keyboard included. The event is handed over so a
   * chip sitting inside a link or a card row can stop the click from reaching its parent.
   */
  onClick?: (event: React.MouseEvent | React.KeyboardEvent) => void;
  /** Adds a trailing ✕. Its own button, so pressing it never fires `onClick`. */
  onRemove?: () => void;
  /**
   * Accessible name for that ✕. A chip is often just a word, so "Remove" alone tells a
   * screen-reader user nothing — pass the translated "Remove <thing>" where you can.
   */
  removeLabel?: string;
  /** Leading glyph — a structure mark, a small icon. Sits before the label. */
  icon?: React.ReactNode;
  /** Accessible name for the chip itself, when the visible text is an abbreviation. */
  ariaLabel?: string;
  title?: string;
  className?: string;
  /**
   * Escape hatch for the one family that cannot be a token: tags the preacher colours by
   * hand. Pass `tone="custom"` with it, or the token plate will paint over it.
   */
  style?: React.CSSProperties;
  disabled?: boolean;
  'data-testid'?: string;
}

const REMOVE_ICON_CLASSES: Record<ChipSize, string> = {
  xs: 'h-2.5 w-2.5',
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
};

/**
 * THE CHIP — one pill for the whole app.
 *
 * Every screen used to spell its own. The Scripture reference on a study note was `text-xs`
 * on a plain emerald plate; the tag directly beneath it was `text-sm` with a border; and the
 * two sat in the same 232px column reading as two unrelated controls. This component owns
 * the shape — radius, padding, type size, weight, hover, the ✕ and the keyboard contract —
 * and `CHIP_TONES` owns the colour, so a change to either reaches every pill at once.
 *
 * The outer element stays a `<span>` even when activatable, because a chip that can be
 * removed carries a real `<button>` inside it, and a button inside a button is not
 * something a browser will render. `role="button"` plus Enter and Space give the same
 * contract without the invalid nesting.
 */
export function Chip({
  children,
  tone = 'neutral',
  size = 'md',
  weight = 'medium',
  selected = false,
  onClick,
  onRemove,
  removeLabel,
  icon,
  ariaLabel,
  title,
  className = '',
  style,
  disabled = false,
  'data-testid': dataTestId,
}: ChipProps) {
  const interactive = Boolean(onClick) && !disabled;
  const showRemove = Boolean(onRemove) && !disabled;

  const classes = [
    buildChipClasses({ tone, size, weight, selected, interactive }),
    disabled ? 'cursor-not-allowed opacity-50' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      style={style}
      title={title}
      aria-label={ariaLabel}
      // A label carrying a name but no role is skipped by most screen readers, so an
      // abbreviation like "Ис.4:5-8" would be spelled out letter by letter. `img` is the
      // conventional role for "read my name, not my glyphs".
      role={interactive ? 'button' : ariaLabel ? 'img' : undefined}
      tabIndex={interactive ? 0 : undefined}
      // Present on every activatable chip, `false` included: a toggle that drops the
      // attribute when it is off stops announcing itself as a toggle exactly when the
      // state matters most.
      aria-pressed={interactive ? selected : undefined}
      aria-disabled={disabled || undefined}
      onClick={interactive ? onClick : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              // A key pressed on the ✕ inside belongs to the ✕. Without this the outer
              // handler swallows it, calls preventDefault, and Enter on "remove" opens the
              // editor instead of removing.
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onClick?.(event);
              }
            }
          : undefined
      }
      data-testid={dataTestId}
    >
      {icon}
      {/*
        Its own flex row rather than a plain wrapper: the chip's `gap` cannot reach inside a
        single child, so a chip built from several spans (a label plus a date, say) would
        run them together and every caller would have to re-add a margin by hand.
      */}
      <span className="inline-flex min-w-0 items-center gap-1.5">{children}</span>
      {showRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.();
          }}
          className={`ml-0.5 rounded-full p-0.5 transition-colors ${CHIP_TONES[tone].remove}`}
          aria-label={removeLabel}
        >
          <XMarkIcon className={REMOVE_ICON_CLASSES[size]} />
        </button>
      )}
    </span>
  );
}

export default Chip;
