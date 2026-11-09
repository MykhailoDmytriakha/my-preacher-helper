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
