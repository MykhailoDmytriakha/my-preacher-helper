import { buildInSeriesRefIds, getSeriesForRef } from '@/utils/seriesMembership';

import type { Series, SeriesItem } from '@/models/models';

const makeSeries = (id: string, refIds: string[], extra: Partial<Series> = {}): Series => ({
  id,
  userId: 'u1',
  theme: 'theme',
  bookOrTopic: 'topic',
  status: 'active',
  sermonIds: [],
  items: refIds.map(
    (refId, index): SeriesItem => ({
      id: `sermon-${refId}`,
      type: 'sermon',
      refId,
      position: index + 1,
    })
  ),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

describe('getSeriesForRef', () => {
  it('returns undefined when refId is missing', () => {
    expect(getSeriesForRef('', [makeSeries('a', ['s1'])])).toBeUndefined();
    expect(getSeriesForRef(undefined, [makeSeries('a', ['s1'])])).toBeUndefined();
    expect(getSeriesForRef(null, null)).toBeUndefined();
  });

  it('derives membership from items[]', () => {
    const list = [makeSeries('a', ['s1', 's2']), makeSeries('b', ['s3'])];
    expect(getSeriesForRef('s2', list)?.id).toBe('a');
    expect(getSeriesForRef('s3', list)?.id).toBe('b');
    expect(getSeriesForRef('missing', list)).toBeUndefined();
  });

  it('derives membership from the legacy sermonIds mirror', () => {
    const list = [makeSeries('a', [], { sermonIds: ['legacy-1'] })];
    expect(getSeriesForRef('legacy-1', list)?.id).toBe('a');
  });

  it('ignores the deprecated back-ref entirely (derive is items-driven)', () => {
    // A ref whose back-ref points at "ghost" but whose items live under "a"
    // must resolve to "a" — the derive never consults sermon.seriesId.
    const list = [makeSeries('a', ['s1'])];
    expect(getSeriesForRef('s1', list)?.id).toBe('a');
  });

  it('resolves multi-membership deterministically (lowest id wins)', () => {
    // DESYNC case: a stray double-membership must resolve to a STABLE series
    // regardless of list order, so the UI never flaps.
    const list = [makeSeries('zeta', ['s1']), makeSeries('alpha', ['s1'])];
    expect(getSeriesForRef('s1', list)?.id).toBe('alpha');
    expect(getSeriesForRef('s1', [...list].reverse())?.id).toBe('alpha');
  });
});

describe('buildInSeriesRefIds', () => {
  it('collects every ref that is a member of any series', () => {
    const list = [makeSeries('a', ['s1', 's2']), makeSeries('b', ['s3'], { sermonIds: ['legacy-1'] })];
    const set = buildInSeriesRefIds(list);
    expect(set.has('s1')).toBe(true);
    expect(set.has('s2')).toBe(true);
    expect(set.has('s3')).toBe(true);
    expect(set.has('legacy-1')).toBe(true);
    expect(set.has('standalone')).toBe(false);
  });

  it('handles empty / nullish input', () => {
    expect(buildInSeriesRefIds([]).size).toBe(0);
    expect(buildInSeriesRefIds(null).size).toBe(0);
    expect(buildInSeriesRefIds(undefined).size).toBe(0);
  });
});
