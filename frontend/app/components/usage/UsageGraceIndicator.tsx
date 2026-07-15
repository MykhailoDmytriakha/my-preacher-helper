'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import Tooltip from '@/components/ui/Tooltip';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';
import {
  formatUsageResetDate,
  getAggregateUsageState,
  getDeterministicVerse,
  getDevUsageOverride,
  getGraceDedupKey,
  getUsageIndicatorTone,
  getUsageRemaining,
  normalizeGraceVerses,
  type UsageIndicatorTone,
  type UsageMetrics,
} from '@/utils/usageGrace';

import type { UsageResource, UsageState } from '@/services/usageLimits';
import type { User } from 'firebase/auth';
import type { ReactNode } from 'react';

const RESOURCE_ORDER: UsageResource[] = ['ai', 'transcription', 'audio'];

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
  const { t } = useTranslation(['translation', 'graceVerses']);
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

    const verses = normalizeGraceVerses(t('graceVerses:verses', { returnObjects: true }));
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
  const { t, i18n } = useTranslation();
  if (!model?.tone) return null;

  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const dotTone = model.tone === 'warning'
    ? 'bg-amber-500 dark:bg-amber-400'
    : 'bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500';

  const tooltip = (
    <div className="min-w-52 space-y-2" data-testid={`usage-grace-tooltip-${placement}`}>
      <p className="font-semibold">{t('usageGrace.tooltipTitle')}</p>
      <dl className="space-y-2">
        {RESOURCE_ORDER.map((resource) => {
          const metric = model.metrics[resource];
          const remaining = getUsageRemaining(metric);
          const value = resource === 'ai'
            ? t('usageGrace.remainingCount', { count: Math.max(0, Math.floor(remaining)) })
            : t('usageGrace.remainingMinutes', { value: formatMinutes(remaining) });
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
    </div>
  );

  return (
    <Tooltip content={tooltip} hoverDelay={250}>
      <button
        type="button"
        aria-label={t('usageGrace.indicatorLabel')}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full outline-none transition hover:bg-white focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
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

export function UsageHardCapNotice({ resetsAt }: { resetsAt: string }) {
  const { t, i18n } = useTranslation(['translation', 'graceVerses']);
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const verses = normalizeGraceVerses(t('graceVerses:verses', { returnObjects: true }));
  const verse = getDeterministicVerse(verses, resetsAt, 1);

  return (
    <aside
      className="mt-4 rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 to-fuchsia-50 p-4 text-sm text-violet-950 dark:border-violet-800/70 dark:from-violet-950/40 dark:to-fuchsia-950/30 dark:text-violet-100"
      data-testid="usage-hard-cap-notice"
    >
      <p>{t('usageGrace.hardCap', { date: formatUsageResetDate(resetsAt, locale) })}</p>
      <p className="mt-2">{t('usageGrace.softExpansion')}</p>
      {verse && <p className="mt-3 italic opacity-80">{verse}</p>}
    </aside>
  );
}
