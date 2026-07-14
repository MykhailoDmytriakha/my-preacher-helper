'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';

import Tooltip from '@/components/ui/Tooltip';
import UsageBar from '@/components/usage/UsageBar';
import { useUserEntitlement } from '@/hooks/useUserEntitlement';

import type { User } from 'firebase/auth';

interface UsageWidgetProps {
  user: User | null;
}

export default function UsageWidget({ user }: UsageWidgetProps) {
  const { t } = useTranslation();
  const { data: entitlement, isLoading, isError } = useUserEntitlement(user);

  if (!user) return null;

  if (isLoading) {
    return (
      <div className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" data-testid="usage-widget-loading">
        <div className="animate-pulse">
          <div className="h-5 w-1/4 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="mt-3 h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
      </div>
    );
  }

  if (isError || !entitlement) return null;

  const tierLabel = entitlement.effectiveTier === 'free'
    ? t('settings.usage.tier.free')
    : t('settings.usage.tier.paid', { tier: entitlement.effectiveTier.replace('tier', '') });

  return (
    <section className="rounded-[14px] bg-white p-4 shadow-sm dark:bg-slate-800 md:p-6" aria-labelledby="usage-widget-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="usage-widget-title" className="text-lg font-semibold text-gray-900 dark:text-white">
          {t('settings.usage.title')}
        </h2>
        <span className="rounded-md bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          {tierLabel}
        </span>
      </div>
      <dl className="mt-4 space-y-4">
        <div>
          <dt className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-400">
            {t('settings.usage.aiRemaining')}
            <Tooltip content={t('settings.usage.aiInfo')}>
              <button
                type="button"
                className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-xs font-semibold text-gray-600 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:border-gray-500 dark:text-gray-300 dark:focus-visible:ring-offset-slate-800"
                aria-label={t('settings.usage.aiInfoLabel')}
              >
                i
              </button>
            </Tooltip>
          </dt>
          <dd className="sr-only">{entitlement.usage.aiRemaining}</dd>
          <UsageBar
            limit={entitlement.usage.aiLimit}
            remaining={entitlement.usage.aiRemaining}
            size="full"
          />
        </div>
        <div>
          <dt className="text-sm text-slate-600 dark:text-slate-400">{t('settings.usage.transcriptionRemaining')}</dt>
          <dd className="sr-only">{t('settings.usage.transcriptionSeconds', { count: entitlement.usage.transcriptionSecondsRemaining })}</dd>
          <UsageBar
            limit={entitlement.usage.transcriptionSecondsLimit}
            remaining={entitlement.usage.transcriptionSecondsRemaining}
            size="full"
          />
        </div>
      </dl>
    </section>
  );
}
