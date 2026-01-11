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

const PANEL_CLASS = 'rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800';
const HEADER_CLASS = 'flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-gray-100 dark:border-gray-700 pb-5 mb-5';
const ACTIONS_CLASS = 'flex flex-col gap-2 sm:flex-row sm:items-stretch sm:h-10';
const SELECT_CLASS = 'w-full sm:w-[240px] h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white outline-none';
const ACTION_BUTTON_CLASS = 'inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap';
const TABLE_HEADER_CLASS = 'hidden md:grid gap-4 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 md:grid-cols-[1fr_200px_100px_80px_360px] items-center';
const ROW_CLASS = 'grid grid-cols-1 gap-3 md:gap-4 px-3 py-3 text-sm text-gray-700 transition-colors border-b border-gray-50 dark:border-gray-700/50 dark:text-gray-200 md:grid-cols-[1fr_200px_100px_80px_360px] items-center hover:bg-gray-50/50 dark:hover:bg-gray-700/20';

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
        <div className="flex items-start gap-3">
          <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-900/30">
            <LinkIcon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
              {t('studiesWorkspace.shareLinks.title')}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.shareLinks.subtitle')}
            </p>
          </div>
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
              <span className="text-center">{t('studiesWorkspace.shareLinks.accessLabel')}</span>
              <span className="text-center">{t('studiesWorkspace.shareLinks.createdLabel')}</span>
              <span className="text-center">{t('studiesWorkspace.shareLinks.viewsLabel')}</span>
              <span className="text-right">{t('common.actions')}</span>
            </div>
            {sortedLinks.map((link) => {
              const note = noteMap.get(link.noteId);
              const sharePath = getShareNotePath(link.token);
              return (
                <div key={link.id} className={ROW_CLASS}>
                  <div className="flex flex-col min-w-0">
                    <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {note?.title || t('studiesWorkspace.untitled')}
                    </p>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">
                      {sharePath}
                    </p>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 md:text-center">
                    <span className="md:hidden font-semibold mr-2">{t('studiesWorkspace.shareLinks.accessLabel')}:</span>
                    {t('studiesWorkspace.shareLinks.accessValue')}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 md:text-center">
                    <span className="md:hidden font-semibold mr-2">{t('studiesWorkspace.shareLinks.createdLabel')}:</span>
                    {new Date(link.createdAt).toLocaleDateString()}
                  </div>
                  <div className="text-sm font-bold text-gray-900 dark:text-gray-100 md:text-center">
                    <span className="md:hidden font-semibold mr-2">{t('studiesWorkspace.shareLinks.viewsLabel')}:</span>
                    {link.viewCount}
                  </div>
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(link.token)}
                      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                      title={t('studiesWorkspace.shareLinks.copyLink')}
                    >
                      <DocumentDuplicateIcon className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">
                        {copiedToken === link.token
                          ? t('common.copied')
                          : t('studiesWorkspace.shareLinks.copyLink')}
                      </span>
                    </button>
                    <a
                      href={sharePath}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white"
                      title={t('studiesWorkspace.shareLinks.openLink')}
                    >
                      <LinkIcon className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">{t('studiesWorkspace.shareLinks.openLink')}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(link.id)}
                      disabled={deletingId === link.id}
                      className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border border-red-100 bg-red-50/30 px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-red-900/30 dark:bg-red-900/10 dark:text-red-400 dark:hover:bg-red-900/20"
                      title={t('studiesWorkspace.shareLinks.deleteLink')}
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                      <span className="hidden lg:inline">{t('studiesWorkspace.shareLinks.deleteLink')}</span>
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
