'use client';

import { PlusIcon } from '@heroicons/react/24/outline';
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BuiltSermonsList } from '@/components/sermon/BuiltSermonsList';
import { useSermonsBuiltOnNote } from '@/hooks/useSermonNoteLinks';
import { NOTE_TO_SERMON_COLORS } from '@/utils/themeColors';

import CreateSermonFromNoteModal from './CreateSermonFromNoteModal';

import type { ScriptureReference } from '@/models/models';

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
    <BuiltSermonsList
      testId="sermons-built-on-note"
      title={t('studiesWorkspace.builtSermons.title')}
      sermons={sermons}
      empty={t('studiesWorkspace.builtSermons.empty')}
      openLabel={(title) => t('studiesWorkspace.builtSermons.openSermon', { title })}
    >
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
    </BuiltSermonsList>
  );
};

export default SermonsBuiltOnNote;
