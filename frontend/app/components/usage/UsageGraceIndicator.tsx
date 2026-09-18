'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import Tooltip from '@/components/ui/Tooltip';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import {
  formatUsageResetDate,
  getAggregateUsageState,
  getDeterministicVerse,
  getRotatingVerse,
  getDevUsageOverride,
  getGraceDedupKey,
  getUsageIndicatorTone,
  getUsageOverage,
  getUsageRemaining,
  normalizeGraceVerses,
  type UsageIndicatorTone,
  type UsageMetrics,
} from '@/utils/usageGrace';

import type { UsageResource, UsageState } from '@/services/usageLimits';
import type { User } from 'firebase/auth';
import type { ReactNode } from 'react';

const RESOURCE_ORDER: UsageResource[] = ['ai', 'transcription', 'audio'];

/** The two notices differ in their words and in which verse they pick — nothing else. */
const GRACE_NAMESPACES = ['translation', 'graceVerses'] as const;
const VERSES_KEY = 'graceVerses:verses';

/**
 * HOW MANY TIMES THESE WORDS HAVE BEEN SHOWN, across every surface that shows them.
 *
 * Shared on purpose: opening the tooltip and then walking into settings are one continuous
 * act of looking, and meeting the same line twice inside it reads as a page that did not
 * notice you came back. Module-level rather than React state because the surfaces do not
 * share a parent, and because nothing here needs to survive a reload — the cycle simply
 * carries on from wherever it was.
 */
let verseViews = 0;
const takeVerseView = (): number => {
  verseViews += 1;
  return verseViews;
};

export interface UsageGraceViewModel {
  metrics: UsageMetrics;
  tone: UsageIndicatorTone;
}

interface UsageGraceControllerProps {
  user: User | null;
  devUsageParam?: string | null;
  children: (model: UsageGraceViewModel | null) => ReactNode;
}

const metricLabelKey: Record<UsageResource, string> = {
  ai: 'usageGrace.metrics.ai',
  transcription: 'usageGrace.metrics.transcription',
  audio: 'usageGrace.metrics.audio',
};

const formatMinutes = (seconds: number): string => {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const roundedMinutes = Math.round(safeSeconds / 60);
  return safeSeconds > 0 && roundedMinutes === 0 ? '<1' : String(roundedMinutes);
};

export function UsageGraceController({
  user,
  devUsageParam,
  children,
}: UsageGraceControllerProps) {
  const { t } = useTranslation([...GRACE_NAMESPACES]);
  const entitlementUser = user && typeof user.getIdToken === 'function' ? user : null;
  const { data: entitlement } = useUserEntitlement(entitlementUser);
  const previousStateRef = useRef<{ uid: string; state: UsageState } | null>(null);

  const metrics = useMemo<UsageMetrics | null>(() => {
    if (!entitlement) return null;
    return {
      ai: entitlement.usage.ai,
      transcription: entitlement.usage.transcription,
      audio: entitlement.usage.audio,
    };
  }, [entitlement]);

  const aggregateState = metrics ? getAggregateUsageState(metrics) : null;
  const period = metrics?.ai.resetsAt ?? '';

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      previousStateRef.current = null;
      return;
    }

    if (previousStateRef.current && previousStateRef.current.uid !== uid) {
      previousStateRef.current = null;
    }

    if (!aggregateState || !period) return;

    const previous = previousStateRef.current;
    previousStateRef.current = { uid, state: aggregateState };

    if (!previous) return;
    if (
      (previous.state !== 'normal' && previous.state !== 'warning')
      || aggregateState !== 'grace'
    ) {
      return;
    }

    const dedupKey = getGraceDedupKey(uid, period);
    try {
      if (localStorage.getItem(dedupKey)) return;
      localStorage.setItem(dedupKey, '1');
    } catch {
      // Storage is best-effort; the user should still receive the transition message.
    }

    const verses = normalizeGraceVerses(t(VERSES_KEY, { returnObjects: true }));
    const verse = getDeterministicVerse(verses, period, 0);
    toast(t('usageGrace.graceToast'), {
      description: verse || undefined,
      duration: 12_000,
      id: dedupKey,
    });
  }, [aggregateState, period, t, user?.uid]);

  if (!metrics) return children(null);

  const devUsageOverride = getDevUsageOverride({
    nodeEnv: process.env.NODE_ENV,
    enabled: process.env.NEXT_PUBLIC_ENABLE_DEV_USAGE,
    hostname: typeof window === 'undefined' ? undefined : window.location.hostname,
    queryValue: devUsageParam,
  });

  return children({
    metrics,
    tone: getUsageIndicatorTone(metrics, devUsageOverride),
  });
}

interface UsageGraceIndicatorProps {
  model: UsageGraceViewModel | null;
  placement: 'desktop' | 'mobile';
}

