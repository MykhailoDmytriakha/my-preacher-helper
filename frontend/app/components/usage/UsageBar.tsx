'use client';

import { useTranslation } from 'react-i18next';

interface UsageBarProps {
  remaining: number;
  limit: number;
  size?: 'compact' | 'full';
}

const clampPercentage = (percentage: number): number => Math.min(100, Math.max(0, percentage));

export default function UsageBar({ remaining, limit, size = 'full' }: UsageBarProps) {
  const { t } = useTranslation();
  const pct = clampPercentage(limit > 0 ? Math.round((remaining / limit) * 100) : 0);
  const displayRemaining = limit > 0 ? Math.min(limit, Math.max(0, remaining)) : 0;
  const tone = pct === 0
    ? 'bg-rose-500 dark:bg-rose-400'
    : pct <= 20
      ? 'bg-amber-500 dark:bg-amber-400'
      : 'bg-blue-600 dark:bg-blue-400';
  const compact = size === 'compact';

  return (
    <div
      aria-label={t('usage.bar.aria', { remaining: displayRemaining, limit, pct })}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={pct}
      className={compact ? 'min-w-28' : 'w-full'}
      data-testid="usage-bar"
      role="progressbar"
    >
      <div className={`${compact ? 'mb-1 text-[11px]' : 'mb-2 text-sm'} flex justify-between gap-2 font-medium text-slate-500 dark:text-slate-400`}>
        <span>{t('usage.bar.remainingOfLimit', { remaining: displayRemaining, limit })}</span>
        <span>{t('usage.bar.percent', { pct })}</span>
      </div>
      <div className={`${compact ? 'h-1.5' : 'h-2.5'} overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700`}>
        <span
          className={`${tone} block h-full rounded-full transition-[width] duration-200`}
          data-testid="usage-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
