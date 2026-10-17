'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { MARK_COLORS, PENCIL_COLORS, type PencilColor } from '@/utils/bibleMarks';

import { EraserIcon, MARK_SWATCH, MarkerIcon, PENCIL_SWATCH, PencilIcon } from './MarkToolIcons';

import type { MarkToolState } from './markTool';

/*
 * THE THREE TOOLS IN THE READER'S LINE (the owner's design, 2026-10-16): the marker, the pencil, the
 * eraser. The marker and the pencil, taken, open their colours to their left, over the free room of the
 * line — the line itself does not move (in the phone's column they open upwards) — and keep them out
 * while in hand: the open colours are how the person sees the tool is taken (`markTool.ts`). A tool in
 * hand wears a ring; pressed again, or Escape, puts it away. Nothing here animates: a ring that faded
 * in over 150 ms read as a slow tap on the iPad. What the colours mean is told under the "T"
 * (`MarkLegend`) and, on a computer, by the colour's own tip on hover.
 */
const TAKEN = 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white dark:ring-white dark:ring-offset-gray-900';
/** The tool an Apple Pencil paints with while nothing is in hand: shown, not taken. */
const PEN_TOOL = 'ring-2 ring-gray-300 ring-offset-2 ring-offset-white dark:ring-gray-600 dark:ring-offset-gray-900';
/** Beside the tools in a line the colours open to the left; over a column (a phone) they open upwards. */
const PALETTE_LEFT = 'right-[calc(100%+0.375rem)] top-1/2 -translate-y-1/2 px-2 py-1.5';
const PALETTE_UP = 'bottom-[calc(100%+0.375rem)] left-1/2 -translate-x-1/2 flex-col px-1.5 py-2';
/**
 * A tool lights up under a mouse or a trackpad only: on a touch screen a hover stays on the circle after
 * the tap, and a tool put away would still look pressed (the owner, 2026-10-16).
 */
const TOOL = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 [@media(hover:hover)]:hover:bg-gray-100 dark:[@media(hover:hover)]:hover:bg-gray-800';

type Swatch = { id: string; color: string; label: string; chosen: boolean; pick: () => void };

/*
 * Both palettes stay in the page and are only hidden: Chrome checks the app shell's `:has()` rules
 * (`globals.css`, the reader's panes) on every element put into the page, and a palette put in and
 * taken out on each tool restyled the whole book — 150 ms a tap in the Psalms (2026-10-16, traced).
 */
function Palette({ swatches, label, vertical, open }: { swatches: Swatch[]; label: string; vertical: boolean; open: boolean }) {
  return (
    <div
      role="group"
      aria-label={label}
      hidden={!open}
      className={`absolute z-40 items-center gap-2 rounded-full bg-white shadow-lg ring-1 ring-gray-900/10 dark:bg-gray-800 dark:ring-white/10 ${open ? 'flex' : 'hidden'} ${vertical ? PALETTE_UP : PALETTE_LEFT}`}
    >
      {swatches.map((swatch) => (
        <button
          key={swatch.id}
          type="button"
          onClick={swatch.pick}
          aria-pressed={swatch.chosen}
          aria-label={swatch.label}
          title={swatch.label}
          style={{ backgroundColor: swatch.color }}
          className={`h-[30px] w-[30px] shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(17,24,39,0.18)] ${swatch.chosen ? TAKEN : ''}`}
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
  useEffect(() => {
    if (!holding) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') putAway();
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
    <div data-mark-toolbar="" role="toolbar" aria-label={t('bible.marks.toolbar')} aria-orientation={vertical ? 'vertical' : 'horizontal'} className={`relative flex items-center gap-2.5 ${vertical ? 'flex-col' : ''} ${className}`}>
      <span className="relative flex">
        <Palette swatches={markerSwatches} label={t('bible.marks.colors')} vertical={vertical} open={palette === 'marker'} />
        <button
          type="button"
          onClick={() => pressColored('marker')}
          aria-pressed={inHand === 'marker'}
          aria-expanded={palette === 'marker'}
          aria-label={markerLabel}
          title={markerLabel}
          className={`${TOOL} ${ring('marker')}`}
        >
          <MarkerIcon nib={color} />
        </button>
      </span>
      <span className="relative flex">
        <Palette swatches={pencilSwatches} label={t('bible.marks.pencilColors')} vertical={vertical} open={palette === 'pencil'} />
        <button
          type="button"
          onClick={() => pressColored('pencil')}
          aria-pressed={inHand === 'pencil'}
          aria-expanded={palette === 'pencil'}
          aria-label={pencilLabel}
          title={pencilLabel}
          className={`${TOOL} ${ring('pencil')}`}
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
      >
        <EraserIcon />
      </button>
    </div>
  );
}
