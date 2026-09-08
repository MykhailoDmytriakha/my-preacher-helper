'use client';

import { useTranslation } from 'react-i18next';

import { TechnicalDetailsButton } from '@/components/diagnostics/TechnicalDetailsButton';
import { useDeviceOnline } from '@/hooks/useOnlineStatus';

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
  /**
   * This banner stands down for ONE reason: the device has no network, so the crossed-out
   * Wi-Fi icon already says everything there is to say. The app-wide "are we online" answer
   * is the wrong one to ask — a single request timing out marks the SERVER unreachable
   * while Wi-Fi and Firestore are fine, and the person would lose the specific warning that
   * what they are editing may be stale.
   */
  const deviceOffline = !useDeviceOnline();

  if (isPureOfflineSilence({ unknown, deleted, deviceOffline, diagnostics })) return null;

  const entity = t(`freshness.${entityKey}`);
  const copy = messageKeys({
    deleted,
    unknown,
    dirty,
    hasRefresh: Boolean(onRefresh),
    reason: headlineReason(diagnostics),
  });
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
        <TechnicalDetailsButton />
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


/**
 * WHILE THERE IS NO CONNECTION, THE CROSSED-OUT WI-FI ICON IS THE WHOLE MESSAGE —
 * BUT ONLY WHEN "NO CONNECTION" IS GENUINELY ALL THERE IS TO SAY.
 *
 * "We cannot confirm this is the newest version" is TRUE offline, and it is also the
 * obvious consequence of having no internet, which the header icon and the top strip
 * already say in one glance. Spelling it out here produced the opposite of help: a
 * panel headed "the device reports no internet", a timeline of check attempts and a
 * developer-details button, filling the top of an iPad that had simply been opened
 * with the Wi-Fi off.
 *
 * ⚠️ WHAT MAKES THIS DANGEROUS TO WRITE AS `unknown && !isOnline`. Going offline does
 * not erase what the server already told us: `unavailable()` in `useDocumentFreshness`
 * flips the STATE to `unknown` while `remotelyDeleted` and `remote` keep holding a
 * confirmed answer, and every screen passes `unknown` and `deleted` at the same time.
 * A bare offline check therefore hid "this record was deleted on another device" the
 * moment the Wi-Fi dropped — leaving someone typing into a record that no longer
 * exists, which is the exact loss this banner was built to prevent.
 *
 * So silence requires ALL of:
 *   - the device really is offline, and freshness really is unverifiable;
 *   - the server never told us anything that outlives the connection — no confirmed
 *     deletion, no confirmed difference;
 *   - nothing in the incident is a problem that will still be there once the
 *     connection returns. Access denied and a lost account are exactly that: they
 *     say the next save will fail for a reason no amount of Wi-Fi fixes.
 */
export function isPureOfflineSilence({ unknown, deleted, deviceOffline, diagnostics }: {
  unknown: boolean;
  deleted: boolean;
  /** The DEVICE has no network — not merely "the app considers itself offline". */
  deviceOffline: boolean;
  diagnostics?: FreshnessDiagnostics;
}): boolean {
  if (!unknown || !deviceOffline || deleted) return false;
  // A server answer that survives losing the connection.
  if (diagnostics?.lastServerResult === 'different' || diagnostics?.lastServerResult === 'deleted') return false;
  /**
   * Read the REMEMBERED failure, not the event history. `incident.events` is a ring buffer
   * that keeps only the last few entries, so pressing "check again" a few times offline —
   * each press appending two events — could push an access denial out of the window and
   * take the whole banner, retry button included, off the screen.
   */
  return diagnostics?.persistentFailure == null;
}

/**
 * WHICH REASON THE BANNER LEADS WITH.
 *
 * `incident.origin` is deliberately sticky — it keeps the first event of an incident — and
 * that makes it the wrong thing to headline twice over. Once a connection drops, the origin
 * stays `offline`, so when the network comes back this banner reappears (the state is still
 * `unknown` until a server snapshot lands) headed "the device reports no internet" over a
 * working connection. That is the very sentence this work started from, merely relocated.
 * And if something serious arrived AFTER the disconnection — permission revoked, session
 * gone, the watch terminated — the sticky origin buries it under generic uncertainty, at
 * the moment the person most needs to know their next save will fail.
 *
 * So: lead with anything that outlives the connection, whenever it happened; otherwise with
 * the origin; and never with `offline` once we are back online.
 */
function headlineReason(diagnostics: FreshnessDiagnostics | undefined): FreshnessReason | undefined {
  if (diagnostics?.persistentFailure) return diagnostics.persistentFailure;
  const incident = diagnostics?.incident;
  if (!incident) return undefined;
  if (incident.origin.reason !== 'offline') return incident.origin.reason;
  /**
   * "The device reports no internet" is never the headline. Once the connection is back it
   * is simply false, and while it is still down the banner is only on screen at all because
   * something more important is true — the server holds a different version, or this record
   * was deleted elsewhere. Leading with the connection would bury that under the very
   * sentence this work set out to stop showing.
   */
  return undefined;
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
