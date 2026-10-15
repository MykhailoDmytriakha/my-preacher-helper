'use client';

import { Fragment, memo } from 'react';

import { parseVerse, type BookText, type VerseSegment } from '@/utils/bibleText';

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
function VerseRow({ chapter, verse, raw, lang }: { chapter: number; verse: number; raw: string; lang: string }) {
  const { opensParagraph, segments } = parseVerse(raw);
  return (
    // A verse jumped to stands where "the verse I am at" is measured from: the same `--reading-top`.
    <div data-verse={`${chapter}:${verse}`} style={{ scrollMarginTop: 'var(--reading-top)' }} className={`flex gap-3 ${ARRIVAL_CLASSES} ${opensParagraph && verse > 1 ? 'mt-2' : ''}`}>
      <span className="w-7 shrink-0 select-none pt-[0.35rem] text-right text-xs font-semibold tabular-nums text-gray-400 dark:text-gray-500">
        {verse}
      </span>
      {/* The text is in its Bible's language whatever the interface speaks: a screen reader reads it so. */}
      <p lang={lang} className="min-w-0 flex-1 font-serif text-[1.1875rem] leading-[1.65] text-gray-800 dark:text-gray-100">
        {segments.map((segment, index) =>
          segment.kind === 'break' ? <br key={index} /> : <Fragment key={index}><Segment segment={segment} /></Fragment>
        )}
      </p>
    </div>
  );
}

/** The whole book as one ribbon: chapters follow each other with only a thin line between them. */
export const BookRibbon = memo(function BookRibbon({ text, lang, chapterWord }: { text: BookText; lang: string; chapterWord: (chapter: number) => string }) {
  return (
    <>
      {text.chapters.map((verses, chapterIndex) => {
        const chapter = chapterIndex + 1;
        return (
          // The room above a chapter is a margin, outside the section: a jump puts the heading at the
          // reading top and the last verse of the chapter before stays above it, not counted as the place.
          <section key={chapter} aria-label={chapterWord(chapter)} data-chapter={chapter} style={{ scrollMarginTop: 'var(--reading-top)' }} className={chapterIndex === 0 ? '' : 'mt-6'}>
            <div className="flex items-center gap-3 pb-2 pl-10">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">{chapterWord(chapter)}</h2>
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
            </div>
            {verses.map((raw, verseIndex) => (
              <VerseRow key={verseIndex} chapter={chapter} verse={verseIndex + 1} raw={raw} lang={lang} />
            ))}
          </section>
        );
      })}
    </>
  );
});
