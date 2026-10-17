import { MARK_COLORS, type MarkColor, type PencilColor } from '@/utils/bibleMarks';

import type { ReactNode } from 'react';


/*
 * THE THREE TOOLS AS DRAWN (the owner's choice on the canvas "Путь в Библию", 2026-10-16): an outlined
 * highlighter over its five colours, its nib the colour in hand; an outlined pencil whose point rests on
 * its line, the pencil's colour in hand; a white-and-pink eraser. One size, one line (1.34 px at 40 px), one ink, all at 45°.
 * Drawn on a 40-unit square; the colours of a swatch are the marks' own (`MARK_SWATCH`).
 */
export const MARK_SWATCH: Record<MarkColor, string> = {
  red: '#e5484d',
  green: '#30a46c',
  yellow: '#f5c400',
  orange: '#f76b15',
  blue: '#3e63dd',
};

/** The pencil's line colours: plain graphite grey, and the five as lines. */
export const PENCIL_SWATCH: Record<PencilColor, string> = { gray: '#8b8f98', ...MARK_SWATCH };

/*
 * Under a mouse or a Pencil held over the tool (its button carries `group` and `data-hover`, see
 * `MarkToolbar`) the disc fills indigo and its rim turns indigo — the disc covers the whole button, so a
 * background of the button alone was hidden behind it (the owner's iPad, 2026-10-16: "the hover is
 * faint") — and the drawing tilts, as a tool picked up (`TILT`; the owner's choice on the canvas,
 * 2026-10-17: "taking it in hand"). It turns about the disc's centre, with a small overshoot.
 */
const DISC = 'fill-white stroke-gray-900/20 dark:fill-gray-800 dark:stroke-white/20 group-data-[hover]:fill-indigo-100 group-data-[hover]:stroke-indigo-500 dark:group-data-[hover]:fill-indigo-900 dark:group-data-[hover]:stroke-indigo-300';
const INK = 'stroke-gray-600 dark:stroke-gray-300';
const PAPER = 'fill-white dark:fill-gray-800 group-data-[hover]:fill-indigo-100 dark:group-data-[hover]:fill-indigo-900';
const TILT = 'origin-[20px_20px] transition-transform duration-[260ms] ease-[cubic-bezier(.34,1.56,.64,1)] group-data-[hover]:-translate-y-px group-data-[hover]:-rotate-[16deg] motion-reduce:transition-none';

/** The tool's drawing, which tilts as the tool is picked up; the disc and the colours under it stay. */
function Drawing({ children }: { children: ReactNode }) {
  return <g className={TILT}>{children}</g>;
}

function Disc() {
  return <circle cx="20" cy="20" r="19.4" strokeWidth="1.2" className={DISC} />;
}

export function MarkerIcon({ nib, size = 40 }: { nib: MarkColor; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="block">
      <Disc />
      <Drawing>
        <g transform="translate(17.6 20.9) rotate(45) scale(0.8) translate(-20 -20)" fill="none" strokeWidth="1.68" strokeLinejoin="round" className={INK}>
          <rect x="14.2" y="3.5" width="11.6" height="13.5" rx="1.8" className={PAPER} />
          <rect x="15.8" y="17" width="8.4" height="4.6" className={PAPER} />
          <path d="M17 21.6h6v4.6l-6 3.2z" fill={MARK_SWATCH[nib]} />
        </g>
      </Drawing>
      {MARK_COLORS.map((color, index) => (
        <rect key={color} x={10.2 + index * 4.05} y="27.7" width="3.5" height="4.6" rx="1.2" fill={MARK_SWATCH[color]} />
      ))}
    </svg>
  );
}

export function PencilIcon({ line = 'gray', size = 40 }: { line?: PencilColor; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="block">
      <Disc />
      <Drawing>
        <g transform="translate(21.2 21) rotate(45) scale(0.815) translate(-20 -20)" fill="none" strokeWidth="1.65" strokeLinejoin="round" strokeLinecap="round" className={INK}>
          <path d="M16.5 8.5a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5V25l-3.5 7.4L16.5 25z" />
          <path d="M16.5 25h7" />
          <path d="M16.5 11h7" />
        </g>
      </Drawing>
      <path d="M10 30h20" strokeWidth="2.2" strokeLinecap="round" stroke={PENCIL_SWATCH[line]} />
    </svg>
  );
}

export function EraserIcon({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="block">
      <Disc />
      <Drawing>
        <g transform="translate(20 20) rotate(-45) scale(0.795) translate(-20 -20)" strokeWidth="1.69" className={INK}>
          <rect x="7" y="14.5" width="26" height="11" rx="2.6" className={PAPER} />
          <path d="M9.6 14.5H18v11H9.6A2.6 2.6 0 0 1 7 22.9v-5.8a2.6 2.6 0 0 1 2.6-2.6z" fill="#f49fb0" />
        </g>
      </Drawing>
    </svg>
  );
}
