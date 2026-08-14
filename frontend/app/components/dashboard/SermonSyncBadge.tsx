"use client";

import { AlertCircle, Loader2 } from "lucide-react";

import { DashboardOptimisticActions, DashboardSermonSyncState } from "@/models/dashboardOptimistic";
import { copyRecoveryText } from "@/utils/writeRecovery";

import type { TFunction } from "i18next";

const TEXT_PRIMARY_CLASSES = "text-gray-800 dark:text-gray-100";

interface SermonSyncBadgeProps {
  sermonId: string;
  syncState?: DashboardSermonSyncState;
  optimisticActions?: DashboardOptimisticActions;
  t: TFunction;
}

/**
 * A sermon write can be STARTED from more than one screen: the sermon list and the
 * dashboard quick-create both go through `useDashboardOptimisticSermons`, and both must
 * show the same verdict in the same words — a second implementation would be a second
 * reporter, the defect this migration keeps closing.
 *
 * It lives in its own file rather than inside `SermonCard` because importing the card
 * drags the export machinery (`exportContent`) along with it, and a page that only needs
 * to report a refusal should not pay for document export.
 */
export function SermonSyncBadge({ sermonId, syncState, optimisticActions, t }: SermonSyncBadgeProps) {
  if (!syncState) return null;

  const operationLabel =
    syncState.operation === 'create'
      ? t('addSermon.newSermon', { defaultValue: 'New sermon' })
      : syncState.operation === 'delete'
        ? t('optionMenu.delete', { defaultValue: 'Delete' })
        : syncState.operation === 'preach-status'
          ? t('optionMenu.markAsPreached', { defaultValue: 'Preached status' })
          : t('editSermon.editSermon', { defaultValue: 'Edit sermon' });

  if (syncState.status === 'pending') {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/25 dark:text-blue-300 px-2 py-0.5 text-xs font-medium">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span className="uppercase tracking-wide text-[10px]">{t('buttons.saving', { defaultValue: 'Saving' })}</span>
        <span className={TEXT_PRIMARY_CLASSES}>{operationLabel}</span>
      </div>
    );
  }

  /**
   * A REFUSAL IS NOT AN ERROR TO REPEAT. The record changed on another device, so the
   * two buttons are a choice — send mine anyway, or keep theirs — and the words have to
   * say that. Worded as "Sync failed / Retry" the person presses Retry, gets refused
   * again, and eventually presses Dismiss, which throws their own text away.
   */
  const isConflict = Boolean(syncState.conflict);
  const isRefused = Boolean(syncState.refused);

  return (
    <div role="alert" className={`flex max-w-sm flex-col gap-1.5 rounded-lg px-2 py-1 text-xs font-medium ${
      isConflict
        ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/25 dark:text-amber-200'
        : 'bg-red-50 text-red-700 dark:bg-red-900/25 dark:text-red-300'
    }`}>
      <div className="flex items-center gap-1.5">
        <AlertCircle className="h-3 w-3 shrink-0" />
        <span className="uppercase tracking-wide text-[10px]">
          {isConflict
            ? t('freshness.title')
            : isRefused
              ? t('writeRecovery.refusedLabel')
              : t('errors.generic', { defaultValue: 'Error' })}
        </span>
        <span>
          {isConflict
            ? t('freshness.staleSaveToast')
            : syncState.message || t('errors.savingError', { defaultValue: 'Sync failed' })}
        </span>
      </div>
      {syncState.recoveryText && (
        <p className="whitespace-pre-wrap break-words rounded bg-white/70 px-2 py-1 text-gray-900 dark:bg-black/20 dark:text-gray-100">
          {syncState.recoveryText}
        </p>
      )}
      <div className="flex gap-1.5">
        {/*
          Only offered when it can DO something. A refused delete or preached-status change
          carries no draft, and "Copy my text" there was a dead button that replaced the
          clipboard with an empty string — the app claiming to hand back text it never had.
        */}
        {(isConflict || !isRefused || Boolean(syncState.recoveryText)) && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (isRefused && !isConflict) {
                void copyRecoveryText(syncState.recoveryText ?? '');
              } else {
                void optimisticActions?.retrySync(sermonId);
              }
            }}
            className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-red-200 dark:bg-red-800 dark:hover:bg-red-700"
          >
            {isConflict
              ? t('freshness.conflictKeepMine')
              : isRefused
                ? t('freshness.copyTextAction')
                : t('buttons.retry', { defaultValue: 'Retry' })}
          </button>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            optimisticActions?.dismissSyncError(sermonId);
          }}
          className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-white dark:bg-gray-800/70 dark:hover:bg-gray-700"
        >
          {isConflict ? t('freshness.conflictTakeTheirs') : t('buttons.dismiss', { defaultValue: 'Dismiss' })}
        </button>
      </div>
    </div>
  );
}

