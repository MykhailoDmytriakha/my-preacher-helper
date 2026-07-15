'use client';

import { useTranslation } from 'react-i18next';

import type { UsageState } from '@/services/usageLimits';

interface UsageBarProps {
  used: number;
  baseLimit: number;
  hardCap: number;
  state: UsageState;
  size?: 'compact' | 'full';
  valueLabel?: string;
}

const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

const finiteNonNegative = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : 0;

const STATE_TONE: Record<UsageState, string> = {
  normal: 'bg-blue-600 dark:bg-blue-400',
  warning: 'bg-amber-500 dark:bg-amber-400',
  grace: 'bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500',
  blocked: 'bg-gradient-to-r from-violet-600 to-fuchsia-600 dark:from-violet-500 dark:to-fuchsia-500',
};

export default function UsageBar({
  used,
  baseLimit,
  hardCap,
  state,
  size = 'full',
  valueLabel,
}: UsageBarProps) {
  const { t } = useTranslation();
  const safeUsed = finiteNonNegative(used);
  const safeBaseLimit = finiteNonNegative(baseLimit);
  const safeHardCap = Math.max(safeBaseLimit, finiteNonNegative(hardCap));
  const basePercentage = safeBaseLimit > 0
    ? Math.round((safeUsed / safeBaseLimit) * 100)
    : 0;
  const fillPercentage = safeHardCap > 0
    ? clamp((safeUsed / safeHardCap) * 100, 0, 100)
    : 0;
  const baseLimitPosition = safeHardCap > 0
    ? clamp((safeBaseLimit / safeHardCap) * 100, 0, 100)
    : 100;
  const compact = size === 'compact';
  const displayedValue = valueLabel ?? t('usage.bar.usedOfLimit', {
    used: safeUsed,
    limit: safeBaseLimit,
  });

  return (
    <div
      aria-label={t('usage.bar.ariaUsed', {
        used: safeUsed,
        limit: safeBaseLimit,
        pct: basePercentage,
      })}
      aria-valuemax={safeHardCap}
      aria-valuemin={0}
      aria-valuenow={Math.min(safeUsed, safeHardCap)}
      className={compact ? 'min-w-28' : 'w-full'}
      data-testid="usage-bar"
      role="progressbar"
    >
      <div
        className={`${compact ? 'mb-1 text-[11px]' : 'mb-2 text-sm'} flex justify-between gap-2 font-medium text-slate-500 dark:text-slate-400`}
        data-testid="usage-bar-labels"
      >
        <span className="tabular-nums">{displayedValue}</span>
        <span className="tabular-nums">{t('usage.bar.percent', { pct: basePercentage })}</span>
      </div>
      <div className={`${compact ? 'h-1.5' : 'h-2.5'} relative overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700`}>
        <span
          className={`${STATE_TONE[state]} block h-full rounded-full transition-[width] duration-200`}
          data-testid="usage-bar-fill"
          style={{ width: `${fillPercentage}%` }}
        />
        {safeHardCap > safeBaseLimit && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 z-10 w-px bg-slate-400/80 dark:bg-slate-500"
            data-testid="usage-bar-base-limit"
            style={{ left: `${baseLimitPosition}%` }}
          />
        )}
      </div>
    </div>
  );
}
