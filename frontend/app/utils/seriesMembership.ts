import { Series } from '@/models/models';

/**
 * Playlist model: `series.items[]` is the SOLE source of truth for series↔ref
 * membership. "Which series is a sermon/group in" is DERIVED from the loaded
 * series list — never read off the deprecated `sermon.seriesId`/`group.seriesId`
 * back-ref (those fields are kept in the types but ignored).
 *
 * A ref belongs to a series if the series' `items[]` (or the derived `sermonIds`
 * legacy mirror) contains it. By construction the membership write (the client
 * sweep) keeps a ref in AT MOST one series, so `getSeriesForRef` normally has a
 * single match. The deterministic tiebreak (lowest series id) is a migration-
 * window safety net so a transient double-membership still resolves stably
 * instead of flapping by list order.
 */
/** True if a series contains a ref — checks items[] (truth) and the legacy sermonIds mirror. */
export const seriesContainsRef = (series: Series, refId: string): boolean =>
  (series.items ?? []).some((item) => item.refId === refId) ||
  (series.sermonIds ?? []).includes(refId);

export const getSeriesForRef = (
  refId: string | undefined | null,
  seriesList: Series[] | undefined | null
): Series | undefined => {
  if (!refId) return undefined;
  const matches = (seriesList ?? []).filter((series) => seriesContainsRef(series, refId));
  if (matches.length <= 1) return matches[0];
  // Deterministic tiebreak — lowest id wins so the derive is stable regardless
  // of list ordering while stray multi-membership is being reconciled away.
  return [...matches].sort((a, b) => a.id.localeCompare(b.id))[0];
};

/**
 * Set of every refId that is a member of ANY series in the loaded list. Used by
 * the sermons list filter ("in a series" vs "standalone") so it derives from the
 * playlist truth instead of the deprecated `sermon.seriesId` back-ref.
 */
export const buildInSeriesRefIds = (seriesList: Series[] | undefined | null): Set<string> => {
  const refIds = new Set<string>();
  for (const series of seriesList ?? []) {
    for (const item of series.items ?? []) {
      if (item.refId) refIds.add(item.refId);
    }
    for (const sermonId of series.sermonIds ?? []) {
      if (sermonId) refIds.add(sermonId);
    }
  }
  return refIds;
};
