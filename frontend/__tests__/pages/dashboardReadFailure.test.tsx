import { render, screen, within } from '@testing-library/react';
import DashboardPage from '@/(pages)/(private)/dashboard/page';
import '@testing-library/jest-dom';

let mockReads: Record<string, any>;
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: () => mockReads.sermons }));
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => mockReads.series }));
jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: () => mockReads.notes }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => mockReads.groups }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => mockReads.councils }));
jest.mock('@/hooks/usePrayerRequests', () => ({ usePrayerRequests: () => mockReads.prayers }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock('@/components/AddSermonModal', () => () => null);
jest.mock('@/components/prayer/CreatePrayerModal', () => () => null);
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key, i18n: { language: 'en' } }) }));
jest.mock('@locales/i18n', () => ({ i18n: { t: (key: string, fallback?: string) => fallback ?? key, language: 'en' } }));

beforeEach(() => {
  const ready = { loading: false, error: null };
  mockReads = {
    sermons: { ...ready, sermons: [], refresh: jest.fn() },
    series: { ...ready, series: [] },
    notes: { ...ready, notes: [] },
    groups: { ...ready, groups: [] },
    councils: { ...ready, councils: [] },
    prayers: { ...ready, prayerRequests: [], createPrayer: jest.fn() },
  };
});

it('keeps healthy empty summaries and ordinary navigation', () => {
  render(<DashboardPage />);
  expect(within(screen.getByRole('region', { name: 'dashboardHome.metrics.label' })).getAllByText('0')).toHaveLength(6);
  expect(screen.getByText('dashboardHome.sections.sermons.empty')).toBeInTheDocument();
});

it('does not turn six failed reads into six zero metrics and empty panels', () => {
  Object.values(mockReads).forEach(read => { read.error = new Error('Store unavailable'); });
  render(<DashboardPage />);
  expect(within(screen.getByRole('region', { name: 'dashboardHome.metrics.label' })).queryAllByText('0')).toHaveLength(0);
  for (const section of ['sermons', 'studies', 'week', 'series', 'groups', 'prayer']) {
    expect(screen.queryByText(`dashboardHome.sections.${section}.empty`)).not.toBeInTheDocument();
  }
  expect(screen.getAllByText('dataSync.backgroundFailure').length).toBeGreaterThan(0);
});

it('retains a known note while withholding only its failed aggregate', () => {
  mockReads.notes = { loading: false, error: new Error('Store unavailable'), notes: [{ id: 'n', userId: 'owner', title: 'Known note', content: 'Known words', tags: [], scriptureRefs: [], isDraft: true, createdAt: '2026-10-01', updatedAt: '2026-10-01' }] };
  render(<DashboardPage />);
  expect(screen.getByText('Known note')).toBeInTheDocument();
  const metric = screen.getByText('dashboardHome.metrics.studyNotes.label').closest('a')!;
  expect(within(metric).queryByText('1')).not.toBeInTheDocument();
  const healthy = screen.getByText('dashboardHome.metrics.activeGroups.label').closest('a')!;
  expect(within(healthy).getByText('0')).toBeInTheDocument();
});

it('requires all agenda sources before certifying its aggregate', () => {
  const date = new Date().toISOString().slice(0, 10);
  mockReads.groups.error = new Error('Store unavailable');
  mockReads.sermons.sermons = [{ id: 's', userId: 'owner', title: 'Known sermon', verse: 'John 1', date, thoughts: [], isPreached: false, preachDates: [{ id: 'pd', date, status: 'planned', createdAt: date }] }];
  render(<DashboardPage />);
  const metric = screen.getByText('dashboardHome.metrics.upcomingDates.label').closest('a')!;
  expect(within(metric).getByText('—')).toBeInTheDocument();
  expect(screen.getAllByText('Known sermon').length).toBeGreaterThan(0);
});

it('does not describe still-loading sources as empty', () => {
  Object.values(mockReads).forEach(read => { read.loading = true; });
  render(<DashboardPage />);
  expect(screen.queryByText('dashboardHome.sections.sermons.empty')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'dashboardHome.metrics.label' })).queryAllByText('0')).toHaveLength(0);
});


it('keeps a series title without claiming completion or no next sermon from a failed sermon source', () => {
  mockReads.sermons.error = new Error('Store unavailable');
  mockReads.series.series = [{ id: 'series', title: 'Known series', theme: 'Known series', bookOrTopic: 'John', status: 'active', items: [{ id: 'member', type: 'sermon', refId: 's', position: 1 }], sermonIds: ['s'], createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
  render(<DashboardPage />);
  expect(screen.getByText('Known series')).toBeInTheDocument();
  expect(screen.queryByText('dashboardHome.sections.series.progress')).not.toBeInTheDocument();
  expect(screen.queryByText('dashboardHome.sections.series.noNext')).not.toBeInTheDocument();
});


it('does not blame an empty healthy series list for an unrelated sermon failure', () => {
  mockReads.sermons.error = new Error('Store unavailable');
  render(<DashboardPage />);
  const panel = within(screen.getByRole('region', { name: 'dashboardHome.sections.series.title' }));
  expect(panel.getByText('dashboardHome.sections.series.empty')).toBeInTheDocument();
  expect(panel.queryByText('dataSync.backgroundFailure')).not.toBeInTheDocument();
});

it('can describe a series with no sermon members from its own metadata', () => {
  mockReads.sermons.error = new Error('Store unavailable');
  mockReads.series.series = [{ id: 'empty-series', title: 'Prepared empty series', theme: 'Prepared empty series', bookOrTopic: 'John', status: 'draft', items: [], sermonIds: [], createdAt: '2026-10-01', updatedAt: '2026-10-01' }];
  render(<DashboardPage />);
  expect(screen.getByText('Prepared empty series')).toBeInTheDocument();
  expect(screen.getByText('dashboardHome.sections.series.noItems')).toBeInTheDocument();
});
