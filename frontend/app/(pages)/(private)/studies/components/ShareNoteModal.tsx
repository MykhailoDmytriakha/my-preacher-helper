'use client';

import {
  ArrowTopRightOnSquareIcon,
  CheckIcon,
  DocumentDuplicateIcon,
  LinkIcon,
  LockClosedIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useClipboard } from '@/hooks/useClipboard';
import { useModalLayer } from '@/hooks/useModalLayer';
import { StudyNote, StudyNoteShareLink } from '@/models/models';
import { awaitAcceptance, type WriteSubmission } from '@/utils/recoverableWrite';
import { getShareNotePath, getShareNoteUrl } from '@/utils/shareNoteUtils';

interface ShareNoteModalProps {
  isOpen: boolean;
  note: StudyNote | null;
  shareLink?: StudyNoteShareLink;
  loading?: boolean;
  onClose: () => void;
  onCreate: (noteId: string) => WriteSubmission;
  onDelete: (linkId: string) => WriteSubmission;
}

const OVERLAY_CLASS = 'fixed inset-0 z-50 flex items-center justify-center overscroll-contain px-4 py-8';
const PANEL_CLASS =
  'relative flex w-full max-w-xl flex-col gap-5 rounded-2xl bg-white p-5 shadow-xl sm:p-6 dark:border dark:border-gray-800 dark:bg-gray-900';
const PRIMARY_BUTTON_CLASS =
  'inline-flex h-11 items-center justify-center gap-2 rounded-[10px] bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:cursor-not-allowed disabled:opacity-70 dark:focus:ring-emerald-800';

/**
 * The window has one job: hand the preacher a link to send. So the link and Copy are the
 * only loud things in it. Deleting the link is real and irreversible — everyone holding the
 * link loses the note, and a new link gets a new address — so it lives as a quiet red line
 * at the bottom and asks once, in place, before it acts. There is no second window on top
 * of this one, and Escape closes the question before it closes the window.
 */
