'use client';

import { DocumentDuplicateIcon, LinkIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote, StudyNoteShareLink } from '@/models/models';
import { getShareNotePath, getShareNoteUrl } from '@/utils/shareNoteUtils';

interface ShareLinksPanelProps {
  notes: StudyNote[];
  shareLinks: StudyNoteShareLink[];
  loading?: boolean;
  onCreate: (noteId: string) => Promise<StudyNoteShareLink>;
  onDelete: (linkId: string) => Promise<void>;
}

const PANEL_CLASS = 'rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800';
const HEADER_CLASS = 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between';
const ACTIONS_CLASS = 'flex flex-col gap-2 sm:flex-row sm:items-center';
const SELECT_CLASS = 'w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white';
const ACTION_BUTTON_CLASS = 'inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50';
const TABLE_HEADER_CLASS = 'grid grid-cols-1 gap-3 border-b border-gray-200 pb-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:text-gray-400 md:grid-cols-[2fr_1.2fr_1fr_1fr_auto]';
const ROW_CLASS = 'grid grid-cols-1 gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-200 md:grid-cols-[2fr_1.2fr_1fr_1fr_auto]';
const META_TEXT_CLASS = 'text-xs text-gray-500 dark:text-gray-400';

export default function ShareLinksPanel({
  notes,
  shareLinks,
  loading = false,
  onCreate,
  onDelete,
}: ShareLinksPanelProps) {
  const { t } = useTranslation();
  const { copyToClipboard } = useClipboard({ successDuration: 1500 });

  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);

  const noteMap = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const shareLinksByNoteId = useMemo(() => new Map(shareLinks.map((link) => [link.noteId, link])), [shareLinks]);
  const availableNotes = useMemo(
    () => notes.filter((note) => !shareLinksByNoteId.has(note.id)),
    [notes, shareLinksByNoteId]
  );
  const sortedLinks = useMemo(
    () => [...shareLinks].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [shareLinks]
  );

  useEffect(() => () => {
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    if (!selectedNoteId || isCreating) return;
    try {
      setIsCreating(true);
      await onCreate(selectedNoteId);
      setSelectedNoteId('');
    } finally {
      setIsCreating(false);
    }
  }, [selectedNoteId, isCreating, onCreate]);

  const handleDelete = useCallback(async (linkId: string) => {
    if (deletingId) return;
    try {
      setDeletingId(linkId);
      await onDelete(linkId);
    } finally {
      setDeletingId(null);
    }
  }, [deletingId, onDelete]);

  const handleCopy = useCallback(async (token: string) => {
    const url = getShareNoteUrl(token);
    const success = await copyToClipboard(url);
    if (!success) return;
    setCopiedToken(token);
    if (copyTimeoutRef.current) {
      window.clearTimeout(copyTimeoutRef.current);
    }
    copyTimeoutRef.current = window.setTimeout(() => setCopiedToken(null), 1500);
  }, [copyToClipboard]);

  return (
    <section className={PANEL_CLASS}>
      <div className={HEADER_CLASS}>
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            <LinkIcon className="h-4 w-4 text-emerald-600" />
            {t('studiesWorkspace.shareLinks.title')}
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('studiesWorkspace.shareLinks.subtitle')}
          </p>
        </div>

        <div className={ACTIONS_CLASS}>
          <select
            value={selectedNoteId}
            onChange={(event) => setSelectedNoteId(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t('studiesWorkspace.shareLinks.selectPlaceholder')}</option>
            {availableNotes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.title || t('studiesWorkspace.untitled')}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!selectedNoteId || isCreating}
            className={ACTION_BUTTON_CLASS}
          >
            <PlusIcon className="h-4 w-4" />
            {t('studiesWorkspace.shareLinks.createButton')}
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {loading && shareLinks.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {t('common.loading')}
          </div>
        ) : null}

        {!loading && shareLinks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
            {t('studiesWorkspace.shareLinks.empty')}
          </div>
        ) : null}

        {shareLinks.length > 0 ? (
          <div className="space-y-2">
            <div className={TABLE_HEADER_CLASS}>
              <span>{t('studiesWorkspace.shareLinks.noteLabel')}</span>
              <span>{t('studiesWorkspace.shareLinks.accessLabel')}</span>
              <span>{t('studiesWorkspace.shareLinks.createdLabel')}</span>
              <span>{t('studiesWorkspace.shareLinks.viewsLabel')}</span>
              <span className="text-right">{t('common.actions')}</span>
            </div>
            {sortedLinks.map((link) => {
              const note = noteMap.get(link.noteId);
              const sharePath = getShareNotePath(link.token);
              return (
                <div key={link.id} className={ROW_CLASS}>
                  <div className="space-y-1">
                    <p className="font-medium text-gray-900 dark:text-gray-100">
                      {note?.title || t('studiesWorkspace.untitled')}
                    </p>
                    <p className={META_TEXT_CLASS}>{sharePath}</p>
                  </div>
                  <div className={META_TEXT_CLASS}>
                    {t('studiesWorkspace.shareLinks.accessValue')}
                  </div>
                  <div className={META_TEXT_CLASS}>
                    {new Date(link.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {link.viewCount}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(link.token)}
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <DocumentDuplicateIcon className="h-4 w-4" />
                      {copiedToken === link.token
                        ? t('common.copied')
                        : t('studiesWorkspace.shareLinks.copyLink')}
                    </button>
                    <a
                      href={sharePath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-700"
                    >
                      <LinkIcon className="h-4 w-4" />
                      {t('studiesWorkspace.shareLinks.openLink')}
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(link.id)}
                      disabled={deletingId === link.id}
                      className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/30"
                    >
                      <TrashIcon className="h-4 w-4" />
                      {t('studiesWorkspace.shareLinks.deleteLink')}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
