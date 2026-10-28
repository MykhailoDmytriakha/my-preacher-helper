'use client';

import { ArrowsRightLeftIcon } from '@heroicons/react/20/solid';
import { Fragment, memo } from 'react';

import { CommentIcon } from '@/components/Icons';
import { Chip } from '@/components/ui/Chip';
import { parseVerse, type BookText, type VerseSegment } from '@/utils/bibleText';

import { CommentsOnText, type TextComment } from './CommentsOnText';
import { MineBadge as MineBadgeButton, MineMoreBadge } from './MineBadge';

import type { ChapterBoxes } from './useChapterWindow';
import type { CrossReferenceCount } from '@/utils/crossReferences';
import type { ScriptureUsageKind } from '@/utils/scriptureUsage';

/*
 * A BOOK OF THE BIBLE AS ONE RIBBON — chapters one after another, each verse a row with its number —
 * the one way a verse is drawn: the reader's ribbon and the verse window over a meeting draw it here,
 * so the two never drift apart. A row is `data-verse="chapter:verse"`; a passage is lit by setting
 * `data-arrival` on its rows ("on" lit, "off" fading); the container holding the ribbon must be
 * `isolate`, so the light lies under the text and over the container's own background.
 */

/** The attribute that lights a row: "on" lit, "off" fading back, absent dark. */
export const ARRIVAL_ATTRIBUTE = 'data-arrival';
/** A verse held under a finger or a mouse, and the verses chosen to copy: set on the row by the reader (`verseCopy/`), like the arrival. */
export const VERSE_HELD_ATTRIBUTE = 'data-verse-held';
export const VERSE_CHOSEN_ATTRIBUTE = 'data-verse-chosen';

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
 * A held or chosen verse lies on a light of its own under the arrival's, solid so that verses chosen one after
 * another read as one passage — rows overlap their lights — and quick both ways, unlike the arrival's slow fade.
 */
