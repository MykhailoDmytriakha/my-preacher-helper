'use client';

import { useTranslation } from 'react-i18next';

import { USAGE_KIND_LOOK } from '../usageKinds';

/** An analysis named by its passage — «Разбор · Еф 1:3–14» — in the analysis kind's own violet and sign (`usageKinds.ts`). */
export function AnalysisPlaceChip({ place }: { place: string }) {
  const { t } = useTranslation();
  const { Icon, badge } = USAGE_KIND_LOOK.analysis;
  return (
    <span className={`inline-flex h-6 items-center gap-[5px] rounded-full border pl-[2px] pr-2 text-xs font-bold ${badge.capsule}`}>
      <span className={`inline-flex h-[18px] w-[18px] items-center justify-center rounded-full ${badge.circle}`}>
        <Icon className="h-3 w-3 text-white" aria-hidden="true" />
      </span>
      {t('analysis.title', { place })}
    </span>
  );
}
