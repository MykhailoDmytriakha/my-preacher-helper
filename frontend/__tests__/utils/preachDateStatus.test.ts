import {
  countPreachDatesByStatus,
  getEffectiveIsPreached,
  getEffectivePreachDateStatus,
  getLatestPreachedDate,
  getNextPlannedDate,
  getPreferredDateToMarkAsPreached,
  isPreachDatePlanned,
  isPreachDatePreached,
} from '@/utils/preachDateStatus';

import type { Sermon } from '@/models/models';

const buildSermon = (overrides: Partial<Sermon> = {}): Sermon => ({
  id: 'sermon-1',
  title: 'Test sermon',
  verse: 'John 3:16',
  date: '2026-02-01',
  thoughts: [],
  userId: 'user-1',
  ...overrides,
});

describe('preachDateStatus utils', () => {
  it('respects explicit date status first', () => {
    expect(
      getEffectivePreachDateStatus(
        {
          id: 'pd-1',
          date: '2026-02-12',
          status: 'planned',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        true
      )
    ).toBe('planned');
  });

  it('falls back to sermon preached flag for legacy records without status', () => {
    expect(
      getEffectivePreachDateStatus(
        {
          id: 'pd-1',
          date: '2026-02-12',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        true
      )
    ).toBe('preached');
  });

  it('treats status-less future dates as planned when sermon is not preached', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const y = tomorrow.getFullYear();
    const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const d = String(tomorrow.getDate()).padStart(2, '0');

    expect(
      getEffectivePreachDateStatus(
        {
          id: 'pd-future',
          date: `${y}-${m}-${d}`,
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        false
      )
    ).toBe('planned');
  });

  it('derives effective preached state from date statuses', () => {
    const sermon = buildSermon({
      isPreached: false,
      preachDates: [
        {
          id: 'pd-1',
          date: '2026-02-12',
          status: 'planned',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pd-2',
          date: '2026-02-14',
          status: 'preached',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-02T00:00:00Z',
        },
      ],
    });

    expect(getEffectiveIsPreached(sermon)).toBe(true);
    expect(countPreachDatesByStatus(sermon, 'planned')).toBe(1);
    expect(countPreachDatesByStatus(sermon, 'preached')).toBe(1);
  });

  it('returns latest preached date and upcoming planned date', () => {
    const sermon = buildSermon({
      isPreached: false,
      preachDates: [
        {
          id: 'pd-old-preached',
          date: '2026-02-05',
          status: 'preached',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pd-new-preached',
          date: '2026-02-20',
          status: 'preached',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-02T00:00:00Z',
        },
        {
          id: 'pd-planned',
          date: '2026-03-03',
          status: 'planned',
          church: { id: 'c-2', name: 'Other Church' },
          createdAt: '2026-02-03T00:00:00Z',
        },
      ],
    });

    expect(getLatestPreachedDate(sermon)?.id).toBe('pd-new-preached');
    expect(getNextPlannedDate(sermon, new Date('2026-02-10T00:00:00Z'))?.id).toBe('pd-planned');
  });

  it('prefers planned date when marking preached and falls back to latest preached', () => {
    const sermonWithPlan = buildSermon({
      preachDates: [
        {
          id: 'pd-planned',
          date: '2026-02-25',
          status: 'planned',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pd-preached',
          date: '2026-02-10',
          status: 'preached',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-02T00:00:00Z',
        },
      ],
    });

    const sermonWithoutPlan = buildSermon({
      preachDates: [
        {
          id: 'pd-preached',
          date: '2026-02-10',
          status: 'preached',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-02T00:00:00Z',
        },
      ],
    });

    expect(getPreferredDateToMarkAsPreached(sermonWithPlan)?.id).toBe('pd-planned');
    expect(getPreferredDateToMarkAsPreached(sermonWithoutPlan)?.id).toBe('pd-preached');
  });

  it('handles invalid dates gracefully in toTimestamp', () => {
    const sermon = buildSermon({
      preachDates: [
        {
          id: 'pd-invalid',
          date: 'invalid-date' as any,
          status: 'planned',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        {
          id: 'pd-nan',
          date: '0000-00-00', // matches YYYY-MM-DD but parses to NaN
          status: 'planned',
          church: { id: 'c-2', name: 'Church 2' },
          createdAt: '2026-02-01T00:00:00Z',
        }
      ],
    });
    // Should filter out the invalid date
    expect(getNextPlannedDate(sermon)).toBeNull();
  });

  it('treats status-less past/invalid dates as preached', () => {
    expect(
      getEffectivePreachDateStatus(
        {
          id: 'pd-past',
          date: '2000-01-01',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        },
        false
      )
    ).toBe('preached');
  });

  it('tests isPreachDatePlanned and isPreachDatePreached specifically', () => {
    const plannedDate = {
      id: 'pd',
      date: '2050-01-01',
      status: 'planned' as const,
      church: { id: 'c-1', name: 'Church' },
      createdAt: '2026-02-01T00:00:00Z',
    };
    expect(isPreachDatePlanned(plannedDate)).toBe(true);
    expect(isPreachDatePreached(plannedDate)).toBe(false);
  });

  it('getEffectiveIsPreached returns sermon.isPreached for empty preachDates', () => {
    const unreachedSermon = buildSermon({ isPreached: false, preachDates: [] });
    const preachedSermon = buildSermon({ isPreached: true, preachDates: [] });
    expect(getEffectiveIsPreached(unreachedSermon)).toBe(false);
    expect(getEffectiveIsPreached(preachedSermon)).toBe(true);
  });

  it('handles undefined preachDates array gracefully', () => {
    // Create explicitly without preachDates array
    const sermon = { id: 'sermon-1', title: 'Test', isPreached: true } as unknown as Sermon;

    expect(countPreachDatesByStatus(sermon, 'planned')).toBe(0);
    expect(getEffectiveIsPreached(sermon)).toBe(true);
  });

  it('getLatestPreachedDate returns null if no preached dates exist', () => {
    const sermon = buildSermon({
      preachDates: [
        {
          id: 'pd-planned',
          date: '2050-01-01',
          status: 'planned',
          church: { id: 'c-1', name: 'Church' },
          createdAt: '2026-02-01T00:00:00Z',
        }
      ],
    });
    expect(getLatestPreachedDate(sermon)).toBeNull();
  });
});
