import { render, within } from '@testing-library/react';
import React from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import '@testing-library/jest-dom';

/**
 * "Эта неделя" answers what stands on the days ahead, and a partial answer is worse than none
 * because the pastor believes it. The panel used to walk sermons and groups itself instead of
 * reading the one translation of the sources the Calendar reads, so the brothers' council —
 * on the Calendar for months — never appeared here at all.
 *
 * These render the real page: the defect was that a KIND was missing from the panel, and only
 * what reaches the screen can show whether it is there now.
 */

const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
};

const sermon = {
  id: 'sermon-1',
  title: 'О терпении',
  verse: 'Иак 1:4',
  date: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  userId: 'user-1',
  thoughts: [],
  isPreached: false,
  preachDates: [{ id: 'pd-1', date: inDays(2), status: 'planned', church: { id: 'c', name: 'Вифания', city: '' }, createdAt: '' }],
};

const group = {
  id: 'group-1',
  title: 'Молодёжь',
  userId: 'user-1',
  status: 'active',
  meetingDates: [{ id: 'md-1', date: inDays(3), location: 'Зал', createdAt: '' }],
};

const council = {
  id: 'council-1',
  userId: 'user-1',
  title: 'Братский совет о крыше',
  date: inDays(4),
  status: 'preparing',
  topics: [{ id: 't1', title: 'Крыша', questions: [], options: [] }],
  createdAt: '',
  updatedAt: '',
};

let mockCouncils: unknown[] = [council];

jest.mock('@/hooks/useDashboardSermons', () => ({
  useDashboardSermons: () => ({ sermons: [sermon], loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useDashboardOptimisticSermons', () => ({
  useDashboardOptimisticSermons: () => ({
    actions: { createSermon: jest.fn(), updateSermon: jest.fn(), deleteSermon: jest.fn() },
    syncStatesById: {},
  }),
}));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [] }) }));
jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: () => ({ notes: [] }) }));
jest.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ groups: [group] }) }));
jest.mock('@/hooks/useCouncils', () => ({ useCouncils: () => ({ councils: mockCouncils }) }));
jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => ({ prayerRequests: [], createPrayer: jest.fn() }),
}));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/components/AddSermonModal', () => () => null);
jest.mock('@/components/prayer/CreatePrayerModal', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
    i18n: { language: 'en' },
  }),
}));
jest.mock('@locales/i18n', () => ({
  i18n: { t: (key: string, fallback?: string) => fallback ?? key, language: 'en' },
}));

describe('the week panel shows everything that stands on those days', () => {
  // Scoped to the panel on purpose: a sermon also appears in the sermons panel, so an
  // unscoped query would pass while the week panel stayed empty.
  const weekPanel = () => within(document.querySelector('section[aria-labelledby="agenda-title"]') as HTMLElement);

  beforeEach(() => {
    mockCouncils = [council];
  });

  it('carries a council beside the sermon and the group', () => {
    render(<DashboardPage />);

    expect(weekPanel().getByText('Братский совет о крыше')).toBeInTheDocument();
    expect(weekPanel().getByText('О терпении')).toBeInTheDocument();
    expect(weekPanel().getByText('Молодёжь')).toBeInTheDocument();
  });

  it('links the council row to the council itself', () => {
    render(<DashboardPage />);

    expect(weekPanel().getByText('Братский совет о крыше').closest('a')).toHaveAttribute(
      'href',
      '/care/council/council-1',
    );
  });

  it('leaves out a council that has no day yet — the week has nowhere to put it', () => {
    mockCouncils = [{ ...council, date: undefined }];

    render(<DashboardPage />);

    expect(weekPanel().queryByText('Братский совет о крыше')).not.toBeInTheDocument();
    // The other kinds are untouched by a council without a date.
    expect(weekPanel().getByText('О терпении')).toBeInTheDocument();
  });
});
