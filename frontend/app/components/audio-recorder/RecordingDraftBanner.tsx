import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useConfirm } from "@/hooks/useConfirm";
import { useRecordingDrafts } from "@/hooks/useRecordingDrafts";
import { buildRecordingFilename, downloadBlobToDevice } from "@/utils/audioFormatUtils";

import type { RecordingDraft, RecordingDraftContext } from "@/utils/recordingDraftStore";

export interface RecordingDraftBannerProps {
  context: RecordingDraftContext;
  contextId?: string;
  /** Resend the saved blob for transcription. Resolve `true` to have the draft removed. */
  onResend: (blob: Blob, draft: RecordingDraft) => Promise<boolean>;
  /** Owner from the actual loaded source document, used only for pre-upgrade recordings. */
  sourceOwnerId?: string;
  linkedSourceIds?: readonly string[];
  resendDisabled?: boolean;
  excludeDraftIds?: readonly string[];
  isProcessing?: boolean;
  className?: string;
}

const EMPTY_DRAFT_IDS: readonly string[] = [];

const canUseObjectUrl = () =>
  typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

/**
 * Surfaces persisted "unfinished recordings" (audio whose transcription failed)
 * so the user can recover a dictated thought after a reload / tab close. The
 * durable blobs live in IndexedDB via {@link useRecordingDrafts}; this is the
 * visible half. Renders nothing while loading or when there are no drafts.
 */