export function UsageGraceIndicator({ model, placement }: UsageGraceIndicatorProps) {
  const { t, i18n } = useTranslation([...GRACE_NAMESPACES]);
  // Bumped where the hovering happens, because the tooltip primitive does not report opening
  // and ten other callers do not need it to.
  const [verseView, setVerseView] = useState(0);
  if (!model?.tone) return null;

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const dotTone = model.tone === 'warning'
    ? 'bg-amber-500 dark:bg-amber-400'
    : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500';

  /**
   * The verse belongs to the state, not to the indicator. Past the line it says why anything
   * still works; at 85% the same words invent a shortage that is not there (F7: do not create
   * the anxiety of deficit).
   */
  const carried = model.tone === 'overage';
  const verses = carried ? normalizeGraceVerses(t(VERSES_KEY, { returnObjects: true })) : [];
  const verse = verses.length > 0
    ? getRotatingVerse(verses, model.metrics.ai.resetsAt, verseView)
    : '';

  const tooltip = (
    <div className="min-w-52 space-y-2" data-testid={`usage-grace-tooltip-${placement}`}>
      <p className="font-semibold">{t('usageGrace.tooltipTitle')}</p>
      <dl className="space-y-2">
        {RESOURCE_ORDER.map((resource) => {
          const metric = model.metrics[resource];
          const remaining = getUsageRemaining(metric);
          const overage = getUsageOverage(metric);
          const counted = resource === 'ai';
          /**
           * PAST THE LINE A COUNTER IS THE WRONG ANSWER TO THE WRONG QUESTION.
           *
           * "8 left" beside a bar reading 102% is the contradiction this panel was reported
           * for, and printing what is left of the GRACE instead only moves the lie: the
           * person does not read that number as grace, he reads it as allowance. So past the
           * line the row stops counting and says where he stands; how much longer he is
           * carried is not his budget to spend, and the verse under it is the real answer.
           */
          let value: string;
          if (overage > 0) {
            value = t('usageGrace.overLimit');
          } else if (metric.state === 'grace' || metric.state === 'blocked') {
            // Exactly on the line: nothing has been exceeded, but nothing of his own is left
            // either, so "N left" would be just as wrong in the other direction.
            value = t('usageGrace.limitReached');
          } else {
            value = counted
              ? t('usageGrace.remainingCount', { count: Math.max(0, Math.floor(remaining)) })
              : t('usageGrace.remainingMinutes', { value: formatMinutes(remaining) });
          }
          return (
            <div key={resource}>
              <dt className="font-medium">{t(metricLabelKey[resource])}</dt>
              <dd className="text-slate-200 dark:text-slate-700">
                {value} · {t('usageGrace.resetsAt', {
                  date: formatUsageResetDate(metric.resetsAt, locale),
                })}
              </dd>
            </div>
          );
        })}
      </dl>
      {verse && (
        <p className="italic opacity-80" data-testid={`usage-grace-verse-${placement}`}>{verse}</p>
      )}
      {carried && (
        <Link
          className="mt-1 inline-flex w-full items-center justify-center rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 transition hover:bg-slate-200 dark:bg-slate-900 dark:text-white dark:hover:bg-slate-700"
          data-testid={`usage-grace-settings-${placement}`}
          href="/settings/limits"
        >
          {t('usageGrace.openSettings')}
        </Link>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltip} hoverDelay={250}>
      <button
        type="button"
        onPointerEnter={() => setVerseView(takeVerseView())}
        onFocus={() => setVerseView(takeVerseView())}
        aria-label={t('usageGrace.indicatorLabel')}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
        data-testid={`usage-grace-indicator-${placement}`}
      >
        <span
          aria-hidden="true"
          className={`${dotTone} h-2.5 w-2.5 rounded-full shadow-sm`}
          data-testid={`usage-grace-dot-${placement}`}
        />
      </button>
    </Tooltip>
  );
}

/**
 * THE GRACE HAS TO BE FELT, not merely granted.
 *
 * The warm notice was shown only once the hard cap was reached, so the whole grace band —
 * the part where the person IS being carried — passed in silence: a bar past its end, a
 * number over a hundred, and nothing saying why anything still worked. F7 asks for the
 * opposite ("грация должна ЧУВСТВОВАТЬСЯ как забота, не быть молчаливой").
 */
function GraceNotice({
  resetsAt,
  bodyKey,
  testId,
  extraKey,
}: {
  resetsAt: string;
  bodyKey: string;
  testId: string;
  extraKey?: string;
}) {
  const { t, i18n } = useTranslation([...GRACE_NAMESPACES]);
  // Taken once per visit, from the same cycle the tooltip walks: arriving here straight from
  // the tooltip shows the NEXT verse, not the one just read a second ago. Safe to take during
  // render because this notice never reaches the server — the widget renders a skeleton until
  // its client query resolves.
  const [verseView] = useState(takeVerseView);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const verses = normalizeGraceVerses(t(VERSES_KEY, { returnObjects: true }));
  const verse = getRotatingVerse(verses, resetsAt, verseView);

  return (
    <aside
      className="mt-4 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 text-sm text-violet-950 dark:border-violet-800/70 dark:from-violet-950/40 dark:to-fuchsia-950/30 dark:text-violet-100"
      data-testid={testId}
    >
      <p>{t(bodyKey, { date: formatUsageResetDate(resetsAt, locale) })}</p>
      {extraKey && <p className="mt-2">{t(extraKey)}</p>}
      {verse && <p className="mt-3 italic opacity-80">{verse}</p>}
    </aside>
  );
}

/**
 * THE GRACE HAS TO BE FELT, not merely granted.
 *
 * The warm notice used to wait for the hard cap, so the whole band where the person IS being
 * carried passed in silence: a full bar, a number over a hundred, and nothing saying why
 * anything still worked. F7 asks for the opposite — grace that is felt as care, not silent.
 */
export function UsageGraceNotice({ resetsAt }: { resetsAt: string }) {
  return <GraceNotice resetsAt={resetsAt} bodyKey="usageGrace.grace" testId="usage-grace-notice" />;
}

export function UsageHardCapNotice({ resetsAt }: { resetsAt: string }) {
  return (
    <GraceNotice
      resetsAt={resetsAt}
      bodyKey="usageGrace.hardCap"
      testId="usage-hard-cap-notice"
      extraKey="usageGrace.softExpansion"
    />
  );
}