const CHOSEN_CLASSES = [
  'after:pointer-events-none after:absolute after:-inset-1.5 after:-z-10 after:rounded-lg after:transition-[background-color] after:duration-150',
  '[[data-verse-chosen]+&]:after:rounded-t-none [&:has(+[data-verse-chosen])]:after:rounded-b-none',
  'data-[verse-held]:after:bg-[#eef0fe] data-[verse-chosen]:after:bg-[#dfe3fc] dark:data-[verse-held]:after:bg-[#1f2547] dark:data-[verse-chosen]:after:bg-[#2c3566]',
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

/**
 * The person's own material on the text (`useBookUsage`, the owner's board 2026-10-21): after a verse a
 * badge for each kind and stretch starting there — the icon and colour of its section and the place it
 * holds, "3:16–18" — and after a chapter's heading one for what names the whole chapter, "3:1–36". Pressed, a badge
 * opens the list of what is there. A badge is outside the verse's words, like the links' chip.
 */
export type MineBadge = { kind: ScriptureUsageKind; label: string; count: number; ariaLabel: string };
export type RibbonMine = {
  /** The badges of the stretches starting at each verse ("chapter:verse"). */
  at: ReadonlyMap<string, readonly MineBadge[]>;
  /** The badges of what names a whole chapter. */
  chapters: ReadonlyMap<number, readonly MineBadge[]>;
  /** A verse's list, or a whole chapter's (`verse` null). */
  onOpen: (chapter: number, verse: number | null) => void;
  /** What the badge standing for the rest says to a screen reader; on screen it is "+2". */
  moreLabel: (count: number) => string;
  /**
   * Comments shown as their own words (`minePrefs.comments`, 'text'): under the verse a comment starts at, and
   * under every chapter heading of the chapters one is written to. Absent while comments show as badges.
   */
  comments?: {
    at: ReadonlyMap<string, readonly TextComment[]>;
    chapters: ReadonlyMap<number, readonly TextComment[]>;
    onEdit: (id: string) => void;
  };
};

/**
 * A chapter heading's door to a comment on the whole chapter (case 2026-10-12-block-diagram, 3.2): pressed, the
 * heading opens the chapter's comment window — a new one, or the one already written to it.
 */
export type RibbonChapterComment = { labelOf: (chapter: number) => string; open: (chapter: number) => void };

/** Badges after one verse before the rest fold into "+N": a long row would push the text away. */
export const MINE_BADGES_SHOWN = 3;

function MineBadges({ badges, mine, chapter, verse, testId }: { badges: readonly MineBadge[]; mine: RibbonMine; chapter: number; verse: number | null; testId: string }) {
  const open = () => mine.onOpen(chapter, verse);
  const shown = badges.length > MINE_BADGES_SHOWN ? badges.slice(0, MINE_BADGES_SHOWN - 1) : badges;
  const rest = badges.length - shown.length;
  return (
    <>
      {shown.map((badge) => (
        <Fragment key={`${badge.kind}:${badge.label}`}>
          {' '}
          <MineBadgeButton kind={badge.kind} label={badge.label} count={badge.count} ariaLabel={badge.ariaLabel} onClick={open} testId={`${testId}-${badge.kind}`} />
        </Fragment>
      ))}
      {rest > 0 ? (
        <>
          {' '}
          <MineMoreBadge count={rest} ariaLabel={mine.moreLabel(rest)} onClick={open} testId={`${testId}-more`} />
        </>
      ) : null}
    </>
  );
}

const VERSE_NUMBER_CLASSES = 'mr-1 inline-block select-none align-super text-[10px] font-semibold tabular-nums text-gray-400 md:mr-0 md:w-7 md:shrink-0 md:pt-[0.35rem] md:text-right md:text-xs dark:text-gray-500';

/** Where a verse or a chapter jumped to stands: the reading top, where "the verse I am at" is measured from. */
const READING_TOP = 'var(--reading-top)';

/** The verse text follows the app's text size (`--text-scale`, the "T" button), like the sermon and meeting screens. */
export const VERSE_TEXT_STYLE = { fontSize: 'calc(1.1875rem * var(--text-scale, 1))' };

/**
 * The chip after a verse: how many places its links lead to; pressed, it opens their list. Without
 * `onOpen` it is only its look — Settings → Bible shows a verse with it as it stands in the reader.
 */
export function CrossRefsChip({ count, label, onOpen, testId, phone = false }: { count: number; label?: string; onOpen?: () => void; testId?: string; phone?: boolean }) {
  return (
    <Chip
      size="sm"
      tone="indigo"
      weight="bold"
      icon={phone ? <><span className="md:hidden" aria-hidden="true">⇄</span><ArrowsRightLeftIcon className="hidden h-3 w-3 md:block" aria-hidden="true" /></> : <ArrowsRightLeftIcon className="h-3 w-3" aria-hidden="true" />}
      ariaLabel={label}
      onClick={onOpen}
      className={`align-[0.15em] font-sans ${phone ? 'max-md:gap-0 max-md:border-0 max-md:bg-transparent dark:max-md:bg-transparent max-md:px-0 max-md:py-0 max-md:align-super max-md:text-[10px]' : ''}`}
      data-testid={testId}
    >
      {count}
    </Chip>
  );
}

function VerseRow({ chapter, verse, raw, lang, crossRefs, signs, mine, detached = false, lit }: {
  chapter: number; verse: number; raw: string; lang: string; crossRefs?: RibbonCrossRefs; signs?: RibbonSigns; mine?: RibbonMine;
  /** A row of a chapter shown apart from the reader's book (`ChapterVerses`): not `data-verse`, so it is never taken for the place read or a verse to mark. */
  detached?: boolean;
  /** Lit from the start; rows of the ribbon are lit by the screen setting `data-arrival` itself. */
  lit?: boolean;
}) {
  const { opensParagraph, segments } = parseVerse(raw);
  const sign = signs?.at.get(`${chapter}:${verse}`);
  const count = crossRefs?.counts.get(`${chapter}:${verse}`);
  const shown = count ? (crossRefs?.mode === 'all' ? count.total : count.main) : 0;
  const badges = mine?.at.get(`${chapter}:${verse}`);
  const comments = mine?.comments?.at.get(`${chapter}:${verse}`);
  return (
    // A verse jumped to stands where "the verse I am at" is measured from: the same `--reading-top`.
    <div
      data-verse={detached ? undefined : `${chapter}:${verse}`}
      {...(lit ? { [ARRIVAL_ATTRIBUTE]: 'on' } : {})}
      style={{ scrollMarginTop: READING_TOP }}
      className={`mb-2.5 md:mb-0 md:flex md:flex-wrap md:gap-x-3 ${ARRIVAL_CLASSES} ${detached ? '' : CHOSEN_CLASSES} ${opensParagraph && verse > 1 ? 'md:mt-2' : ''}`}
    >
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
      <p style={VERSE_TEXT_STYLE} className="inline min-w-0 font-serif md:block md:flex-1 leading-[1.65] text-gray-800 dark:text-gray-100">
        {/* The verse's own words, apart from the chip: marks count and paint them (`marks/verseWordDom.ts`).
            They are in their Bible's language whatever the interface speaks: a screen reader reads them so. */}
        <span data-verse-text={detached ? undefined : ''} lang={lang}>
          {segments.map((segment, index) =>
            segment.kind === 'break' ? <br key={index} /> : <Fragment key={index}><Segment segment={segment} /></Fragment>
          )}
        </span>
        {crossRefs && shown > 0 ? (
          <>
            {' '}
            <CrossRefsChip
              phone
              count={shown}
              label={crossRefs.chipLabel(verse, shown)}
              onOpen={() => crossRefs.onOpen(chapter, verse)}
              testId={`cross-refs-${chapter}:${verse}`}
            />
          </>
        ) : null}
        {mine && badges ? <span className="md:contents max-md:inline-block max-md:origin-left max-md:scale-90 max-md:align-super"><MineBadges badges={badges} mine={mine} chapter={chapter} verse={verse} testId={`mine-${chapter}:${verse}`} /></span> : null}
      </p>
      {/* Under the verse's words, the whole width of the text column: the row's light and choice cover it too. */}
      {mine?.comments && comments ? (
        <CommentsOnText comments={comments} onEdit={mine.comments.onEdit} testId={`comments-${chapter}:${verse}`} className="mt-1 md:mb-1 md:basis-full md:pl-10" />
      ) : null}
    </div>
  );
}

/**
 * The whole book as one ribbon: chapters follow each other with only a thin line between them. With
 * `boxes` (a big book in the reader, `useChapterWindow`) only the chapters around the place read are
 * drawn; every other one is a box of its height with its heading (`data-box`), so the scroll still spans
 * the whole book and a fast scroll shows the chapters it passes.
 */
export const BookRibbon = memo(function BookRibbon({ text, lang, chapterWord, crossRefs, signs, mine, chapterComment, boxes }: {
  text: BookText; lang: string; chapterWord: (chapter: number) => string; crossRefs?: RibbonCrossRefs; signs?: RibbonSigns; mine?: RibbonMine;
  chapterComment?: RibbonChapterComment; boxes?: ChapterBoxes | null;
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
            <div className="flex items-center gap-3 pb-2 md:pl-10">
              <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
                {chapterComment ? (
                  <button
                    type="button"
                    onClick={() => chapterComment.open(chapter)}
                    aria-label={`${chapterWord(chapter)} — ${chapterComment.labelOf(chapter)}`}
                    title={chapterComment.labelOf(chapter)}
                    data-testid={`chapter-comment-${chapter}`}
                    className="group inline-flex items-center gap-1.5 rounded-md transition-colors hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 dark:hover:text-gray-200"
                  >
                    {chapterWord(chapter)}
                    {/* Under a mouse it shows on hover; a finger has no hover, so on a touch screen it stays, faint. */}
                    <CommentIcon className="h-3.5 w-3.5 opacity-40 transition-opacity group-focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-visible:opacity-100" />
                  </button>
                ) : chapterWord(chapter)}
              </h2>
              {mine && mine.chapters.get(chapter) ? (
                <span className="-ml-2 inline-flex items-center">
                  <MineBadges badges={mine.chapters.get(chapter)!} mine={mine} chapter={chapter} verse={null} testId={`mine-chapter-${chapter}`} />
                </span>
              ) : null}
              <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" aria-hidden="true" />
            </div>
            {/* A comment written to the whole chapter stands under its heading — under each heading, for several. */}
            {!box && mine?.comments && mine.comments.chapters.get(chapter) ? (
              <CommentsOnText comments={mine.comments.chapters.get(chapter)!} onEdit={mine.comments.onEdit} testId={`comments-chapter-${chapter}`} className="mb-2 md:pl-10" />
            ) : null}
            {box ? null : verses.map((raw, verseIndex) => (
              <VerseRow key={verseIndex} chapter={chapter} verse={verseIndex + 1} raw={raw} lang={lang} crossRefs={crossRefs} signs={signs} mine={mine} />
            ))}
          </section>
        );
      })}
    </>
  );
});

/**
 * One chapter drawn on its own, as the ribbon draws it — a link's chapter in the window of a verse's
 * links (`CrossReferenceSheet`), the passage lit. Its rows are detached: the reader's marks and its
 * place read look rows up by `data-verse`, and this chapter is not the book being read.
 */
export function ChapterVerses({ chapter, verses, lang, lit }: {
  chapter: number; verses: readonly string[]; lang: string; lit: (verse: number) => boolean;
}) {
  return (
    <>
      {verses.map((raw, verseIndex) => (
        <VerseRow key={verseIndex} chapter={chapter} verse={verseIndex + 1} raw={raw} lang={lang} detached lit={lit(verseIndex + 1)} />
      ))}
    </>
  );
}
