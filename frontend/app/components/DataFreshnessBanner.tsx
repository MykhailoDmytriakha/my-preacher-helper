'use client';

import { useTranslation } from 'react-i18next';

import type { FreshnessDiagnostics, FreshnessReason } from '@/hooks/useDocumentFreshness';

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
  diagnostics?: FreshnessDiagnostics;
  checking?: boolean;
  canCheck?: boolean;
  /** Checks server state without loading it into the editor. */
  onCheckAgain?: () => void | Promise<void>;
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
  diagnostics,
  checking = false,
  canCheck = true,
  onCheckAgain,
  onRefresh,
  refreshing = false,
  onDismiss,
  className = '',
}: DataFreshnessBannerProps) {
  const { t } = useTranslation();
  const incident = diagnostics?.incident;


  const entity = t(`freshness.${entityKey}`);
  const copy = messageKeys({ deleted, unknown, dirty, hasRefresh: Boolean(onRefresh), reason: incident?.origin.reason });
  const description = t(copy.description, copy.namesEntity ? { entity } : undefined);

  return (
    <div
      role="status"
      className={`flex flex-col gap-3 rounded-xl border px-4 py-3 text-sm xl:flex-row xl:items-center xl:justify-between ${
        unknown
          ? 'border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10'
          : 'border-sky-300 bg-sky-50 dark:border-sky-500/40 dark:bg-sky-500/10'
      } ${className}`}
    >
      <div className="min-w-0">
        <p className={`font-medium ${unknown ? 'text-amber-900 dark:text-amber-200' : 'text-sky-900 dark:text-sky-200'}`}>
          {t(copy.title)}
        </p>
        <p className={`mt-0.5 ${unknown ? 'text-amber-800/80 dark:text-amber-200/70' : 'text-sky-800/80 dark:text-sky-200/70'}`}>{description}</p>
        {diagnostics && <FreshnessHistory diagnostics={diagnostics} unknown={unknown} deleted={deleted} />}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-xs">
        {unknown && canCheck && onCheckAgain && (
          <button
            type="button"
            onClick={() => { void onCheckAgain(); }}
            disabled={checking}
            aria-busy={checking}
            className="rounded-lg bg-slate-800 px-3 py-1.5 font-medium text-white transition-colors hover:bg-slate-700 disabled:opacity-70 dark:bg-slate-100 dark:text-slate-900"
          >
            {t(checking ? 'freshness.checkingAction' : 'freshness.checkAgainAction')}
          </button>
        )}
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


function FreshnessHistory({ diagnostics, unknown, deleted }: {
  diagnostics: FreshnessDiagnostics; unknown: boolean; deleted: boolean;
}) {
  const { t, i18n } = useTranslation();
  const incident = diagnostics.incident;
  const latest = incident?.events.at(-1);
  const formatTime = (at: number) => new Intl.DateTimeFormat(i18n?.resolvedLanguage || 'en', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date(at));
  const time = (at: number) => <time dateTime={new Date(at).toISOString()}>{formatTime(at)}</time>;
  if (!incident) return null;
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
      {unknown && diagnostics?.lastServerResult === 'different' && (
        <p className="font-medium">{t('freshness.previouslyDifferent')}</p>
      )}
      {deleted && <p>{t(`freshness.reasons.${incident.origin.reason}`)}</p>}
      <p className="flex flex-wrap gap-x-3 gap-y-1">
        <span>{t(`freshness.sources.${incident.origin.source}`)}</span>
        <span>{t('freshness.since')} {time(incident.origin.at)}</span>
        <span>{diagnostics?.lastServerResponseAt != null
          ? <>{t('freshness.lastServerResponse')} {time(diagnostics.lastServerResponseAt)}</>
          : t('freshness.noServerResponse')}</span>
      </p>
      {latest && latest !== incident.origin && (
        <p>{time(latest.at)} · {t(`freshness.reasons.${latest.reason}`)} ({t(`freshness.sources.${latest.source}`)})</p>
      )}
      <details className="pt-1">
        <summary className="cursor-pointer font-medium text-slate-700 dark:text-slate-200">
          {t('freshness.whatHappened')}
        </summary>
        <ol className="mt-2 space-y-1 border-l border-current/20 pl-3">
          {[incident.origin, ...incident.events.filter((event) => event !== incident.origin)].map((event, index) => (
            <li key={index}>
              {time(event.at)} · {t(`freshness.reasons.${event.reason}`)}
              <span className="ml-1">({t(`freshness.sources.${event.source}`)})</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}


function messageKeys({ deleted, unknown, dirty, hasRefresh, reason }: {
  deleted: boolean; unknown: boolean; dirty: boolean; hasRefresh: boolean; reason?: FreshnessReason;
}) {
  if (deleted) return { title: 'freshness.deletedTitle', description: 'freshness.deletedDescription', namesEntity: false };
  if (unknown) return {
    title: reason ? `freshness.reasons.${reason}` : 'freshness.unknownTitle',
    description: reason ? 'freshness.checkOnlyHint' : 'freshness.unknownDescription',
    namesEntity: !reason,
  };
  // Offer replacement only where the caller supplies a safe action.
  return {
    title: 'freshness.title',
    description: dirty ? 'freshness.dirtyDescription' : hasRefresh ? 'freshness.description' : 'freshness.descriptionNoAction',
    namesEntity: true,
  };
}
