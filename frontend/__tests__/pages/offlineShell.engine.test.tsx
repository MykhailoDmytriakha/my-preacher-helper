import { render, screen } from '@testing-library/react';

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

describe('offline shell', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    window.history.replaceState(null, '', '/');
    mockAuth = { user: { uid: 'owner' }, loading: false };
    localStorage.clear();
  });

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

  it('opens the dashboard while a saved session is still being restored', async () => {
    mockAuth = { user: null, loading: false };
    localStorage.setItem('firebase:authUser:key:[DEFAULT]', '{}');
    window.history.replaceState(null, '', '/');
    jest.mocked(createBrowserDataEngine).mockImplementation(membershipEngineHarness([]).createBrowser);
    const view = render(<TestProviders><OfflineShell /></TestProviders>);
    try {
      expect(await screen.findByLabelText('sermons')).toBeInTheDocument();
    } finally {
      view.unmount();
    }
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
