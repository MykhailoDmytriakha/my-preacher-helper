import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';
import '@testing-library/jest-dom';

// Mock window.matchMedia for JSDOM
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// Router mocks
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/test-sermon-id/plan',
}));

// i18n mock
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// The plan page runs on the data engine: it opens the sermon document through the real engine,
// with only the server and the browser transport replaced.
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' }, loading: false }) }));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/plan/KeyFragmentsModal', () => () => <div />);
jest.mock('@/components/ExportButtons', () => () => <div />);

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

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

describe('Sermon plan container width', () => {
  it('does not use min-h-screen and keeps page container lightweight', async () => {
    const harness = documentEngineHarness({
      resource: { collection: 'sermons', id: 'test-sermon-id' },
      metadata: { protocol: 1, generation: 'g1', revision: 1, deleted: false },
      value: {
        userId: 'owner', title: 'T', verse: 'V', date: '2024-01-01',
        // Whole enough to reach the paired screen at all — this test is about the container,
        // and an unready sermon is met by the gate instead.
        thoughts: [{ id: 't1', text: 'A thought', tags: [], date: '2024-01-01', outlinePointId: 'intro-1' }],
        outline: { introduction: [{ id: 'intro-1', text: 'Intro Point' }], main: [], conclusion: [] },
      },
    });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    renderWithQueryClient(<SermonPlanPage />);
    // Root should have data-testid and no min-h-screen
    const root = await screen.findByTestId('sermon-plan-page-container');
    expect(root).toBeInTheDocument();
    expect((root as HTMLElement).className).not.toMatch(/min-h-screen/);
  });
});
