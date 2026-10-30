'use client';

import { useEffect, useRef, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';

import { keyboardReaches } from '@/hooks/modalLayers';
import { MARK_COLORS, PENCIL_COLORS, type PencilColor } from '@/utils/bibleMarks';
import { pointerHover } from '@/utils/pointerHover';

import { EraserIcon, MARK_SWATCH, MarkerIcon, PENCIL_SWATCH, PencilIcon } from './MarkToolIcons';

import type { MarkToolState } from './markTool';

/*
 * THE THREE TOOLS IN THE READER'S LINE (the owner's design, 2026-10-16): the marker, the pencil, the
 * eraser. The marker and the pencil, taken, open their colours in the row itself, just before the tool in
 * hand, and keep them out while in hand: the open colours are how the person sees the tool is taken
 * (`markTool.ts`). The row makes room — on a wide screen the tools stand at the line's right end and the
 * ones before the tool move left; in the phone's column, held from below, they move up — so no tool is
 * ever covered: opened over the free room before, the pencil's colours hid the marker, and a second tap
 * was needed to reach it (the owner's choice on the canvas, 2026-10-17: "the three move apart"). A tool in
 * hand wears a ring; pressed again, or Escape, puts it away. Nothing here fades: a ring that faded in over
 * 150 ms read as a slow tap on the iPad. What the colours mean is told under the "T" (`MarkLegend`) and,
 * on a computer, by the colour's own tip on hover.
 */
const TAKEN = 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-gray-900';
/** The tool an Apple Pencil paints with while nothing is in hand: shown, not taken. */
const PEN_TOOL = 'ring-2 ring-gray-300 ring-offset-2 ring-offset-white dark:ring-gray-600 dark:ring-offset-gray-900';
/**
 * In a line the colours are a pill of their own; in the phone's column, already a pill, they stand in it
 * as the tools do. `--gap`: what shows between a colour and its ring — the pill behind it.
 */
const PALETTE_LINE = 'px-2 py-1.5 rounded-full bg-white shadow-lg ring-1 ring-gray-900/10 [--gap:#ffffff] dark:bg-gray-800 dark:ring-white/10 dark:[--gap:#1f2937]';
const PALETTE_COLUMN = 'flex-col [--gap:#ffffff] dark:[--gap:#111827]';
/**
 * A tool lights up under a mouse, a trackpad or an Apple Pencil held over it, never after a finger's tap:
 * a hover left on the circle made a tool put away look pressed (`utils/pointerHover.ts`, the owner, 2026-10-16).
 * Lit, it grows a little, its disc fills indigo and its drawing tilts, as a tool picked up
 * (`MarkToolIcons`; the owner's choice on the canvas, 2026-10-17: "taking it in hand"). Only the size and
 * the tilt move; a tool taken shows its ring at once.
 */
const TOOL = 'group inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 data-[hover]:scale-[1.08] motion-reduce:transition-none';
/**
 * A colour of the palette under a mouse or a Pencil: a crisp ring of its own colour, apart from it by a
 * thin gap of the pill (`--ring`; the owner's choice on the canvas, 2026-10-17: "a clear ring"), and a
 * touch larger — the colour about to be taken is the one ringed.
 */
const SWATCH = 'h-[30px] w-[30px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(17,24,39,0.18)] transition-transform duration-150 ease-out data-[hover]:scale-[1.06] data-[hover]:shadow-[inset_0_0_0_1px_rgba(17,24,39,0.18),0_0_0_2px_var(--gap),0_0_0_5px_var(--ring)] motion-reduce:transition-none';

type Swatch = { id: string; color: string; label: string; chosen: boolean; pick: () => void };

/*
 * Both palettes stay in the page and are only hidden: Chrome checks the app shell's `:has()` rules
 * (`globals.css`, the reader's panes) on every element put into the page, and a palette put in and
 * taken out on each tool restyled the whole book — 150 ms a tap in the Psalms (2026-10-16, traced).
 * Open, a palette stands in the row before its tool and the row makes room for it.
 */
function Palette({ swatches, label, vertical, open }: { swatches: Swatch[]; label: string; vertical: boolean; open: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      hidden={!open}
      data-mark-palette=""
      className={`items-center gap-2 ${open ? 'flex' : 'hidden'} ${vertical ? PALETTE_COLUMN : PALETTE_LINE}`}
    >
      {swatches.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          onClick={swatch.pick}
          aria-pressed={swatch.chosen}
          aria-label={swatch.label}
          title={swatch.label}
          style={{ backgroundColor: swatch.color, '--ring': swatch.color } as CSSProperties}
          className={`${SWATCH} ${swatch.chosen ? TAKEN : ''}`}
          {...pointerHover}
        />
      ))}
    </div>
  );
}

