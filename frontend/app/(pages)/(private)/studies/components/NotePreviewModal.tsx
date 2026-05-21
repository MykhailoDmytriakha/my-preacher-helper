'use client';

import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import NodeTreeEditor from '@/components/studies/node/NodeTreeEditor';
import { useStudyNotes } from '@/hooks/useStudyNotes';
import { useWikilinkResolver } from '@/hooks/useWikilinkResolver';
import { hasNodeTree } from '@/utils/nodeTreeAdapter';
import MarkdownDisplay from '@components/MarkdownDisplay';

import StudyReaderShell from './StudyReaderShell';

interface NotePreviewModalProps {
  noteId: string;
  onClose: () => void;
}

/**
 * Read-only preview of a study note shown when a wikilink chip is clicked.
 * Mounted by NotePreviewProvider.
 *
 * Aesthetic direction: editorial reading sanctuary. The page steps back
 * (warm dim + blur), a vellum-like card holds the focus, a serif display
 * title sits over a single emerald hairline, and the body scrolls beneath
 * a sticky header so the user always knows what they're reading. The
 * floating pill-bar at the top-right keeps the navigation/close affordances
 * unobtrusive but always reachable.
 *
 * Sizing uses `dvh` (dynamic viewport height) so mobile browser chrome
 * doesn't crop the action bar, and a `min()`/`clamp()` width that stays
 * generous for prose on desktop but never spans an ultra-wide monitor.
 */
export function NotePreviewModal({ noteId, onClose }: NotePreviewModalProps) {
  const { t } = useTranslation();
  const { notes } = useStudyNotes();
  const wikilinkResolver = useWikilinkResolver();

  const note = useMemo(() => notes.find((n) => n.id === noteId), [notes, noteId]);

  return (
    <StudyReaderShell
      isOpen
      onClose={onClose}
      ariaLabel={note?.title ?? t('studiesWorkspace.notePreview.ariaLabel', { defaultValue: 'Note preview' })}
      variant="preview"
      topRightSlot={(
        <div className="inline-flex items-center gap-0.5 rounded-full border border-stone-200/80 bg-white/85 p-1 shadow-[0_8px_20px_-8px_rgba(15,23,23,0.25)] backdrop-blur-xl dark:border-stone-700/80 dark:bg-stone-900/85">
          <Link
            href={`/studies/${noteId}`}
            onClick={onClose}
            title={t('studiesWorkspace.notePreview.openFullPage', { defaultValue: 'Open on its own page' })}
            aria-label={t('studiesWorkspace.notePreview.openFullPage', { defaultValue: 'Open on its own page' })}
            className="group inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-all duration-150 hover:scale-105 hover:bg-emerald-50 hover:text-emerald-700 dark:text-stone-300 dark:hover:bg-emerald-900/30 dark:hover:text-emerald-200"
          >
            <ArrowTopRightOnSquareIcon className="h-[18px] w-[18px] transition-transform group-hover:-translate-y-px group-hover:translate-x-px" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={onClose}
            title={t('studiesWorkspace.notePreview.close', { defaultValue: 'Close (Esc)' })}
            aria-label={t('studiesWorkspace.notePreview.closeShort', { defaultValue: 'Close' })}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-stone-500 transition-all duration-150 hover:scale-105 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <XMarkIcon className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>
      )}
      headerSlot={(
        <header className="relative flex-none px-6 pb-5 pt-8 sm:px-12 sm:pb-6 sm:pt-10">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-700/80 dark:text-emerald-400/80">
            {t('studiesWorkspace.notePreview.eyebrow', { defaultValue: 'Note · preview' })}
          </p>
          <h2
            className="pr-20 font-serif text-2xl font-semibold leading-tight tracking-tight text-stone-900 sm:text-[28px] dark:text-stone-50"
            style={{ fontFamily: 'Georgia, Cambria, "Times New Roman", serif' }}
          >
            {note?.title?.trim() || (note
              ? t('studiesWorkspace.notePreview.untitled', { defaultValue: 'Untitled' })
              : t('studiesWorkspace.notePreview.loading', { defaultValue: 'Loading…' }))}
          </h2>
          <div className="mt-4 flex items-center gap-2">
            <span className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-300/30 to-emerald-400/60 dark:via-emerald-400/20 dark:to-emerald-500/50" />
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 dark:bg-emerald-400/70" aria-hidden="true" />
          </div>
        </header>
      )}
    >
      {!note ? (
        <div className="flex h-full items-center justify-center">
          <p className="max-w-[36ch] text-center text-sm leading-relaxed text-stone-500 dark:text-stone-400">
            {t('studiesWorkspace.notePreview.missingFromCache', { defaultValue: "This note isn't loaded yet. Open it on its own page to read it." })}
          </p>
        </div>
      ) : hasNodeTree(note) && note.rootNode ? (
        <NodeTreeEditor
          rootNode={note.rootNode}
          onChange={() => undefined}
          readOnly
          currentNoteId={note.id}
        />
      ) : (
        <MarkdownDisplay
          content={note.content ?? ''}
          enableWikiLinks
          wikilinkResolver={wikilinkResolver}
        />
      )}
    </StudyReaderShell>
  );
}

export default NotePreviewModal;
