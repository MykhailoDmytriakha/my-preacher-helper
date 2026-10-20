import { render, screen } from '@testing-library/react';
import { useParams } from 'next/navigation';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import OfflineShell from '@/~offline/page';

import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { TestProviders } from '../../test-utils/test-providers';

let mockAuth: { user: { uid: string } | null; loading: boolean } = { user: { uid: 'owner' }, loading: false };
jest.mock('@/providers/AuthProvider', () => ({
  ...jest.requireActual('@/providers/AuthProvider'),
  useAuth: () => mockAuth,
}));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
// The page body is a probe: the dashboard's own list hook and nothing else.
jest.mock('@/(pages)/(private)/dashboard/page', () => {
  const { useSermonsDataCollection } = jest.requireActual('@/hooks/useSermonsDataCollection');
  return function DashboardProbe() {
    const { sermons } = useSermonsDataCollection();
    return (
      <ul aria-label="sermons">
        {sermons.map((sermon: { id: string; title: string }) => <li key={sermon.id}>{sermon.title}</li>)}
      </ul>
    );
  };
});

beforeEach(() => { jest.mocked(useParams).mockReturnValue({}); });
jest.mock('@/(pages)/(private)/care/page', () => () => <p>Care overview probe</p>);
jest.mock('@/(pages)/(private)/care/council/page', () => () => <p>Councils list probe</p>);
jest.mock('@/(pages)/(private)/care/orders/page', () => () => <p>Orders list probe</p>);
const mockDetail = (label: string, segmentIndex = 2) => () => {
  const { useRouteId } = jest.requireActual('@/hooks/useRouteId');
  return <p>{label}:{useRouteId(segmentIndex)}</p>;
};
jest.mock('@/(pages)/(private)/care/council/[id]/page', () => mockDetail('Council detail probe'));
jest.mock('@/(pages)/(private)/care/council/[id]/conduct/page', () => mockDetail('Council conduct probe'));
jest.mock('@/(pages)/(private)/care/orders/[id]/page', () => mockDetail('Order detail probe'));

jest.mock('@/(pages)/(private)/settings/layout', () => ({ children }: { children: import('react').ReactNode }) => <section aria-label="Settings frame probe">{children}</section>);
jest.mock('@/(pages)/(private)/settings/page', () => () => <p>Settings redirect probe</p>);
jest.mock('@/(pages)/(private)/settings/user/page', () => () => <p>User settings probe</p>);
jest.mock('@/(pages)/(private)/settings/limits/page', () => () => <p>Limits settings probe</p>);
jest.mock('@/(pages)/(private)/settings/tags/page', () => () => <p>Tag settings probe</p>);
jest.mock('@/(pages)/(private)/settings/templates/page', () => () => <p>Template settings probe</p>);
jest.mock('@/(pages)/(private)/settings/bible/page', () => () => <p>Bible settings probe</p>);
jest.mock('@/(pages)/(private)/prayers/[id]/page', () => mockDetail('Prayer detail probe', 1));
jest.mock('@/(pages)/(private)/groups/[id]/conduct/page', () => mockDetail('Group conduct probe', 1));
jest.mock('@/(pages)/(private)/studies/share-links/page', () => () => <p>Share links probe</p>);
jest.mock('@/(pages)/(private)/studies/[id]/page', () => mockDetail('Study detail probe', 1));

