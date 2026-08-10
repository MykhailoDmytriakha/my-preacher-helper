'use client';

import { useTranslation } from 'react-i18next';

/**
 * "This document changed on another device."
 *
 * DELIBERATELY NOT the service-worker toast. That one means "a new version of the
 * APP shipped, reload the page" (`SwUpdateToast.tsx`). This one means "the RECORD
 * you are looking at is older than what is stored", and its action reloads the
 * record, not the application. Mixing the two teaches people to dismiss both.
 *
 * It only OFFERS. While the editor holds unsaved changes the action becomes
 * "review", because replacing text under someone who is typing is a worse bug
 * than showing them stale text.
 */
export interface DataFreshnessBannerProps {
  /** Unsaved changes are present — never overwrite them without a decision. */
  dirty: boolean;
  /**
   * i18n key for what this document IS ("note" / "sermon" / "series"), so the text
   * names the thing in front of the user instead of a generic "record". A shared
   * component with hardcoded wording told sermon readers their "note" had changed.
   */
  entityKey?: 'entityNote' | 'entitySermon' | 'entitySeries' | 'entitySettings' | 'entityRecord';
  /** The document was deleted elsewhere; refreshing would show nothing. */
  deleted?: boolean;
  /**
   * We cannot currently tell whether this changed elsewhere — the listener is
   * cache-only or died. Showing nothing here is the quiet lie: the person keeps
   * editing what may already be someone else's yesterday. Same pill, honest words.
   */
  unknown?: boolean;
  /**
   * Take the newer server version. OMIT IT when no safe refresh exists here — the
   * button then disappears and the banner is a pure notification.
   *
   * ⚠️ A refresh that discards unsaved work is NOT a refresh. An earlier version
   * called `window.location.reload()` on the sermon/group/prayer pages and replaced
   * editor state on the note page even while it was dirty: that destroyed prep
   * drafts, meeting fields and open modal text — strictly worse than doing nothing.
   * So callers pass this only when they can refresh WITHOUT touching unsaved text.
   */
  onRefresh?: () => void;
  /**
   * The refresh is in flight. Pulling a record takes a moment on a slow connection,
   * and a button that looks idle while working invites a second and third press.
   */
  refreshing?: boolean;
  /** Keep working on what is on screen and stop nagging. */
  onDismiss: () => void;
  className?: string;
}

export function DataFreshnessBanner({
  dirty,
  entityKey = 'entityRecord',
  deleted = false,
  unknown = false,
  onRefresh,
  refreshing = false,
  onDismiss,
  className = '',
}: DataFreshnessBannerProps) {
  const { t } = useTranslation();

  const entity = t(`freshness.${entityKey}`);
  /**
   * NEVER ASK A QUESTION THE BANNER CANNOT ANSWER.
   *
   * The default wording ends in "load the newer version?" — but the button that
   * does exactly that only appears when `onRefresh` was passed, and callers
   * deliberately omit it wherever refreshing would destroy unsaved work (see the
   * prop docs above). The result on screen was a question with no way to say yes:
   * the owner hit it on production and read it as a broken interface.
   *
   * Without an action the banner states the situation and names what the person can
   * do themselves, instead of promising a button that is not there.
   */
  const description = deleted
    ? t('freshness.deletedDescription')
    : unknown
      ? t('freshness.unknownDescription', { entity })
      : dirty
        ? t('freshness.dirtyDescription', { entity })
        : onRefresh
          ? t('freshness.description', { entity })
          : t('freshness.descriptionNoAction', { entity });

  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
        unknown
          ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
          : 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10'
      } ${className}`}
    >
      <div className="min-w-0">
        <p className={`font-medium ${unknown ? 'text-amber-900 dark:text-amber-200' : 'text-sky-900 dark:text-sky-200'}`}>
          {deleted
            ? t('freshness.deletedTitle')
            : unknown
              ? t('freshness.unknownTitle')
              : t('freshness.title')}
        </p>
        <p className={`mt-0.5 ${unknown ? 'text-amber-800/80 dark:text-amber-200/70' : 'text-sky-800/80 dark:text-sky-200/70'}`}>{description}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {!deleted && !unknown && onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            aria-busy={refreshing}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3 py-1.5 font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {refreshing && (
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              />
            )}
            {refreshing
              ? t('freshness.refreshingAction')
              : dirty
                ? t('freshness.reviewAction')
                : t('freshness.refreshAction')}
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-lg border border-sky-300 px-3 py-1.5 font-medium text-sky-900 transition-colors hover:bg-sky-100 dark:border-sky-500/40 dark:text-sky-200 dark:hover:bg-sky-500/20"
        >
          {t('freshness.dismissAction')}
        </button>
      </div>
    </div>
  );
}
