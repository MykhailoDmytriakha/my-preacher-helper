import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Minimal mocks
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { defaultValue?: string }) => o?.defaultValue || k }),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/test-sermon-id/plan',
}));
// The plan page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/ExportButtons', () => () => <div/>);
jest.mock('@/components/plan/KeyFragmentsModal', () => () => <div/>);

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}><DataEngineProvider>{ui}</DataEngineProvider></QueryClientProvider>);
};

describe('PlanPage resize listener', () => {
  it('attaches and detaches resize listener', async () => {
    const harness = documentEngineHarness({
      resource: { collection: 'sermons', id: 'test-sermon-id' },
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
      value: { userId: 'owner', title: 'T', verse: 'V', date: '2024-01-01', thoughts: [] },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const addSpy = jest.spyOn(window, 'addEventListener');
    const removeSpy = jest.spyOn(window, 'removeEventListener');

    const { unmount } = renderWithQueryClient(<SermonPlanPage />);
    await act(async () => { await settleEngine(); });

    expect(addSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
