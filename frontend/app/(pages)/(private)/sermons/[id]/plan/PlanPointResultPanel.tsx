import MarkdownDisplay from '@/components/MarkdownDisplay';

import { getPointFromLookup, type PlanOutlineLookup } from './planOutlineLookup';

import type { PlanPointResult } from './planPointResult.client';

interface Props {
  results: Record<string, PlanPointResult>;
  generating: Record<string, boolean>;
  outline: PlanOutlineLookup;
  applyDisabled: boolean;
  t: (key: string) => string;
  recover: (pointId: string, resume?: boolean) => Promise<void>;
  apply: (pointId: string, value: PlanPointResult) => void;
  discard: (pointId: string, value: PlanPointResult) => void;
}

export default function PlanPointResultPanel({ results, generating, outline, applyDisabled, t, recover, apply, discard }: Props) {
  const entries = Object.entries(results);
  if (!entries.length) return null;
  const button = 'rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50';
  return <section aria-label={t('plan.pointResultTitle')} className="mb-4 space-y-3">
    {entries.map(([pointId, result]) => {
      const point = getPointFromLookup(outline, pointId);
      return <article key={result.id} className="space-y-2 rounded-lg border border-blue-300 bg-blue-50 p-3 dark:border-blue-900 dark:bg-blue-950">
        <h2 className="font-semibold">{point?.text ?? t('plan.pointResultRemovedPoint')}</h2>
        {result.kind === 'ready' ? (
          <>
            <p className="text-sm">{t('plan.pointResultTitle')}</p>
            <MarkdownDisplay content={result.content} />
          </>
        ) : <p role="status" className="text-sm">{t(result.kind === 'failed' ? result.message
          : result.receiptMissing ? 'plan.pointResultNotStarted' : 'errors.aiResultPending')}</p>}
        <div className="flex flex-wrap gap-2">
          {result.kind === 'pending' ? (
            <>
              <button type="button" className={button} disabled={generating[pointId]} onClick={() => void recover(pointId)}>
                {t('plan.pointResultCheck')}
              </button>
              {result.receiptMissing && point && <button type="button" className={button} disabled={generating[pointId]}
                onClick={() => void recover(pointId, true)}>{t('plan.pointResultResume')}</button>}
            </>
          ) : (
            <>
              {result.kind === 'ready' && point && <button type="button" className={button} disabled={applyDisabled || generating[pointId]}
                onClick={() => apply(pointId, result)}>{t('plan.pointResultApply')}</button>}
              <button type="button" className={button} disabled={generating[pointId]} onClick={() => discard(pointId, result)}>{t('plan.pointResultDismiss')}</button>
            </>
          )}
        </div>
      </article>;
    })}
  </section>;
}