export default function ShareNoteModal({
  isOpen,
  note,
  shareLink,
  loading = false,
  onClose,
  onCreate,
  onDelete,
}: ShareNoteModalProps) {
  const { t, i18n } = useTranslation();
  const { isCopied, copyToClipboard, reset: resetCopy } = useClipboard({ successDuration: 1500 });
  const [isWorking, setIsWorking] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const keepLinkButtonRef = useRef<HTMLButtonElement>(null);
  const layer = useModalLayer({ onClose, active: isOpen, closeDisabled: isWorking });

  const shareUrl = useMemo(() => (shareLink ? getShareNoteUrl(shareLink.token) : ''), [shareLink]);
  const sharePath = useMemo(() => (shareLink ? getShareNotePath(shareLink.token) : ''), [shareLink]);
  const shareHost = useMemo(
    () => (shareUrl && sharePath ? shareUrl.slice(0, shareUrl.length - sharePath.length).replace(/^https?:\/\//, '') : ''),
    [shareUrl, sharePath],
  );

  useEffect(() => resetCopy(), [isOpen, shareUrl, resetCopy]);
  // The question is asked about THIS link in THIS opening: a new link or a closed window withdraws it.
  useEffect(() => setConfirmingDelete(false), [isOpen, shareLink?.id]);
  useEffect(() => {
    if (confirmingDelete) keepLinkButtonRef.current?.focus();
  }, [confirmingDelete]);

  const handleCreate = useCallback(async () => {
    if (!note || isWorking) return;
    try {
      setIsWorking(true);
      // useStudyNoteShareLinks' create recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(onCreate(note.id), () => undefined);
    } catch (error) {
      /**
       * NO message here. `useStudyNoteShareLinks` declares the recovery descriptor for
       * this write and reports the same refusal. Two reporters presented one refused
       * action as two failures — see docs/recoverable-writes.md.
       */
      console.error('Share link create refused:', error);
    } finally {
      setIsWorking(false);
    }
  }, [note, isWorking, onCreate]);

  const handleDelete = useCallback(async () => {
    if (!shareLink || isWorking) return;
    try {
      setIsWorking(true);
      // useStudyNoteShareLinks' delete recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(onDelete(shareLink.id), () => undefined);
    } catch (error) {
      /**
       * NO message here — the entity's recovery descriptor reports this refusal and
       * carries the text. One refusal, one reporter (docs/recoverable-writes.md).
       */
      console.error('Share link write refused:', error);
    } finally {
      setIsWorking(false);
      setConfirmingDelete(false);
    }
  }, [shareLink, isWorking, onDelete]);

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return;
    await copyToClipboard(shareUrl);
  }, [shareUrl, copyToClipboard]);

  const handlePanelKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape' && confirmingDelete && !isWorking) {
        // The layer would close the whole window; the question goes first.
        event.stopPropagation();
        setConfirmingDelete(false);
      }
    },
    [confirmingDelete, isWorking],
  );

  if (!isOpen || !note) return null;

  const createdOn = shareLink
    ? new Date(shareLink.createdAt).toLocaleDateString(i18n?.language || undefined, { day: 'numeric', month: 'long' })
    : '';

  const modalContent = (
    <div {...layer} className={OVERLAY_CLASS} role="dialog" aria-modal="true" aria-labelledby="share-note-title">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/40"
        aria-label={t('common.close')}
      />
      <div className={PANEL_CLASS} onClick={(event) => event.stopPropagation()} onKeyDown={handlePanelKeyDown}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
              {t('studiesWorkspace.shareLinks.modalTitle')}
            </p>
            <h2 id="share-note-title" className="text-xl font-semibold leading-7 text-gray-900 dark:text-gray-100">
              {note.title || t('studiesWorkspace.untitled')}
            </h2>
            {shareLink ? (
              <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                {t('studiesWorkspace.shareLinks.accessOn')}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300">
                <LockClosedIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
                {t('studiesWorkspace.shareLinks.accessOff')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 -mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            aria-label={t('common.close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {shareLink ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
              <div className="flex h-11 min-w-0 flex-1 items-center gap-1 rounded-[10px] border border-gray-200 bg-gray-50 py-0 pl-3.5 pr-1 dark:border-gray-700 dark:bg-gray-800">
                <span className="min-w-0 flex-1 truncate text-sm text-gray-900 dark:text-gray-100" title={shareUrl}>
                  <span className="text-gray-500 dark:text-gray-400">{shareHost}</span>
                  {sharePath}
                </span>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  aria-label={t('studiesWorkspace.shareLinks.openLink')}
                  title={t('studiesWorkspace.shareLinks.openLink')}
                >
                  <ArrowTopRightOnSquareIcon className="h-[18px] w-[18px]" />
                </a>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                className={`${PRIMARY_BUTTON_CLASS} sm:min-w-[156px] ${isCopied ? 'bg-emerald-800' : ''}`}
              >
                {isCopied ? <CheckIcon className="h-[18px] w-[18px]" /> : <DocumentDuplicateIcon className="h-[18px] w-[18px]" />}
                {isCopied ? t('common.copied') : t('studiesWorkspace.shareLinks.copyLink')}
              </button>
            </div>

            {confirmingDelete ? (
              <div
                role="alertdialog"
                aria-labelledby="share-note-delete-title"
                aria-describedby="share-note-delete-text"
                className="flex flex-col gap-3.5 rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900/60 dark:bg-red-950/40"
              >
                <div className="flex flex-col gap-1">
                  <p id="share-note-delete-title" className="text-sm font-semibold text-red-900 dark:text-red-200">
                    {t('studiesWorkspace.shareLinks.deleteConfirmTitle')}
                  </p>
                  <p id="share-note-delete-text" className="text-[13px] leading-5 text-red-800 dark:text-red-300">
                    {t('studiesWorkspace.shareLinks.deleteConfirmText')}
                  </p>
                </div>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <button
                    ref={keepLinkButtonRef}
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    disabled={isWorking}
                    className="inline-flex h-10 items-center justify-center rounded-[10px] border border-gray-200 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
                  >
                    {t('studiesWorkspace.shareLinks.keepLink')}
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isWorking}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-red-600 px-4 text-sm font-semibold text-white transition hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-300 disabled:cursor-not-allowed disabled:opacity-70 dark:focus:ring-red-900"
                  >
                    {isWorking ? t('studiesWorkspace.shareLinks.deleting') : t('studiesWorkspace.shareLinks.deleteLink')}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col-reverse gap-2 border-t border-gray-100 pt-3.5 sm:flex-row sm:items-center sm:justify-between dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(true)}
                  className="-ml-2.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-red-600 transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-200 dark:text-red-400 dark:hover:bg-red-950/40 dark:focus:ring-red-900"
                >
                  <TrashIcon className="h-4 w-4" />
                  {t('studiesWorkspace.shareLinks.deleteLink')}
                </button>
                <p className="text-[13px] text-gray-500 dark:text-gray-400">
                  {t('studiesWorkspace.shareLinks.createdOn', { date: createdOn })}
                  {' · '}
                  {t('studiesWorkspace.shareLinks.views', { count: shareLink.viewCount ?? 0 })}
                </p>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-3.5">
            <p className="text-[15px] leading-6 text-gray-700 dark:text-gray-300">
              {loading ? t('studiesWorkspace.shareLinks.loadingLink') : t('studiesWorkspace.shareLinks.inviteText')}
            </p>
            <button type="button" onClick={handleCreate} disabled={isWorking || loading} className={PRIMARY_BUTTON_CLASS}>
              <LinkIcon className="h-[18px] w-[18px]" />
              {isWorking ? t('studiesWorkspace.shareLinks.creating') : t('studiesWorkspace.shareLinks.createButton')}
            </button>
            <p className="text-[13px] text-gray-500 dark:text-gray-400">{t('studiesWorkspace.shareLinks.inviteHint')}</p>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
