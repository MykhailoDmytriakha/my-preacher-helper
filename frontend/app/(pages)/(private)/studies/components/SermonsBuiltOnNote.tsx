'use client';

import { BookOpenIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { formatDateOnly } from '@/utils/dateFormatter';
import { getNavItemTheme, SOURCE_NOTE_COLORS } from '@/utils/themeColors';

/**
 * THE OTHER DIRECTION, ON THE NOTE'S OWN PAGE: what was preached out of this.
 *
 * Nothing here is stored on the note — the list is derived from the sermons that name it, so
 * it cannot fall out of step with what the sermon screen shows. It joins the note's metadata
 * tray beside scripture references and tags, because those three answer the same question:
 * what is attached to this note.
 *
 * Rows carry the SERMONS accent (blue) rather than the studies green: the colour says where
 * the click goes, which is the only orientation a reader needs here. When no sermon points at
 * the note the block does not render at all — an empty "Sermons: none" would be a permanent
 * blank on every note that is still being studied.
 */
interface SermonsBuiltOnNoteProps {
  noteId: string | undefined;
}

const SermonsBuiltOnNote: React.FC<SermonsBuiltOnNoteProps> = ({ noteId }) => {
  const { t } = useTranslation();
  const { sermons } = useSermonsBuiltOnNote(noteId);

  if (sermons.length === 0) return null;

  const theme = getNavItemTheme('default');

  return (
    <div className="space-y-3 md:col-span-2" data-testid="sermons-built-on-note">
      <div className={`flex items-center gap-2 ${SOURCE_NOTE_COLORS.reverseHeading}`}>
        <BookOpenIcon className="h-5 w-5" aria-hidden="true" />
        <span className="text-sm font-medium">{t('studiesWorkspace.builtSermons.title')}</span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {sermons.map((sermon) => (
          <li key={sermon.id}>
            <Link
              href={`/sermons/${sermon.id}`}
              data-testid="built-sermon-link"
              aria-label={t('studiesWorkspace.builtSermons.openSermon', { title: sermon.title })}
              className={`inline-flex max-w-[20rem] items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${theme.pill}`}
            >
              <span className="truncate">{sermon.title}</span>
              <span className="shrink-0 text-xs font-normal opacity-70">{formatDateOnly(sermon.date)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SermonsBuiltOnNote;
