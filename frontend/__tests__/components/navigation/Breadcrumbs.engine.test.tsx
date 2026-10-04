import { render, screen } from '@testing-library/react';
import { usePathname, useSearchParams } from 'next/navigation';

import { useEngineSermonSource } from '@/(pages)/(private)/sermons/[id]/hooks/useEngineSermonSource';
import { useSermonCoreDataDocument } from '@/(pages)/(private)/sermons/[id]/hooks/useSermonCoreDataDocument';
import { useEngineStructureWriter } from '@/(pages)/(private)/sermons/[id]/structure/useEngineStructureWriter';
import Breadcrumbs from '@/components/navigation/Breadcrumbs';
import { ShellTitlesProvider, usePublishShellTitle } from '@/components/navigation/shellTitles';
import { useDataDocument } from '@/data-engine/react.client';

// BUG-20261004-breadcrumb-keeps-old-sermon-title: on the data engine the page renders and writes the
// engine copy, while the breadcrumbs read the legacy cache — a renamed sermon or series kept its old
// title in the trail until a reload. The page now publishes the title it shows; the trail follows it.
jest.mock('next/navigation', () => ({ usePathname: jest.fn(), useSearchParams: jest.fn() }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataDocument: jest.fn(),
  useDataEngine: () => ({ owner: 'owner-1' }),
  useDataForm: () => ({ active: false, busy: false, data: null, begin: jest.fn(), cancel: jest.fn(), update: jest.fn(), save: jest.fn() }),
}));
jest.mock('@/hooks/useSermon', () => jest.fn(() => ({ sermon: { id: 'sermon-1', title: 'Old sermon title' }, loading: false })));
jest.mock('@/hooks/useSeriesDetail', () => ({
  useSeriesDetail: jest.fn(() => ({ series: { id: 'series-1', title: 'Old series title' }, loading: false })),
}));
jest.mock('@/hooks/useGroupDetail', () => ({ useGroupDetail: () => ({ group: null }) }));
jest.mock('@/hooks/useServiceOrders', () => ({ useServiceOrders: () => ({ orders: [] }) }));
jest.mock('@/hooks/useCouncils', () => ({ useCouncils: () => ({ councils: [] }) }));
jest.mock('@/hooks/usePrayerDetail', () => ({ usePrayerDetail: () => ({ prayer: null }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }),
}));

const engineDocument = (title: string) => ({
  data: { title }, loading: false, error: null, readOnly: false, status: 'synced', retry: jest.fn(async () => undefined),
});

function Page({ collection, id, title }: { collection: string; id: string; title?: string }) {
  usePublishShellTitle(collection, id, { title });
  return null;
}

beforeEach(() => {
  jest.clearAllMocks();
  (useSearchParams as jest.Mock).mockReturnValue({ get: () => null });
});

it('follows the title the open page shows, through a rename, and falls back when the page leaves', () => {
  (usePathname as jest.Mock).mockReturnValue('/sermons/sermon-1');
  const { rerender } = render(<ShellTitlesProvider><Breadcrumbs /><Page collection="sermons" id="sermon-1" title="New sermon title" /></ShellTitlesProvider>);
  expect(screen.getByText('New sermon title')).toBeInTheDocument();
  expect(screen.queryByText('Old sermon title')).not.toBeInTheDocument();

  rerender(<ShellTitlesProvider><Breadcrumbs /><Page collection="sermons" id="sermon-1" title="Renamed sermon" /></ShellTitlesProvider>);
  expect(screen.getByText('Renamed sermon')).toBeInTheDocument();

  rerender(<ShellTitlesProvider><Breadcrumbs /></ShellTitlesProvider>);
  expect(screen.getByText('Old sermon title')).toBeInTheDocument();
});

it('keeps the title while another holder of the same sermon is still mounted', () => {
  (usePathname as jest.Mock).mockReturnValue('/sermons/sermon-1');
  const { rerender } = render(<ShellTitlesProvider><Breadcrumbs />
    <Page collection="sermons" id="sermon-1" title="New sermon title" /><Page collection="sermons" id="sermon-1" title="New sermon title" />
  </ShellTitlesProvider>);
  rerender(<ShellTitlesProvider><Breadcrumbs /><Page collection="sermons" id="sermon-1" title="New sermon title" /></ShellTitlesProvider>);
  expect(screen.getByText('New sermon title')).toBeInTheDocument();
  expect(screen.queryByText('Old sermon title')).not.toBeInTheDocument();
});

it('shows no stale cached name for a loaded sermon that has no title', () => {
  (usePathname as jest.Mock).mockReturnValue('/sermons/sermon-1');
  render(<ShellTitlesProvider><Breadcrumbs /><Page collection="sermons" id="sermon-1" title="   " /></ShellTitlesProvider>);
  expect(screen.queryByText('Old sermon title')).not.toBeInTheDocument();
});

it('ignores a title published for another sermon', () => {
  (usePathname as jest.Mock).mockReturnValue('/sermons/sermon-1');
  render(<ShellTitlesProvider><Breadcrumbs /><Page collection="sermons" id="sermon-2" title="Another sermon" /></ShellTitlesProvider>);
  expect(screen.getByText('Old sermon title')).toBeInTheDocument();
  expect(screen.queryByText('Another sermon')).not.toBeInTheDocument();
});

it('names the series by the title its page shows', () => {
  (usePathname as jest.Mock).mockReturnValue('/series/series-1');
  render(<ShellTitlesProvider><Breadcrumbs /><Page collection="series" id="series-1" title="New series title" /></ShellTitlesProvider>);
  expect(screen.getByText('New series title')).toBeInTheDocument();
  expect(screen.queryByText('Old series title')).not.toBeInTheDocument();
});

// The engine hooks that hold the sermon document on the plan and structure screens publish its title.
it.each([
  ['plan', '/sermons/sermon-1/plan', (): null => { useEngineSermonSource('sermon-1'); return null; }],
  ['structure', '/sermons/sermon-1/structure', (): null => { useEngineStructureWriter('sermon-1', 'owner-1'); return null; }],
  ['sermon', '/sermons/sermon-1', (): null => { useSermonCoreDataDocument('sermon-1'); return null; }],
] as const)('the %s screen puts the engine document title into the trail', (_screen, path, Holder) => {
  (usePathname as jest.Mock).mockReturnValue(path);
  (useDataDocument as jest.Mock).mockReturnValue(engineDocument('Engine sermon title'));
  render(<ShellTitlesProvider><Breadcrumbs /><Holder /></ShellTitlesProvider>);
  expect(screen.getByText('Engine sermon title')).toBeInTheDocument();
  expect(screen.queryByText('Old sermon title')).not.toBeInTheDocument();
});
