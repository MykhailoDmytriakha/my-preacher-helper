'use client';

import { useTranslation } from 'react-i18next';

/**
 * "The server REFUSED your save, because someone changed this elsewhere."
 *
 * This is NOT an error message and NOT the freshness banner:
 *  - `DataFreshnessBanner` says the record CHANGED (detection). Nothing was lost;
 *    it merely offers to load the newer version.
 *  - this one says a write was TURNED AWAY (protection). Something the person
 *    typed has nowhere to live yet, so it must be held and handed back.
 *
 * A plain toast is not enough here. On the note page the text stayed in the
 * editor, so a toast was survivable; on the sermon header the editors close on a
 * resolved save and revert to the server value, so a toast announced "your text
 * is still here" while the text was already gone. Holding `pendingText` and
 * SHOWING it is what makes the promise true.
 */
export interface SaveConflictBannerProps {
  /** What this document IS, so the text names it instead of a generic "record". */
  entityKey?: 'entityNote' | 'entitySermon' | 'entitySeries' | 'entityRecord';
  /**
   * The refused text. Displayed verbatim: the person must SEE that their words
   * survived the refusal, not be told so. Omit when the text is still visible in
   * an open editor (the note page keeps it on screen).
   */
  pendingText?: string;
  /**
   * Save it anyway, on top of the newer version. The caller must re-state the
   * server's CURRENT revision first — otherwise the resend carries the same old
   * revision and is refused again, and the button promises what it never does.
   */
  onKeepMine: () => void;
  /** Discard mine and load what the other device stored. */
  onTakeTheirs: () => void;
  /** A choice is being carried out — keep both buttons from firing twice. */
  busy?: boolean;
  className?: string;
}

export function SaveConflictBanner({
  entityKey = 'entityRecord',
  pendingText,
  onKeepMine,
  onTakeTheirs,
  busy = false,
  className = '',
}: SaveConflictBannerProps) {
  const { t } = useTranslation();
  const entity = t(`freshness.${entityKey}`);

  return (
    <div
      role="alert"
      className={`flex flex-col gap-3 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm dark:border-rose-500/40 dark:bg-rose-500/10 ${className}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-medium text-rose-900 dark:text-rose-200">
            {t('freshness.conflictTitle')}
          </p>
          <p className="mt-0.5 text-rose-800/80 dark:text-rose-200/70">
            {t('freshness.conflictDescription', { entity })}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={onKeepMine}
            disabled={busy}
            className="rounded-lg bg-rose-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-rose-700 disabled:opacity-60"
          >
            {t('freshness.conflictKeepMine')}
          </button>
          <button
            type="button"
            onClick={onTakeTheirs}
            disabled={busy}
            className="rounded-lg border border-rose-300 px-3 py-1.5 font-medium text-rose-900 transition-colors hover:bg-rose-100 disabled:opacity-60 dark:border-rose-500/40 dark:text-rose-200 dark:hover:bg-rose-500/20"
          >
            {t('freshness.conflictTakeTheirs')}
          </button>
        </div>
      </div>
      {pendingText !== undefined && pendingText !== '' && (
        <div className="min-w-0">
          <p className="text-xs font-medium text-rose-900/70 dark:text-rose-200/60">
            {t('freshness.conflictPendingLabel')}
          </p>
          <p className="mt-0.5 max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white/70 px-2 py-1 text-rose-950 dark:bg-black/20 dark:text-rose-100">
            {pendingText}
          </p>
        </div>
      )}
    </div>
  );
}
