'use client';

import { useLayoutEffect, useState, type RefObject } from 'react';

import { versePosition, type LaidParagraph } from './commentParagraphs';

/** One piece of the drawing, in px from the text card's padding box. */
type Piece = { key: string; kind: 'line' | 'thick' | 'ring' | 'station' | 'end'; x: number; y: number; h?: number; light?: boolean };

/** How far left of the verses the line runs (its middle), and how near the screen's edge it may come on a phone. */
const LINE_OFFSET = 17.5;
const EDGE = 6;

const PIECE_CLASSES: Record<Piece['kind'], string> = {
  line: 'w-[2px] -translate-x-1/2 bg-gray-400 dark:bg-gray-500',
  thick: 'w-1 -translate-x-1/2 bg-gray-400 dark:bg-gray-500',
  ring: 'h-[11px] w-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[2.5px] border-gray-500 bg-white dark:border-gray-400 dark:bg-gray-900',
  station: 'h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-500 dark:bg-gray-400',
  end: 'h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-500 dark:bg-gray-400',
};

/**
 * THE LINE BESIDE THE PARAGRAPHS (the owner, 31.10: «одна линия, тип метро»): an outer paragraph is one line from a ring at
 * its heading to a dot at its last verse — through a chapter's heading too; a paragraph inside it is a station on that same
 * line, the line thicker along it. Drawn over the text card from where the headings and verses stand — the room above a
 * heading and after a paragraph, a chapter's heading in between, a phone's spacing are all measured, not reckoned — and
 * measured again whenever the card's size changes (text drawn, a comment added, the text size, the width).
 */
export function ParagraphLines({ root, laid, drawn }: {
  /** The text card the ribbon is drawn in (`position: relative`). */
  root: RefObject<HTMLElement | null>;
  /** The paragraphs on the text; none — nothing drawn. */
  laid?: readonly LaidParagraph[];
  /** The chapters drawn of a big book: rows come and go. */
  drawn?: unknown;
}) {
  const [pieces, setPieces] = useState<Piece[]>([]);
  useLayoutEffect(() => {
    const card = root.current;
    if (!card || !laid?.length) { setPieces([]); return undefined; }
    const measure = () => {
      const box = card.getBoundingClientRect();
      const left = box.left + card.clientLeft;
      const top = box.top + card.clientTop;
      const find = (selector: string) => card.querySelector<HTMLElement>(selector);
      const headOf = (id: string) => find(`[data-paragraph-head="${id}"]`);
      // The rows drawn now, by their place in the book: a big book draws only the chapters around the place read.
      const rows = [...card.querySelectorAll<HTMLElement>('[data-verse]')].map((row) => {
        const [chapter, verse] = (row.dataset.verse ?? '').split(':').map(Number);
        return { row, at: versePosition(chapter, verse) };
      });
      const drawnIn = (paragraph: LaidParagraph) => rows.filter(({ at }) => paragraph.span.from <= at && at <= paragraph.span.to).map(({ row }) => row);
      // A heading's middle is its comment sign's: the line's ring and stations stand level with it.
      const middleOf = (head: HTMLElement) => {
        const sign = head.querySelector('button')?.getBoundingClientRect() ?? head.getBoundingClientRect();
        return sign.top + sign.height / 2 - top;
      };
      // Where a paragraph's line runs among the rows drawn: from its heading, or the first row drawn when the heading is
      // not; to its last verse, or the last row drawn when that is not (a big book's far chapters) — ring and end dot
      // only where its heading and last verse are on the page.
      const runOf = (paragraph: LaidParagraph) => {
        const inside = drawnIn(paragraph);
        const head = headOf(paragraph.id);
        if (!inside.length) return null;
        const lastShown = inside[inside.length - 1].dataset.verse === paragraph.last;
        return {
          head,
          from: head ? middleOf(head) : inside[0].getBoundingClientRect().top - top,
          to: inside[inside.length - 1].getBoundingClientRect().bottom - (lastShown ? 6 : 0) - top,
          lastShown,
          left: inside[0].getBoundingClientRect().left,
        };
      };
      const next: Piece[] = [];
      for (const outer of laid.filter((paragraph) => paragraph.level === 0)) {
        const run = runOf(outer);
        if (!run) continue;
        const x = Math.max(run.left - LINE_OFFSET, EDGE) - left;
        const inner = laid.filter((paragraph) => paragraph.level === 1 && outer.span.from <= paragraph.span.from && paragraph.span.to <= outer.span.to);
        next.push({ key: `${outer.id}-line`, kind: 'line', x, y: run.from, h: run.to - run.from, light: inner.length > 0 });
        inner.forEach((paragraph) => {
          const part = runOf(paragraph);
          if (!part) return;
          next.push({ key: `${paragraph.id}-thick`, kind: 'thick', x, y: part.from, h: part.to - part.from });
          if (part.head) next.push({ key: `${paragraph.id}-station`, kind: 'station', x, y: part.from });
          // An inner paragraph ends with a dot too, as on the owner's board (01.11).
          if (part.lastShown) next.push({ key: `${paragraph.id}-end`, kind: 'end', x, y: part.to });
        });
        if (run.head) next.push({ key: `${outer.id}-ring`, kind: 'ring', x, y: run.from });
        if (run.lastShown) next.push({ key: `${outer.id}-end`, kind: 'end', x, y: run.to });
      }
      setPieces(next);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(card);
    return () => observer.disconnect();
  }, [root, laid, drawn]);
  if (!pieces.length) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0" data-testid="paragraph-lines">
      {pieces.map((piece) => (
        <span
          key={piece.key}
          data-piece={piece.kind}
          className={`absolute ${PIECE_CLASSES[piece.kind]} ${piece.light ? '!bg-gray-300 dark:!bg-gray-600' : ''}`}
          style={{ left: piece.x, top: piece.y, ...(piece.h !== undefined ? { height: Math.max(0, piece.h) } : {}) }}
        />
      ))}
    </div>
  );
}