export function MarkToolbar({ tool, vertical = false, className = '' }: { tool: MarkToolState; vertical?: boolean; className?: string }) {
  const { t } = useTranslation();
  const { inHand, color, pencilColor, palette, penTool, pressColored, pressEraser, pickColor, pickPencilColor, putAway } = tool;
  const ring = (name: 'marker' | 'pencil' | 'eraser') => (inHand === name ? TAKEN : penTool === name ? PEN_TOOL : '');

  const holding = inHand !== null;
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!holding) return undefined;
    // Escape puts the tool away and is spent: the window these tools stand in (a passage's analysis) must not close on
    // the same press — it re-listened at once with the tool already away and took it (2026-10-30). Tools under a window
    // leave the key to it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !keyboardReaches(rootRef.current)) return;
      event.stopPropagation();
      putAway();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [holding, putAway]);

  const meaning = (id: string) => t(`bible.marks.meaning.${id}`);
  const pencilMeaning = (id: PencilColor) => (id === 'gray' ? t('bible.marks.plainPencil') : meaning(id));
  const markerSwatches: Swatch[] = MARK_COLORS.map((id) => ({ id, color: MARK_SWATCH[id], label: meaning(id), chosen: id === color, pick: () => pickColor(id) }));
  const pencilSwatches: Swatch[] = PENCIL_COLORS.map((id) => ({ id, color: PENCIL_SWATCH[id], label: pencilMeaning(id), chosen: id === pencilColor, pick: () => pickPencilColor(id) }));
  const markerLabel = t('bible.marks.marker', { meaning: meaning(color) });
  const pencilLabel = t('bible.marks.pencil', { meaning: pencilMeaning(pencilColor) });

  return (
    <div ref={rootRef} data-mark-toolbar="" role="toolbar" aria-label={t('bible.marks.toolbar')} aria-orientation={vertical ? 'vertical' : 'horizontal'} className={`relative flex items-center gap-2.5 ${vertical ? 'flex-col' : ''} ${className}`}>
      <span className={`flex items-center gap-2.5 ${vertical ? 'flex-col' : ''}`}>
        <Palette swatches={markerSwatches} label={t('bible.marks.colors')} vertical={vertical} open={palette === 'marker'} />
        <button
          type="button"
          onClick={() => pressColored('marker')}
          aria-pressed={inHand === 'marker'}
          aria-expanded={palette === 'marker'}
          aria-label={markerLabel}
          title={markerLabel}
          className={`${TOOL} ${ring('marker')}`}
          {...pointerHover}
        >
          <MarkerIcon nib={color} />
        </button>
      </span>
      <span className={`flex items-center gap-2.5 ${vertical ? 'flex-col' : ''}`}>
        <Palette swatches={pencilSwatches} label={t('bible.marks.pencilColors')} vertical={vertical} open={palette === 'pencil'} />
        <button
          type="button"
          onClick={() => pressColored('pencil')}
          aria-pressed={inHand === 'pencil'}
          aria-expanded={palette === 'pencil'}
          aria-label={pencilLabel}
          title={pencilLabel}
          className={`${TOOL} ${ring('pencil')}`}
          {...pointerHover}
        >
          <PencilIcon line={pencilColor} />
        </button>
      </span>
      <button
        type="button"
        onClick={pressEraser}
        aria-pressed={inHand === 'eraser'}
        aria-label={t('bible.marks.eraser')}
        title={t('bible.marks.eraser')}
        className={`${TOOL} ${ring('eraser')}`}
        {...pointerHover}
      >
        <EraserIcon />
      </button>
    </div>
  );
}
