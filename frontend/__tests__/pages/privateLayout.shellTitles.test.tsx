import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import PrivateLayout from '../../app/(pages)/(private)/layout';
import { usePublishShellTitle, useShellTitle } from '@/components/navigation/shellTitles';

// BUG-20261004-breadcrumb-keeps-old-sermon-title: the breadcrumbs and the page live in this layout, and
// the page's title reaches the trail only if the layout puts both inside one title channel.
jest.mock('next/navigation', () => ({
  usePathname: () => '/sermons/sermon-1',
  useSearchParams: () => new URLSearchParams(''),
}));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  DataEngineWorkspace: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@/components/series/SeriesMembershipRecovery', () => ({ SeriesMembershipRecovery: () => null }));
jest.mock('@/components/ProtectedRoute', () => ({ children }: { children: ReactNode }) => children);
jest.mock('@/components/navigation/DashboardNav', () => () => <nav>Navigation</nav>);
jest.mock('@/components/navigation/Breadcrumbs', () => {
  const Trail = () => <div data-testid="trail">{useShellTitle('sermons', 'sermon-1') ?? 'no title'}</div>;
  return Trail;
});
jest.mock('@/components/navigation/DevQuickNav', () => () => null);
jest.mock('@/components/navigation/PageGestures', () => ({ children }: { children: ReactNode }) => <div>{children}</div>);
jest.mock('@/components/GuestBanner', () => ({ GuestBanner: () => null }));
jest.mock('@/components/OutboxConflictBanner', () => ({ OutboxConflictBanner: () => null }));
jest.mock('@/components/OutboxDrain', () => ({ OutboxDrain: () => null }));

function SermonPage() {
  usePublishShellTitle('sermons', 'sermon-1', { title: 'Renamed sermon' });
  return <p>Sermon page</p>;
}

it('lets the page tell the breadcrumbs the title it shows', async () => {
  render(<PrivateLayout><SermonPage /></PrivateLayout>);
  expect(await screen.findByText('Renamed sermon')).toBeInTheDocument();
});
