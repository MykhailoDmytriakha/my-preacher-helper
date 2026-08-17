'use client';

import { RectangleStackIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useSourceNotes } from '@/hooks/useSermonNoteLinks';
import { getNavItemTheme } from '@/utils/themeColors';

import type { Sermon } from '@/models/models';

/**
 * "BUILT ON THIS NOTE" — one chip per source note, and each one is the way in.
 *
 * It sits in the identity row of the sermon header, beside the series badge, because that row
 * is where the app already answers "what is this sermon part of". Two deliberate differences
 * from the series badge keep the row readable rather than competitive: the series pill is
 * FILLED with the series' own colour (membership — a strong fact), while this one is a tinted
 * outline in the STUDIES accent (provenance — a quieter one), and it carries the studies icon
 * so the destination is recognisable before the text is read.
 *
 * Nothing is rendered when there is no link: an empty placeholder would occupy the calmest
 * part of a screen people open to preach from. The way to ADD a link lives in the sermon's
 * own actions menu, exactly where "add to series" already lives.
 */
interface SourceNoteChipsProps {
  sermon: Sermon;
}

const SourceNoteChips: React.FC<SourceNoteChipsProps> = ({ sermon }) => {
  const { t } = useTranslation();
  const { notes } = useSourceNotes(sermon);

  if (notes.length === 0) return null;

  const theme = getNavItemTheme('studies');

  return (
    <>
      {notes.map((note, index) => {
        const title = note.title?.trim() || t('studiesWorkspace.untitled');
        return (
          <Link
            key={note.id}
            href={`/studies/${note.id}`}
            data-testid="source-note-chip"
            title={t('sermon.sourceNotes.chipTitle', { title })}
            aria-label={t('sermon.sourceNotes.openNote', { title })}
            className={`inline-flex max-w-[15rem] items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${theme.pill}`}
          >
            <RectangleStackIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {/* The prefix is said ONCE, on the first chip. Seen live with two notes linked, "На
                основе" repeated on every chip and the row started reading as a stutter; the
                studies icon already says what the rest of them are. It also must never wrap —
                broken over two lines it made the chip taller than the badge beside it, so a long
                TITLE truncates instead. The accessible name below still names both, for every
                chip, because a screen reader has no row to look along. */}
            {index === 0 && (
              <span className="shrink-0 font-normal opacity-70">{t('sermon.sourceNotes.label')}</span>
            )}
            <span className="truncate">{title}</span>
          </Link>
        );
      })}
    </>
  );
};

export default SourceNoteChips;
