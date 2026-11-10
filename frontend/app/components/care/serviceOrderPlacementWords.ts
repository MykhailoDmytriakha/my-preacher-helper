import type { TextComparison } from '@/data-engine/DataSyncStatus';
import type { SessionCheckpoint } from '@/data-engine/session';
import type { LabeledServiceOrderPlacement } from '@/data-engine/types';

export function serviceOrderPlacementWords(gap: LabeledServiceOrderPlacement, t: (key: string, values?: Record<string, string>) => string): string {
  const previous = gap.previous?.title;
  const next = gap.next?.title;
  if ((gap.previous && !previous) || (gap.next && !next)) return t('serviceOrders.placementHistory.positionUnavailable');
  if (previous && next) return t('serviceOrders.placementHistory.between', { previous, next });
  if (previous) return t('serviceOrders.placementHistory.after', { previous });
  if (next) return t('serviceOrders.placementHistory.before', { next });
  return t('serviceOrders.placementHistory.positionUnavailable');
}

export function anchoredStepComparison(checkpoint: SessionCheckpoint | undefined, labelKey: string,
  t: (key: string, values?: Record<string, string>) => string): TextComparison | undefined {
  const placement = checkpoint?.serviceOrderPlacementComparison;
  if (!placement?.step) return undefined;
  const label = t(labelKey);
  return { identity: JSON.stringify([checkpoint?.remoteCandidate?.metadata?.revision, placement]),
    title: placement.step.title ? label + ' · ' + placement.step.title : label,
    mine: serviceOrderPlacementWords(placement.mine, t),
    stored: placement.saved ? serviceOrderPlacementWords(placement.saved, t) : t('serviceOrders.placementHistory.positionUnavailable'),
    valueKind: 'field', scopedChoice: true, keepMineDisabled: !placement.available };
}
