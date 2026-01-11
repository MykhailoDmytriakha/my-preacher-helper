'use client';

import {
  CheckIcon,
  DocumentDuplicateIcon,
  LinkIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { StudyNote, StudyNoteShareLink } from '@/models/models';
import { getShareNoteUrl } from '@/utils/shareNoteUtils';

interface ShareNoteModalProps {
  isOpen: boolean;
  note: StudyNote | null;
  shareLink?: StudyNoteShareLink;
  loading?: boolean;
  onClose: () => void;
  onCreate: (noteId: string) => Promise<StudyNoteShareLink>;
  onDelete: (linkId: string) => Promise<void>;
}

const PANEL_CLASS = 'relative w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900';
const OVERLAY_CLASS = 'fixed inset-0 z-50 flex items-center justify-center px-4 py-8';

export default function ShareNoteModal({
  isOpen,
  note,
  shareLink,
  loading = false,
  onClose,
  onCreate,
  onDelete,
}: ShareNoteModalProps) {
  const { t } = useTranslation();
  const { isCopied, copyToClipboard } = useClipboard({ successDuration: 1500 });
  const [isWorking, setIsWorking] = useState(false);

  const shareUrl = useMemo(() => (shareLink ? getShareNoteUrl(shareLink.token) : ''), [shareLink]);

  const handleCreate = useCallback(async () => {
    if (!note || isWorking) return;
    try {
      setIsWorking(true);
      await onCreate(note.id);
    } finally {
      setIsWorking(false);
    }
  }, [note, isWorking, onCreate]);

  const handleDelete = useCallback(async () => {
    if (!shareLink || isWorking) return;
    try {
      setIsWorking(true);
      await onDelete(shareLink.id);
    } finally {
      setIsWorking(false);
    }
  }, [shareLink, isWorking, onDelete]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl);
  }, [shareUrl, copyToClipboard]);

  if (!isOpen || !note) return null;

  const statusTitle = shareLink
    ? t('studiesWorkspace.shareLinks.statusOnTitle')
    : t('studiesWorkspace.shareLinks.statusOffTitle');
  const statusDescription = shareLink
    ? t('studiesWorkspace.shareLinks.statusOnDescription')
    : t('studiesWorkspace.shareLinks.statusOffDescription');

  const modalContent = (
    <div className={OVERLAY_CLASS} role="dialog" aria-modal="true">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/40"
        aria-label={t('common.close')}
      />
      <div className={PANEL_CLASS} onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">
              {t('studiesWorkspace.shareLinks.modalTitle')}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-900 dark:text-gray-100">
              {note.title || t('studiesWorkspace.untitled')}
            </h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.shareLinks.modalSubtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
            aria-label={t('common.close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-200">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 shadow-sm dark:bg-gray-900 dark:text-gray-200">
              <LinkIcon className="h-3.5 w-3.5" />
              {statusTitle}
            </span>
            {loading && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {t('studiesWorkspace.shareLinks.loadingLink')}
              </span>
            )}
          </div>
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{statusDescription}</p>
        </div>

        <div className="mt-5 space-y-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t('studiesWorkspace.shareLinks.linkLabel')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={shareUrl}
              readOnly
              placeholder={t('studiesWorkspace.shareLinks.linkPlaceholder')}
              className="w-full flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!shareLink}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {isCopied ? <CheckIcon className="h-4 w-4 text-emerald-600" /> : <DocumentDuplicateIcon className="h-4 w-4" />}
              {isCopied ? t('common.copied') : t('studiesWorkspace.shareLinks.copyLink')}
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {t('studiesWorkspace.shareLinks.viewsLabel')}: {shareLink?.viewCount ?? 0}
            </div>
            <div className="flex items-center gap-2">
              {shareLink ? (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isWorking}
                  className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/30"
                >
                  <TrashIcon className="h-4 w-4" />
                  {t('studiesWorkspace.shareLinks.revokeLink')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={isWorking}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  <LinkIcon className="h-4 w-4" />
                  {t('studiesWorkspace.shareLinks.createButton')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
