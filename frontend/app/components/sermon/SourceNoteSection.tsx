'use client';

import { ArrowTopRightOnSquareIcon, ChevronRightIcon, RectangleStackIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import FoldableMarkdown from '@/components/ui/FoldableMarkdown';
import { findSectionByHeading, jumpToSection, useMarkdownOutline } from '@/hooks/useMarkdownOutline';
import { useSourceNotes } from '@/hooks/useSermonNoteLinks';
import { splitMarkdownSections, type MarkdownSection } from '@/utils/markdownSections';
import { countWords } from '@/utils/noteCutCorridor';

import type { ScratchNote, Sermon, StudyNote } from '@/models/models';

/**
 * Reading speed for prose a preacher studies rather than skims. The number is a label,
 * not a promise — it exists so "how long is this" has an answer in minutes instead of
 * characters, which tell a person nothing about whether they can read it before Sunday.
 */
const WORDS_PER_MINUTE = 180;

/** A request to open this note at one of its sections. `nonce` lets the same one re-fire. */
export interface RevealNoteSection {
  noteId: string;
  heading: string;
  nonce: number;
}

/**
 * THE NOTE AND THE ATOMS CUT FROM IT, AS ONE STREAM.
 *
 * This started as two stacked blocks: thoughts on top, note below. That layout was judged at
 * three thoughts and broke at twenty-eight — the note went five screens down, exactly when
 * there was most to work with. Ordering fixed part of it: the note does not grow, the thoughts
 * do, so the note goes first and folds to a bar.
 *
 * What actually dissolves the problem is here: the scratch atoms sit INSIDE the note, under the
 * heading each was cut from. There are no longer two blocks competing for the screen — there is
 * one document, and the work done on each part stands next to that part. The link was already in
 * the data (`ScratchNoteSource.heading`), so this costs no new storage and no new query; it only
 * stops being ignored. An atom whose heading matches nothing, and an atom written straight into
 * the scratch room with no note at all, stay where they were: this section shows what belongs to
 * the note, never invents a home for what does not.
 */
interface SourceNoteSectionProps {
  sermon: Sermon;
  /** The sermon's scratch atoms — the ones cut from this note are shown inside it. */
  scratchNotes?: ScratchNote[];
  /**
   * Whether the note arrives open. The caller decides by what the sermon HAS: with no
   * thoughts yet the note is the material, so it opens; once thoughts exist the person is
   * working in them, and the note waits as a bar.
   */
  defaultOpen?: boolean;
  revealRequest?: RevealNoteSection | null;
}

/**
 * Which atoms this section takes, so the caller shows only what is left and nothing appears twice.
 *
 * Ownership is the LINK, not the heading match: an atom cut from a note belongs to that note even
 * when the heading it remembers has since been renamed away. Such an atom is not dropped and not
 * exiled to a separate block — it opens the note, above its first words. An atom written straight
 * into the scratch room, with no note behind it, is not owned here and stays where it was.
 */
export const atomsOwnedByNotes = (notes: StudyNote[], scratchNotes: ScratchNote[]): Set<string> => {
  const linked = new Set(notes.map((note) => note.id));
  const owned = new Set<string>();
  for (const atom of scratchNotes) {
    if (atom.source && linked.has(atom.source.noteId)) owned.add(atom.id);
  }
  return owned;
};

const SourceNoteSection: React.FC<SourceNoteSectionProps> = ({
  sermon,
  scratchNotes = [],
  defaultOpen = true,
  revealRequest = null,
}) => {
  const { t } = useTranslation();
  const { notes } = useSourceNotes(sermon);

  if (notes.length === 0) return null;

  return (
    <section data-testid="source-note-section" className="mb-8 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{t('sermon.sourceNoteSection.title')}</h2>
      </div>
      {notes.map((note) => (
        <NoteCard
          key={note.id}
          note={note}
          scratchNotes={scratchNotes}
          defaultOpen={defaultOpen}
          revealRequest={revealRequest}
        />
      ))}
    </section>
  );
};

const NoteCard: React.FC<{
  note: StudyNote;
  scratchNotes: ScratchNote[];
  defaultOpen: boolean;
  revealRequest: RevealNoteSection | null;
}> = ({ note, scratchNotes, defaultOpen, revealRequest }) => {
  const { t, i18n } = useTranslation();
  const content = note.content ?? '';
  const control = useMarkdownOutline(content);
  const [open, setOpen] = useState(defaultOpen);
  /** A heading waiting to be revealed once the body is actually mounted. */
  const [pendingHeading, setPendingHeading] = useState<string | null>(null);

  const stats = useMemo(() => {
    const words = countWords(content);
    return { words, minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)) };
  }, [content]);

  /**
   * Atoms of this note, split into the ones that found their heading and the ones that did not.
   *
   * Homeless ones are not a separate block somewhere else — they open the note, before its first
   * words, because that is where a reader looks for "what do I have here". An atom cut from the
   * text above the first heading has always had an empty heading; one whose heading was renamed
   * away lands here too, and stays visible instead of vanishing.
   */
  const { atomsByHeading, looseAtoms } = useMemo(() => {
    const headings = new Set<string>();
    const walk = (sections: MarkdownSection[]) => {
      for (const section of sections) {
        headings.add(section.headingText.trim());
        walk(section.children);
      }
    };
    walk(splitMarkdownSections(content).sections);

    const grouped = new Map<string, ScratchNote[]>();
    const loose: ScratchNote[] = [];
    for (const atom of scratchNotes) {
      if (atom.source?.noteId !== note.id) continue;
      const heading = atom.source.heading?.trim();
      if (heading && headings.has(heading)) {
        const bucket = grouped.get(heading);
        if (bucket) bucket.push(atom);
        else grouped.set(heading, [atom]);
      } else {
        loose.push(atom);
      }
    }
    return { atomsByHeading: grouped, looseAtoms: loose };
  }, [scratchNotes, note.id, content]);

  /**
   * Every atom cut from THIS note, not only those whose heading matched a section. An atom
   * taken from the text before the first heading carries an empty `heading` and is not placed,
   * but it was still cut from the note — counting only the placed ones reported 21 of 22.
   */
  const cutTotal = useMemo(
    () => scratchNotes.filter((atom) => atom.source?.noteId === note.id).length,
    [scratchNotes, note.id]
  );

  /**
   * THE NOTE ARRIVES FOLDED — once, and only once.
   *
   * `useMarkdownOutline` starts with nothing collapsed, which is right on the study page where
   * the note IS the screen. Here it is a companion to the sermon, so what the reader meets is
   * its table of contents. Applied when the sections first appear rather than on mount, because
   * the note arrives from the cache a tick later; the ref keeps a later "expand all" from being
   * undone.
   */
  const foldedOnce = useRef(false);
  const { sectionIds, everythingCollapsed, toggleAll } = control;
  useEffect(() => {
    if (foldedOnce.current) return;
    if (sectionIds.length === 0) return;
    foldedOnce.current = true;
    if (!everythingCollapsed) toggleAll();
  }, [sectionIds, everythingCollapsed, toggleAll]);

  /** Opening the card is a state change; the section can only be found once its body exists. */
  useEffect(() => {
    if (!revealRequest || revealRequest.noteId !== note.id) return;
    setOpen(true);
    setPendingHeading(revealRequest.heading);
  }, [revealRequest, note.id]);

  useEffect(() => {
    if (!open || !pendingHeading) return;
    const id = findSectionByHeading(control.outline.sections, pendingHeading);
    setPendingHeading(null);
    if (id) jumpToSection(control, id);
  }, [open, pendingHeading, control]);

  const title = note.title?.trim() || t('studiesWorkspace.untitled');

  const sectionBadge = useCallback(
    (section: MarkdownSection) => {
      const count = atomsByHeading.get(section.headingText.trim())?.length;
      if (!count) return null;
      return (
        <span className="shrink-0 self-center rounded-full border border-violet-200 bg-violet-50 px-2 py-px text-[11px] text-violet-700 dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300">
          {t('sermon.sourceNoteSection.cutBadge', { count })}
        </span>
      );
    },
    [atomsByHeading, t]
  );

  /** The work done on this part of the note, standing right under the part itself. */
  const sectionExtra = useCallback(
    (section: MarkdownSection) => {
      const atoms = atomsByHeading.get(section.headingText.trim());
      if (!atoms?.length) return null;
      return <AtomStack atoms={atoms} testId="section-atoms" className="mb-3 mt-2" />;
    },
    [atomsByHeading]
  );

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      {/* Everything that acts on the note as a whole lives in this bar — folding it, folding
          its sections, opening the note itself. Kept out of the body on purpose: a control row
          above the first section stopped it being the container's first child, `first:mt-0`
          went dead, and a 40px section margin opened a 78px hole under the header. */}
      <div className="flex items-start gap-2 bg-emerald-50 px-4 py-3 dark:bg-emerald-950/40">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          data-testid="source-note-toggle"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <ChevronRightIcon
            className={`mt-0.5 h-5 w-5 shrink-0 text-emerald-600 transition-transform dark:text-emerald-400 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          <RectangleStackIcon className="mt-0.5 hidden h-5 w-5 shrink-0 text-emerald-600 sm:block dark:text-emerald-400" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              {t('sermon.sourceNoteSection.kicker')}
            </span>
            <span className="mt-0.5 block text-base font-semibold leading-snug text-gray-900 dark:text-gray-100">{title}</span>
            {/* Built from parts so a zero never reaches the screen: a note written without
                headings has no sections, and "разделов: 0" is a number that says nothing. */}
            <span className="mt-1 block text-xs text-gray-600 dark:text-gray-400">
              {[
                t('sermon.sourceNoteSection.stats', {
                  // The reader's own locale, not the runtime default: "6,304 слов" put an
                  // English thousands separator into a Russian sentence.
                  words: stats.words.toLocaleString(i18n.language),
                  minutes: stats.minutes,
                }),
                sectionIds.length > 0 ? t('sermon.sourceNoteSection.sections', { count: sectionIds.length }) : null,
                cutTotal > 0 ? t('sermon.sourceNoteSection.cutTotal', { count: cutTotal }) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {open && sectionIds.length > 1 && (
            <button
              type="button"
              onClick={toggleAll}
              data-testid="source-note-fold-all"
              className="rounded px-2 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
            >
              {everythingCollapsed ? t('textOutline.expandAll') : t('textOutline.collapseAll')}
            </button>
          )}
          <Link
            href={`/studies/${note.id}`}
            data-testid="source-note-open"
            className="flex items-center gap-1 rounded-lg border border-emerald-300 px-2.5 py-1 text-xs text-emerald-700 transition-colors hover:bg-emerald-100 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-900/40"
          >
            {t('sermon.sourceNoteSection.open')}
            <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {open && (
        <>
          {/* No height cap and no inner scrollbar: folding the sections already makes this
              short, and a scroll area inside a page that scrolls gives the reader two wheels
              for one document. */}
          <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            {looseAtoms.length > 0 && <AtomStack atoms={looseAtoms} testId="loose-atoms" className="mb-4" />}
            <FoldableMarkdown
              content={content}
              control={control}
              compact
              showToggleAll={false}
              sectionBadge={sectionBadge}
              sectionExtra={sectionExtra}
            />
          </div>
          <p className="border-t border-gray-200 px-4 py-2 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
            {t('sermon.sourceNoteSection.readOnly')}
          </p>
        </>
      )}
    </div>
  );
};

/** One shape for a scratch atom, wherever in the note it stands. */
const AtomStack: React.FC<{ atoms: ScratchNote[]; testId: string; className?: string }> = ({
  atoms,
  testId,
  className = '',
}) => (
  <div data-testid={testId} className={`space-y-1.5 ${className}`}>
    {atoms.map((atom) => (
      <p
        key={atom.id}
        className="rounded-md border-l-[3px] border-violet-300 bg-violet-50/60 px-3 py-2 text-sm leading-relaxed text-gray-700 dark:border-violet-700 dark:bg-violet-950/30 dark:text-gray-300"
      >
        {atom.text}
      </p>
    ))}
  </div>
);

export default SourceNoteSection;
