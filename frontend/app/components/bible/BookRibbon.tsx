'use client';

import { ArrowsRightLeftIcon } from '@heroicons/react/20/solid';
import { Fragment, memo } from 'react';

import { Chip } from '@/components/ui/Chip';
import { parseVerse, type BookText, type VerseSegment } from '@/utils/bibleText';

import type { ChapterBoxes } from './useChapterWindow';
import type { CrossReferenceCount } from '@/utils/crossReferences';

/*
 * A BOOK OF THE BIBLE AS ONE RIBBON — chapters one after another, each verse a row with its number —
 * the one way a verse is drawn: the reader's ribbon and the verse window over a meeting draw it here,
 * so the two never drift apart. A row is `data-verse="chapter:verse"`; a passage is lit by setting
 * `data-arrival` on its rows ("on" lit, "off" fading); the container holding the ribbon must be
 * `isolate`, so the light lies under the text and over the container's own background.
 */

/** The attribute that lights a row: "on" lit, "off" fading back, absent dark. */
export const ARRIVAL_ATTRIBUTE = 'data-arrival';

function Segment({ segment }: { segment: Extract<VerseSegment, { kind: 'text' }> }) {
  const className = [
    segment.added ? 'italic text-gray-500 dark:text-gray-400' : '',
    segment.jesus ? 'text-rose-800 dark:text-rose-300' : '',
  ].filter(Boolean).join(' ');
  return className ? <span className={className}>{segment.text}</span> : <>{segment.text}</>;
}

/**
 * A verse a link came to is lit at once (`data-arrival="on"`) and, the attribute taken away, fades
 * back to the page on its own. The light is one layer under the text (`::before`, below the text
 * card's own layer — the card is `isolate`), 6 px wider than the verse on every side, so it moves
 * no line. One layer, not a background plus a ring: rows stand on fractional pixels, and the two
 * edges, each smoothed on its own, left a light line between lit verses. The colour is solid, the
 * indigo tint already mixed into the card: the layers of a passage overlap, and a see-through tint
 * darkens where they meet. Lit verses standing together are one block — only the first rounds its
 * top corners and only the last its bottom ones, so the edges run straight.
 */
const ARRIVAL_CLASSES = [
  'relative before:pointer-events-none before:absolute before:-inset-1.5 before:-z-10 before:rounded-lg',
  '[[data-arrival]+&]:before:rounded-t-none [&:has(+[data-arrival])]:before:rounded-b-none',
  'before:transition-[background-color] before:duration-[3600ms] before:ease-out data-[arrival=on]:before:duration-0',
  'data-[arrival=on]:before:bg-[#e8e8fd] dark:data-[arrival=on]:before:bg-[#272f51]',
].join(' ');
/**
 * Cross references drawn with the verses (`utils/crossReferences.ts` counts them): a verse that has
 * links carries a chip with the count of its main ones — or of all, as the person chose — and its
 * number opens them too, so a verse with no main link still leads to the rest.
 */
export type RibbonCrossRefs = {
  counts: ReadonlyMap<string, CrossReferenceCount>;
  mode: 'main' | 'all';
  onOpen: (chapter: number, verse: number) => void;
  verseLabel: (verse: number) => string;
  chipLabel: (verse: number, count: number) => string;
};

/**
 * Verses marked in another Bible of the person (`marks/`, `utils/bibleMarks.ts`): beside the number, in
 * the text's margin, a thin stripe of the marks' colours; it opens the verse as it is marked there. The
 * stripe stands outside the row's flow, so no line moves.
 */
export type RibbonSigns = {
  /** The colours of each signed verse ("chapter:verse"), in order. */
  at: ReadonlyMap<string, readonly string[]>;
  label: (verse: number) => string;
  onOpen: (chapter: number, verse: number) => void;
};

const VERSE_NUMBER_CLASSES = 'w-7 shrink-0 select-none pt-[0.35rem] text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500';

/** Where a verse or a chapter jumped to stands: the reading top, where "the verse I am at" is measured from. */
const READING_TOP = 'var(--reading-top)';

/** The verse text follows the app's text size (`--text-scale`, the "T" button), like the sermon and meeting screens. */
const VERSE_TEXT_STYLE = { fontSize: 'calc(1.1875rem * var(--text-scale, 1))' };

