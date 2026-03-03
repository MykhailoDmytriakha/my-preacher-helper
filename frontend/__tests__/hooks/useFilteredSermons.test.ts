import { renderHook } from '@testing-library/react';

import { useFilteredSermons } from '@/hooks/useFilteredSermons';
import type { Sermon } from '@/models/models';

const mockT = (key: string) => key;

const base = (overrides: Partial<Sermon> = {}): Sermon => ({
  id: 'x',
  title: 'Sermon',
  verse: 'John 1:1',
  date: '2024-01-01',
  thoughts: [],
  userId: 'u1',
  ...overrides,
});

const defaultOptions = {
  searchQuery: '',
  searchInThoughts: true,
  searchInTags: true,
  sortOption: 'newest' as const,
  seriesFilter: 'all' as const,
  activeTab: 'all' as const,
};

describe('useFilteredSermons — recentlyUpdated sort', () => {
  it('sorts by updatedAt descending when all sermons have updatedAt', () => {
    const sermons: Sermon[] = [
      base({ id: 'old',    date: '2024-01-01', updatedAt: '2024-01-01T00:00:00Z' }),
      base({ id: 'newest', date: '2024-01-01', updatedAt: '2024-03-01T00:00:00Z' }),
      base({ id: 'mid',    date: '2024-01-01', updatedAt: '2024-02-01T00:00:00Z' }),
    ];

    const { result } = renderHook(() =>
      useFilteredSermons(sermons, { ...defaultOptions, sortOption: 'recentlyUpdated' }, mockT as any)
    );

    const ids = result.current.processedSermons.map((s) => s.id);
    expect(ids).toEqual(['newest', 'mid', 'old']);
  });

  it('falls back to date when updatedAt is absent', () => {
    const sermons: Sermon[] = [
      base({ id: 'date-old', date: '2024-01-01' }),
      base({ id: 'date-new', date: '2024-03-01' }),
    ];

    const { result } = renderHook(() =>
      useFilteredSermons(sermons, { ...defaultOptions, sortOption: 'recentlyUpdated' }, mockT as any)
    );

    const ids = result.current.processedSermons.map((s) => s.id);
    expect(ids).toEqual(['date-new', 'date-old']);
  });

  it('mixes updatedAt and fallback date correctly', () => {
    const sermons: Sermon[] = [
      base({ id: 'no-update',  date: '2024-02-15' }),                                    // fallback: 2024-02-15
      base({ id: 'has-update', date: '2024-01-01', updatedAt: '2024-03-10T00:00:00Z' }), // updatedAt: 2024-03-10
      base({ id: 'old-update', date: '2024-01-01', updatedAt: '2024-01-05T00:00:00Z' }), // updatedAt: 2024-01-05
    ];

    const { result } = renderHook(() =>
      useFilteredSermons(sermons, { ...defaultOptions, sortOption: 'recentlyUpdated' }, mockT as any)
    );

    const ids = result.current.processedSermons.map((s) => s.id);
    // has-update (2024-03-10) > no-update fallback (2024-02-15) > old-update (2024-01-05)
    expect(ids).toEqual(['has-update', 'no-update', 'old-update']);
  });
});
