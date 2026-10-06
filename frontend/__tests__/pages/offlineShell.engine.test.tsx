import { render, screen } from '@testing-library/react';

import { createBrowserDataEngine } from '@/data-engine/browser.client';
import OfflineShell from '@/~offline/page';

import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { TestProviders } from '../../test-utils/test-providers';

jest.mock('@/providers/AuthProvider', () => ({
  ...jest.requireActual('@/providers/AuthProvider'),
  useAuth: () => ({ user: { uid: 'owner' } }),
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
