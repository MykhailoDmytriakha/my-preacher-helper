import {
  clampPrayerSortKey,
  filterPrayerRequests,
  getDefaultPrayerSortKey,
  getPrayerSortOptions,
  getPrayerUpdateSearchSnippet,
  matchesPrayerQuery,
  normalizePrayerFilterStatus,
  normalizePrayerSortKey,
  resolvePrayerSortKey,
} from '@/utils/prayerFilters';
import { PrayerRequest } from '@/models/models';

const prayerRequests: PrayerRequest[] = [
  {
    id: 'active-1',
    userId: 'user-1',
    title: 'Pray for church',
    description: 'Sunday service and unity',
    tags: ['church'],
    status: 'active',
    updates: [{ id: 'u-1', text: 'Met with the worship team', createdAt: '2026-03-17T10:00:00.000Z' }],
    createdAt: '2026-03-10T09:00:00.000Z',
    updatedAt: '2026-03-17T10:00:00.000Z',
  },
  {
    id: 'answered-1',
    userId: 'user-1',
    title: 'Pray for job',
    description: 'Interview this week',
    tags: ['work'],
    status: 'answered',
    updates: [{ id: 'u-2', text: 'Interview completed', createdAt: '2026-03-16T08:00:00.000Z' }],
    createdAt: '2026-03-12T09:00:00.000Z',
    updatedAt: '2026-03-18T12:00:00.000Z',
    answeredAt: '2026-03-18T12:00:00.000Z',
    answerText: 'Received the offer',
  },
  {
    id: 'answered-2',
    userId: 'user-1',
    title: 'Pray for health',
    description: 'Doctor visit',
    tags: ['recovery'],
    status: 'answered',
    updates: [{ id: 'u-3', text: 'The doctor report was clear', createdAt: '2026-03-15T09:00:00.000Z' }],
    createdAt: '2026-03-11T09:00:00.000Z',
    updatedAt: '2026-03-15T09:00:00.000Z',
    answeredAt: '2026-03-15T09:00:00.000Z',
    answerText: 'Healing confirmed',
  },
];

describe('prayerFilters', () => {
  it('normalizes invalid filter and sort values', () => {
    expect(normalizePrayerFilterStatus('unexpected')).toBe('active');
    expect(normalizePrayerFilterStatus(null)).toBe('active');
    expect(normalizePrayerSortKey('unexpected')).toBe('updatedAt');
    expect(normalizePrayerSortKey(null)).toBe('updatedAt');
  });

  it('returns context-aware sort options and defaults', () => {
    expect(getPrayerSortOptions('active')).toEqual(['updatedAt', 'createdAt']);
    expect(getPrayerSortOptions('answered')).toEqual(['answeredAt', 'updatedAt', 'createdAt']);
    expect(getDefaultPrayerSortKey('answered')).toBe('answeredAt');
    expect(clampPrayerSortKey('active', 'answeredAt')).toBe('updatedAt');
    expect(clampPrayerSortKey('not_answered', 'answeredAt')).toBe('updatedAt');
  });

  it('resolves transitional default sorts without exposing the stale intermediate value', () => {
    expect(resolvePrayerSortKey('answered', 'updatedAt', 'active')).toBe('answeredAt');
    expect(resolvePrayerSortKey('active', 'answeredAt', 'answered')).toBe('updatedAt');
    expect(resolvePrayerSortKey('answered', 'createdAt', 'active')).toBe('createdAt');
    expect(resolvePrayerSortKey('not_answered', 'answeredAt', 'answered')).toBe('updatedAt');
  });

  it('matches title and description even without optional search scopes', () => {
    expect(
      matchesPrayerQuery(prayerRequests[0], 'Sunday unity', {
        searchInUpdates: false,
        searchInTags: false,
        searchInAnswerText: false,
      })
    ).toBe(true);
  });

  it('respects optional search scopes for updates, tags, and answers', () => {
    expect(
      matchesPrayerQuery(prayerRequests[0], 'worship team', {
        searchInUpdates: false,
        searchInTags: false,
        searchInAnswerText: false,
      })
    ).toBe(false);
    expect(
      matchesPrayerQuery(prayerRequests[0], 'worship team', {
        searchInUpdates: true,
        searchInTags: false,
        searchInAnswerText: false,
      })
    ).toBe(true);

    expect(
      matchesPrayerQuery(prayerRequests[2], 'recovery', {
        searchInUpdates: false,
        searchInTags: false,
        searchInAnswerText: false,
      })
    ).toBe(false);
    expect(
      matchesPrayerQuery(prayerRequests[2], 'recovery', {
        searchInUpdates: false,
        searchInTags: true,
        searchInAnswerText: false,
      })
    ).toBe(true);

    expect(
      matchesPrayerQuery(prayerRequests[1], 'offer', {
        searchInUpdates: false,
        searchInTags: false,
        searchInAnswerText: false,
      })
    ).toBe(false);
    expect(
      matchesPrayerQuery(prayerRequests[1], 'offer', {
        searchInUpdates: false,
        searchInTags: false,
        searchInAnswerText: true,
      })
    ).toBe(true);
  });

  it('filters by status and sorts answered prayers by answered date by default', () => {
    const result = filterPrayerRequests(prayerRequests, {
      filterStatus: 'answered',
      searchQuery: '',
      sortKey: 'answeredAt',
      searchInUpdates: true,
      searchInTags: true,
      searchInAnswerText: true,
    });

    expect(result.map((prayer) => prayer.id)).toEqual(['answered-1', 'answered-2']);
  });

  it('filters active prayers and ignores invalid answered sort for that filter', () => {
    const result = filterPrayerRequests(prayerRequests, {
      filterStatus: 'active',
      searchQuery: '',
      sortKey: 'answeredAt',
      searchInUpdates: true,
      searchInTags: true,
      searchInAnswerText: true,
    });

    expect(result.map((prayer) => prayer.id)).toEqual(['active-1']);
  });

  it('uses updatedAt as a tiebreaker when the primary sort value matches', () => {
    const tiedPrayers: PrayerRequest[] = [
      {
        ...prayerRequests[1],
        id: 'answered-a',
        answeredAt: '2026-03-20T09:00:00.000Z',
        updatedAt: '2026-03-20T10:00:00.000Z',
      },
      {
        ...prayerRequests[2],
        id: 'answered-b',
        answeredAt: '2026-03-20T09:00:00.000Z',
        updatedAt: '2026-03-20T08:00:00.000Z',
      },
    ];

    const result = filterPrayerRequests(tiedPrayers, {
      filterStatus: 'answered',
      searchQuery: '',
      sortKey: 'answeredAt',
      searchInUpdates: false,
      searchInTags: false,
      searchInAnswerText: false,
    });

    expect(result.map((prayer) => prayer.id)).toEqual(['answered-a', 'answered-b']);
  });

  it('returns a contextual snippet for the most recent matching prayer update', () => {
    const snippet = getPrayerUpdateSearchSnippet(
      {
        ...prayerRequests[0],
        updates: [
          { id: 'u-1', text: 'Older family request update', createdAt: '2026-03-15T10:00:00.000Z' },
          { id: 'u-2', text: 'Latest but unrelated note', createdAt: '2026-03-18T10:00:00.000Z' },
          { id: 'u-3', text: 'Family breakthrough came after prayer', createdAt: '2026-03-19T10:00:00.000Z' },
        ],
      },
      'family breakthrough'
    );

    expect(snippet).toContain('Family breakthrough came after prayer');
  });
});
