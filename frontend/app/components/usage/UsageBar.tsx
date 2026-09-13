'use client';

import { useTranslation } from 'react-i18next';

import type { UsageState } from '@/services/usageLimits';

interface UsageBarProps {
  used: number;
  baseLimit: number;
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

/**
 * BEYOND THE LINE IS A LIGHTER SHADE OF THE SAME COLOUR — never red.
 *
 * Red would say "danger" about the one stretch of the bar that exists to say the opposite:
 * this part is being carried for you (F7 — past the limit is a GRACIOUS state, not an alarm).
 * The excess is set apart by weight, not by warning, and what does the telling is the mark
 * where a hundred percent stands.
 */
const OVER_TONE: Record<UsageState, string> = {
  normal: 'bg-blue-300 dark:bg-blue-300/60',
  warning: 'bg-amber-300 dark:bg-amber-300/60',
  grace: 'bg-fuchsia-300 dark:bg-fuchsia-400/60',
  blocked: 'bg-fuchsia-300 dark:bg-fuchsia-400/60',
};

export default function UsageBar({
  used,
  baseLimit,
  state,
  size = 'full',
  valueLabel,
}: UsageBarProps) {
  const { t } = useTranslation();
  const safeUsed = finiteNonNegative(used);
  const safeBaseLimit = finiteNonNegative(baseLimit);
  const basePercentage = safeBaseLimit > 0
    ? Math.round((safeUsed / safeBaseLimit) * 100)
    : 0;
  /**
   * PAST THE LINE THE TRACK GROWS, AND THE LINE STAYS VISIBLE ON IT.
   *
   * Two earlier shapes were both wrong in the same way — they hid where a hundred percent is.
   * Spanning the hard cap left grey room to the right of someone already over ("still headroom"
   * beside a number saying 102%). Clamping at the limit filled the bar solid, which is honest
   * about being full and silent about being PAST. So the track now spans what was actually
   * used: the allowance runs in the state's own colour up to the mark, the excess runs on past
   * it in a lighter shade, and the mark itself is labelled 100% — the boundary is a place on
   * the bar you can point at, and everything to its right is the grace.
   */
  const scale = Math.max(safeUsed, safeBaseLimit);
  const allowancePercentage = scale > 0 ? clamp((Math.min(safeUsed, safeBaseLimit) / scale) * 100, 0, 100) : 0;
  const overagePercentage = scale > 0 ? clamp(((safeUsed - safeBaseLimit) / scale) * 100, 0, 100) : 0;
  const isOver = overagePercentage > 0;
  const compact = size === 'compact';
  const displayedValue = valueLabel ?? t('usage.bar.usedOfLimit', {
    used: safeUsed,
    limit: safeBaseLimit,
  });
  // Near the right end the caption would hang off the track, so it tucks in on the used side
  // of the mark instead of straddling it. Either way it reads as a label on that one line.
  const markCaptionShift = allowancePercentage > 75 ? 'translateX(-100%)' : 'translateX(-50%)';

  return (
    <div
      aria-label={t('usage.bar.ariaUsed', {
        used: safeUsed,
        limit: safeBaseLimit,
        pct: basePercentage,
      })}
      aria-valuemax={safeBaseLimit}
      aria-valuemin={0}
      aria-valuenow={Math.min(safeUsed, safeBaseLimit)}
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
      <div className={`${compact ? 'h-1.5' : 'h-2.5'} relative flex overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700`}>
        <span
          className={`${STATE_TONE[state]} block h-full transition-[width] duration-200 ${isOver ? '' : 'rounded-full'}`}
          data-testid="usage-bar-fill"
          style={{ width: `${allowancePercentage}%` }}
        />
        {isOver && (
          <span
            className={`${OVER_TONE[state]} block h-full transition-[width] duration-200`}
            data-testid="usage-bar-overage"
            style={{ width: `${overagePercentage}%` }}
          />
        )}
        {isOver && (
          <span
            aria-hidden="true"
            className="absolute inset-y-0 z-10 w-0.5 bg-white dark:bg-slate-900"
            data-testid="usage-bar-limit-mark"
            style={{ left: `${allowancePercentage}%` }}
          />
        )}
      </div>
      {isOver && (
        <div className={`relative ${compact ? 'mt-0.5 h-3.5 text-[10px]' : 'mt-1 h-4 text-[11px]'}`}>
          <span
            className="absolute whitespace-nowrap font-medium tabular-nums text-slate-500 dark:text-slate-400"
            data-testid="usage-bar-limit-caption"
            style={{ left: `${allowancePercentage}%`, transform: markCaptionShift }}
          >
            {t('usage.bar.percent', { pct: 100 })}
          </span>
        </div>
      )}
    </div>
  );
}
