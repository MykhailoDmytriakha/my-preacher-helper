'use client';

import { BookOpenIcon, PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { formatDateOnly } from '@/utils/dateFormatter';
import { NOTE_TO_SERMON_COLORS, SOURCE_NOTE_COLORS } from '@/utils/themeColors';

import CreateSermonFromNoteModal from './CreateSermonFromNoteModal';

import type { ScriptureReference, Sermon } from '@/models/models';

/**
 * WHAT TELLS TWO SERMONS FROM THE SAME NOTE APART.
 *
 * A note is usually preached under one theme, so the titles of the sermons grown out of it
 * open with the same words and, cut to the width of a 232px column, read as duplicates of
 * one another. The passage is what actually differs — it is chosen per sermon at the moment
 * the sermon is born — so it leads the line and the date follows. A sermon with no verse yet
 * simply shows the date: the separator never appears on its own.
 */
const sermonMetaLine = (sermon: Sermon): string =>
  [sermon.verse?.replace(/\s+/g, ' ').trim(), formatDateOnly(sermon.date)].filter(Boolean).join(' \u00b7 ');

/**
 * THE OTHER DIRECTION, ON THE NOTE'S OWN PAGE: what was preached out of this — and the
 * door to preach something new out of it.
 *
 * Nothing here is stored on the note — the list is derived from the sermons that name it, so
 * it cannot fall out of step with what the sermon screen shows. It joins the note's metadata
 * tray beside scripture references and tags, and wears the same shape as they do: a heading
 * with an icon, then the items, then the action. The heading stays even when the list is
 * empty, so the section reads the same on every note and the door is never an orphaned
 * button at the bottom of a panel.
 *
 * Rows carry the SERMONS accent (blue) rather than the studies green: the colour says where
 * the click goes. The name owns the row — full column width, up to two lines — because a
 * name sharing its line with a date had 142px left and was cut at seventeen characters,
 * which turned two different sermons into two identical-looking rows. Verse and date step
 * down to a quieter second line, where they identify the row without competing for it.
 */
interface SermonsBuiltOnNoteProps {
  noteId: string | undefined;
  noteTitle?: string;
  scriptureRefs?: ScriptureReference[];
  /** The note's text, measured locally to say how many scratch notes to expect. */
  noteContent?: string;
  /**
   * The note has edits the server has not confirmed (typing, or a save in flight). The
   * cut reads the STORED note, so opening the door now would cut a version the person is
   * no longer looking at; the button waits, and says why.
   */
  noteBusy?: boolean;
}

const SermonsBuiltOnNote: React.FC<SermonsBuiltOnNoteProps> = ({
  noteId,
  noteTitle = '',
  scriptureRefs = [],
  noteContent = '',
  noteBusy = false,
}) => {
  const { t } = useTranslation();
  const { sermons } = useSermonsBuiltOnNote(noteId);
  const [creating, setCreating] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  if (!noteId) return null;

  return (
    <div className="flex flex-col gap-3" data-testid="sermons-built-on-note">
      <div className={`flex items-center gap-2 ${SOURCE_NOTE_COLORS.reverseHeading}`}>
        <BookOpenIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium">{t('studiesWorkspace.builtSermons.title')}</span>
        {sermons.length > 0 && (
          <span
            data-testid="built-sermons-count"
            aria-hidden="true"
            className={`shrink-0 rounded-full px-1.5 text-[11px] font-semibold leading-4 ${NOTE_TO_SERMON_COLORS.builtCount}`}
          >
            {sermons.length}
          </span>
        )}
      </div>

      {sermons.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {sermons.map((sermon) => (
            <li key={sermon.id} className="min-w-0">
              <Link
                href={`/sermons/${sermon.id}`}
                data-testid="built-sermon-link"
                aria-label={t('studiesWorkspace.builtSermons.openSermon', { title: sermon.title })}
                className={`flex w-full min-w-0 flex-col gap-0.5 rounded-lg border px-2.5 py-2 transition-colors ${NOTE_TO_SERMON_COLORS.builtRow}`}
              >
                <span
                  data-testid="built-sermon-title"
                  className={`line-clamp-2 text-sm font-medium leading-[18px] ${NOTE_TO_SERMON_COLORS.builtRowTitle}`}
                >
                  {sermon.title}
                </span>
                <span
                  data-testid="built-sermon-meta"
                  className={`truncate text-[11px] leading-4 ${NOTE_TO_SERMON_COLORS.builtRowMeta}`}
                >
                  {sermonMetaLine(sermon)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-0.5 text-xs leading-4 text-gray-400 dark:text-gray-500" data-testid="built-sermons-empty">
          {t('studiesWorkspace.builtSermons.empty')}
        </p>
      )}

      <button
        ref={openerRef}
        type="button"
        onClick={() => setCreating(true)}
        disabled={noteBusy}
        title={noteBusy ? t('studiesWorkspace.builtSermons.createDisabledUnsaved') : undefined}
        data-testid="create-sermon-from-note"
        className={`flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${NOTE_TO_SERMON_COLORS.openerButton}`}
      >
        <PlusIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{t('studiesWorkspace.builtSermons.create')}</span>
      </button>

      {creating && (
        <CreateSermonFromNoteModal
          noteId={noteId}
          noteTitle={noteTitle}
          scriptureRefs={scriptureRefs}
          noteContent={noteContent}
          onClose={() => setCreating(false)}
          returnFocusTo={openerRef}
        />
      )}
    </div>
  );
};

export default SermonsBuiltOnNote;