function VerseRow({ chapter, verse, raw, lang, crossRefs, signs }: { chapter: number; verse: number; raw: string; lang: string; crossRefs?: RibbonCrossRefs; signs?: RibbonSigns }) {
  const { opensParagraph, segments } = parseVerse(raw);
  const sign = signs?.at.get(`${chapter}:${verse}`);
  const count = crossRefs?.counts.get(`${chapter}:${verse}`);
  const shown = count ? (crossRefs?.mode === 'all' ? count.total : count.main) : 0;
  return (
    // A verse jumped to stands where "the verse I am at" is measured from: the same `--reading-top`.
    <div data-verse={`${chapter}:${verse}`} style={{ scrollMarginTop: READING_TOP }} className={`flex gap-3 ${ARRIVAL_CLASSES} ${opensParagraph && verse > 1 ? 'mt-2' : ''}`}>
      {signs && sign ? (
        <button
          type="button"
          onClick={() => signs.onOpen(chapter, verse)}
          aria-label={signs.label(verse)}
          data-testid={`marked-elsewhere-${chapter}:${verse}`}
          className="absolute -left-3 bottom-1 top-1.5 flex w-3 justify-center"
        >
          <span aria-hidden="true" className="flex w-1 flex-col overflow-hidden rounded-full">
            {sign.map((color, index) => <span key={index} className="flex-1" style={{ backgroundColor: color }} />)}
          </span>
        </button>
      ) : null}
      {crossRefs && count ? (
        <button
          type="button"
          onClick={() => crossRefs.onOpen(chapter, verse)}
          aria-label={crossRefs.verseLabel(verse)}
          className={`${VERSE_NUMBER_CLASSES} self-start hover:text-indigo-600 dark:hover:text-indigo-300`}
        >
          {verse}
        </button>
      ) : (
        <span className={VERSE_NUMBER_CLASSES}>{verse}</span>
      )}
      <p style={VERSE_TEXT_STYLE} className="min-w-0 flex-1 font-serif leading-[1.65] text-gray-800 dark:text-gray-100">
        {/* The verse's own words, apart from the chip: marks count and paint them (`marks/verseWordDom.ts`).
            They are in their Bible's language whatever the interface speaks: a screen reader reads them so. */}
        <span data-verse-text="" lang={lang}>
          {segments.map((segment, index) =>
            segment.kind === 'break' ? <br key={index} /> : <Fragment key={index}><Segment segment={segment} /></Fragment>
          )}
        </span>
        {crossRefs && shown > 0 ? (
          <>
            {' '}
            <Chip
              size="sm"
              tone="indigo"
              weight="bold"
              icon={<ArrowsRightLeftIcon className="h-3 w-3" aria-hidden="true" />}
              ariaLabel={crossRefs.chipLabel(verse, shown)}
              onClick={() => crossRefs.onOpen(chapter, verse)}
              className="align-[0.15em] font-sans"
              data-testid={`cross-refs-${chapter}:${verse}`}
            >
              {shown}
            </Chip>
          </>
        ) : null}
      </p>
    </div>
  );
}

/**
 * The whole book as one ribbon: chapters follow each other with only a thin line between them. With
 * `boxes` (a big book in the reader, `useChapterWindow`) only the chapters around the place read are
 * drawn; every other one is a box of its height with its heading (`data-box`), so the scroll still spans
 * the whole book and a fast scroll shows the chapters it passes.
 */
export const BookRibbon = memo(function BookRibbon({ text, lang, chapterWord, crossRefs, signs, boxes }: {
  text: BookText; lang: string; chapterWord: (chapter: number) => string; crossRefs?: RibbonCrossRefs; signs?: RibbonSigns; boxes?: ChapterBoxes | null;
}) {
  return (
    <>
      {text.chapters.map((verses, chapterIndex) => {
        const chapter = chapterIndex + 1;
        const box = boxes ? chapter < boxes.span.first || chapter > boxes.span.last : false;
        return (
          // The room above a chapter is a margin, outside the section: a jump puts the heading at the
          // reading top and the last verse of the chapter before stays above it, not counted as the place.
          <section
            key={chapter}
            aria-label={chapterWord(chapter)}
            data-chapter={chapter}
            data-box={box ? '' : undefined}
            style={box && boxes ? { scrollMarginTop: READING_TOP, height: `${boxes.height(chapter)}px` } : { scrollMarginTop: READING_TOP }}
            className={chapterIndex === 0 ? '' : 'mt-6'}
          >
            <div className="flex items-center gap-3 pb-2 pl-10">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">{chapterWord(chapter)}</h2>
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
            </div>
            {box ? null : verses.map((raw, verseIndex) => (
              <VerseRow key={verseIndex} chapter={chapter} verse={verseIndex + 1} raw={raw} lang={lang} crossRefs={crossRefs} signs={signs} />
            ))}
          </section>
        );
      })}
    </>
  );
});