export default function RecordingDraftBanner({
  context,
  contextId,
  sourceOwnerId,
  linkedSourceIds = EMPTY_DRAFT_IDS,
  onResend,
  isProcessing = false,
  resendDisabled = false,
  excludeDraftIds = EMPTY_DRAFT_IDS,
  className = "",
}: RecordingDraftBannerProps) {
  const { t } = useTranslation();
  const { drafts: loadedDrafts, loading, error, ownerId, removeDraft, refresh } = useRecordingDrafts(context, contextId, sourceOwnerId, linkedSourceIds);
  const excludedKey = JSON.stringify(excludeDraftIds);
  const drafts = useMemo(() => {
    const excluded = new Set<string>(JSON.parse(excludedKey));
    return excluded.size ? loadedDrafts.filter(draft => !excluded.has(draft.id)) : loadedDrafts;
  }, [loadedDrafts, excludedKey]);
  const { confirm, confirmDialog, withdraw } = useConfirm();
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const currentScope = JSON.stringify([ownerId, context, contextId]);
  const currentScopeRef = useRef(currentScope);
  const currentDraftsRef = useRef(drafts);
  const pendingDiscard = useRef<{ id: string; blob: Blob; scope: string } | null>(null);
  const deletingIds = useRef(new Set<string>());
  const resendingIds = useRef(new Set<string>());
  const [actionError, setActionError] = useState<{ scope: string; key: string } | null>(null);
  currentScopeRef.current = currentScope;
  currentDraftsRef.current = drafts;

  const isCurrentDraft = useCallback((id: string, blob: Blob, scope: string) =>
    currentScopeRef.current === scope && currentDraftsRef.current.some(candidate => candidate.id === id && candidate.blob === blob), []);

  useEffect(() => {
    const pending = pendingDiscard.current;
    if (pending && !isCurrentDraft(pending.id, pending.blob, pending.scope)) {
      pendingDiscard.current = null;
      deletingIds.current.delete(pending.id);
      setBusyIds(previous => { const next = { ...previous }; delete next[pending.id]; return next; });
      withdraw();
    }
  }, [context, contextId, drafts, isCurrentDraft, withdraw]);

  useEffect(() => () => { withdraw(); }, [withdraw]);

  // One object URL per draft, rebuilt whenever the draft set changes. The
  // cleanup revokes the URLs from the *previous* render (and on unmount) so no
  // blob URLs leak. SSR-safe: skips when URL.createObjectURL is unavailable.
  const objectUrls = useMemo(() => {
    if (!canUseObjectUrl()) return {} as Record<string, string>;
    return drafts.reduce<Record<string, string>>((map, draft) => {
      map[draft.id] = URL.createObjectURL(draft.blob);
      return map;
    }, {});
  }, [drafts]);

  useEffect(() => {
    return () => {
      if (!canUseObjectUrl()) return;
      Object.values(objectUrls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [objectUrls]);

  const handleResend = useCallback(
    async (draft: RecordingDraft) => {
      if (isProcessing || resendDisabled || busyIds[draft.id] || resendingIds.current.has(draft.id)) return;
      const scope = currentScope;
      resendingIds.current.add(draft.id);
      setActionError(null);
      setBusyIds((prev) => ({ ...prev, [draft.id]: true }));
      try {
        const ok = await onResend(draft.blob, draft);
        if (ok) await removeDraft(draft.id);
      } catch {
        if (currentScopeRef.current === scope) setActionError({ scope, key: 'audio.draft.resendFailed' });
      } finally {
        resendingIds.current.delete(draft.id);
        setBusyIds((prev) => {
          const next = { ...prev };
          delete next[draft.id];
          return next;
        });
      }
    },
    [busyIds, currentScope, isProcessing, onResend, removeDraft, resendDisabled]
  );

  const handleDiscard = useCallback(async (draft: RecordingDraft) => {
    if (isProcessing || busyIds[draft.id] || deletingIds.current.has(draft.id)) return;
    const scope = currentScope;
    const request = { id: draft.id, blob: draft.blob, scope };
    setActionError(null);
    pendingDiscard.current = request;
    deletingIds.current.add(draft.id);
    setBusyIds(previous => ({ ...previous, [draft.id]: true }));
    try {
      const accepted = await confirm({
        title: { key: 'common.deleteItem.title' },
        description: { key: 'common.deleteItem.description' },
        confirmText: { key: 'common.delete' },
        cancelText: { key: 'common.cancel' },
      });
      if (accepted && isCurrentDraft(request.id, request.blob, request.scope)) await removeDraft(request.id);
    } catch {
      if (currentScopeRef.current === scope) setActionError({ scope, key: 'audio.draft.discardFailed' });
    } finally {
      if (pendingDiscard.current === request) pendingDiscard.current = null;
      deletingIds.current.delete(draft.id);
      setBusyIds(previous => { const next = { ...previous }; delete next[draft.id]; return next; });
    }
  }, [busyIds, confirm, currentScope, isCurrentDraft, isProcessing, removeDraft]);

  const notice = actionError?.scope === currentScope ? actionError.key : error ? 'audio.draft.loadFailed' : null;
  const failure = notice ? <div role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
    <p>{t(notice)}</p>{error ? <button type="button" onClick={() => { void refresh(); }}>{t('buttons.retry')}</button> : null}
  </div> : null;
  if (loading || drafts.length === 0) return <>{failure}{confirmDialog}</>;

  const buttonBase =
    "rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <>
    {failure}
    <div className={`flex flex-col gap-3 ${className}`}>
      {drafts.map((draft) => {
        const busy = isProcessing || Boolean(busyIds[draft.id]);
        return (
          <div
            key={draft.id}
            className="rounded-lg border border-amber-200 bg-amber-50 p-4 shadow-sm dark:border-amber-700 dark:bg-amber-900/30"
          >
            <div className="flex min-w-0 items-start gap-2 text-amber-800 dark:text-amber-200">
              <svg
                className="mt-0.5 h-4 w-4 flex-shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.72-1.36 3.485 0l6.518 11.59c.75 1.334-.213 2.986-1.742 2.986H3.48c-1.53 0-2.492-1.652-1.742-2.986l6.518-11.59zM11 14a1 1 0 10-2 0 1 1 0 002 0zm-1-2a1 1 0 01-1-1V7a1 1 0 112 0v4a1 1 0 01-1 1z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-sm font-semibold">{t("audio.draft.title")}</div>
                <p className="mb-2 text-sm text-amber-700 dark:text-amber-200">
                  {t("audio.draft.hint")}
                </p>
                {objectUrls[draft.id] && (
                  <audio
                    controls
                    src={objectUrls[draft.id]}
                    preload="metadata"
                    className="h-9 w-full min-w-0"
                    aria-label={t("audio.draft.listen")}
                  />
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleResend(draft)}
                disabled={busy || resendDisabled}
                className={`${buttonBase} border border-amber-300 bg-white text-amber-800 hover:bg-amber-100 focus:ring-amber-500 dark:border-amber-600 dark:bg-gray-900/40 dark:text-amber-200 dark:hover:bg-amber-900/50`}
              >
                {t("audio.draft.resend")}
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadBlobToDevice(draft.blob, buildRecordingFilename(draft.mimeType))
                }
                className={`${buttonBase} border border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 focus:ring-indigo-500 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200 dark:hover:bg-indigo-900/50`}
              >
                {t("audio.draft.download")}
              </button>
              <button
                type="button"
                onClick={() => { void handleDiscard(draft); }}
                disabled={busy}
                className={`${buttonBase} border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700`}
              >
                {t("audio.draft.discard")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
    {confirmDialog}
    </>
  );
}