describe('offline shell', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    window.history.replaceState(null, '', '/');
    mockAuth = { user: { uid: 'owner' }, loading: false };
    localStorage.clear();
  });

  it.each([
    ['/care', 'Care overview probe'], ['/care/council', 'Councils list probe'], ['/care/orders', 'Orders list probe'],
    ['/care/council/local-council', 'Council detail probe:local-council'],
    ['/care/council/local-council/conduct', 'Council conduct probe:local-council'],
    ['/care/orders/local-order', 'Order detail probe:local-order'],
  ])('opens the cached care screen at %s when the router has no params', async (path, expected) => {
    window.history.replaceState(null, '', path);
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try { expect(await screen.findByText(expected)).toBeInTheDocument(); }
    finally { view.unmount(); }
  });

  it.each([
    ['/settings', 'Settings redirect probe'], ['/settings/user', 'User settings probe'],
    ['/settings/limits', 'Limits settings probe'], ['/settings/tags', 'Tag settings probe'],
    ['/settings/templates', 'Template settings probe'],
    ['/settings/bible', 'Bible settings probe'],
    ['/prayers/local-prayer', 'Prayer detail probe:local-prayer'],
    ['/groups/local-group/conduct', 'Group conduct probe:local-group'],
    ['/studies/share-links', 'Share links probe'],
  ])('opens the supported cached screen at %s with its required frame', async (path, expected) => {
    window.history.replaceState(null, '', path);
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      const content = await screen.findByText(expected);
      if (path.startsWith('/settings')) expect(screen.getByRole('region', { name: 'Settings frame probe' })).toContainElement(content);
      expect(screen.queryByRole('button', { name: 'buttons.retry' })).not.toBeInTheDocument();
    } finally { view.unmount(); }
  });

  it('keeps ordinary study detail distinct from the reserved share-links address', async () => {
    window.history.replaceState(null, '', '/studies/local-note');
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      expect(await screen.findByText('Study detail probe:local-note')).toBeInTheDocument();
      expect(screen.queryByText('Share links probe')).not.toBeInTheDocument();
    } finally { view.unmount(); }
  });

  it.each(['/settings/templates', '/settings/bible', '/prayers/private', '/groups/private/conduct', '/studies/share-links'])(
    'does not render a private route at %s without a session', async path => {
      mockAuth = { user: null, loading: false };
      window.history.replaceState(null, '', path);
      jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
      const view = render(<TestProviders><OfflineShell /></TestProviders>);
      try {
        expect(await screen.findByRole('button', { name: 'buttons.retry' })).toBeInTheDocument();
        expect(screen.queryByText(/probe/i)).not.toBeInTheDocument();
      } finally { view.unmount(); }
    }
  );

  // BUG-20261004-weak-network-delays-offline-navigation: the worker now opens the shell at the start of the
  // app on a weak signal too, and someone signed out must not get the private dashboard instead of the login.
  it('does not open the private dashboard for someone signed out on this device', async () => {
    mockAuth = { user: null, loading: false };
    window.history.replaceState(null, '', '/');
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      expect(await screen.findByRole('button', { name: 'buttons.retry' })).toBeInTheDocument();
      expect(screen.queryByLabelText('sermons')).not.toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });

  it.each([true, false])('does not infer a private session from persisted keys while loading=%s', async loading => {
    mockAuth = { user: null, loading };
    localStorage.setItem('firebase:authUser:key:[DEFAULT]', '{}');
    localStorage.setItem('guestUser', JSON.stringify({ uid: 'previous-owner' }));
    window.history.replaceState(null, '', '/');
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      expect(await screen.findByRole('button', { name: 'buttons.retry' })).toBeInTheDocument();
      expect(screen.queryByLabelText('sermons')).not.toBeInTheDocument();
      if (loading) expect(screen.getByRole('status')).toHaveTextContent('connection.offlinePage.waiting');
      mockAuth = { user: { uid: 'owner' }, loading: false };
      view.rerender(<TestProviders><OfflineShell /></TestProviders>);
      expect(await screen.findByLabelText('sermons')).toBeInTheDocument();
    } finally { view.unmount(); }
  });

  it('gives a page it renders the records of the data engine, as the private layout does', async () => {
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
    window.history.replaceState(null, '', '/dashboard');
    const harness = membershipEngineHarness([{
      resource: { collection: 'sermons', id: 's1' },
      metadata: null,
      value: { userId: 'owner', title: 'Saved sermon', verse: '', date: '2026-10-01', thoughts: [] },
    }]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);

    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      expect(await screen.findByText('Saved sermon')).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });
});
