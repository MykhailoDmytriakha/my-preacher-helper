import { deriveSermonIdsFromItems, inferSeriesKind, normalizeSeriesItems } from './seriesItems';
import { compareById, timeOrZero } from './sortHelpers';

import type { Series } from '@/models/models';

/** Pure presentation shape shared by legacy reads and the engine's projections. */
export function hydrateSeries(series: Series): Series {
  const items = normalizeSeriesItems(series.items, series.sermonIds || []);
  return { ...series, items, sermonIds: deriveSermonIdsFromItems(items), seriesKind: series.seriesKind || inferSeriesKind(items) };
}

export function sortSeries(list: Series[]): Series[] {
  return [...list].sort((a, b) => {
    const byDate = timeOrZero(b.startDate) - timeOrZero(a.startDate);
    if (byDate !== 0) return byDate;
    const byTitle = (a.title || '').localeCompare(b.title || '');
    return byTitle || compareById(a, b);
  });
}
