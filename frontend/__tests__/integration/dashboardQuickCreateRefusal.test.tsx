import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { QueryProvider } from '@/providers/QueryProvider';

import { settleEngine } from '../../test-utils/documentEngineHarness';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';

/**
 * Why this file exists NEXT TO `dashboardWriteRefusal.test.tsx`:
 *
 * That suite renders a hand-built harness. It passed while the REAL `/dashboard` dropped
 * the reporter on the floor, so a sermon quick-created there could be refused and the person
 * saw a row that looked saved with no verdict. The rule this pins down: a screen that STARTS
 * a write must render the reporter for it. Therefore this suite imports the actual page
 * component, runs the REAL engine (only I/O is replaced) and asserts on what the person sees
 * and on the stored request. Sermons are engine-owned: the verdict is the collection status
 * the page draws, not a per-row badge.
 */

// A real (empty) persister, not `jest.fn()`: the provider calls `restoreClient` on mount,
// and a persister that is `undefined` takes the whole QueryClient context down with it.
// The previous-version archive mounts on every deployment; this browser has nothing to keep in it.
jest.mock('@/data-engine/legacyQueryRecovery.client', () => ({
  ...jest.requireActual('@/data-engine/legacyQueryRecovery.client'),
  preserveLegacyQueryCache: jest.fn().mockResolvedValue(undefined),
  listLegacyQueryCopies: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: () => ({
    persistClient: async () => undefined,
    restoreClient: async () => undefined,
    removeClient: async () => undefined,
  }),
}));

jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'user-1' } },
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
}));

// The suite-wide `createPortal` stub in jest.setup.js mounts portal content in a SEPARATE
// React root, so anything inside the modal loses every context — including the QueryClient.
// The date picker's settings hook is the only thing that needs one, and it is not what this
// suite is about. The write itself still runs in the page's tree: the modal receives
// `onCreateRequest` as a prop from the page.
jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' }, loading: false }),
}));

// The panels around the sermon list are not what this suite is about.
jest.mock('@/hooks/useSeries', () => ({ useSeries: () => ({ series: [] }) }));
jest.mock('@/hooks/useStudyNotes', () => ({ useStudyNotes: () => ({ notes: [] }) }));
jest.mock('@/hooks/useGroupsRead', () => ({ useGroupsRead: () => ({ groups: [] }) }));
jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => ({ prayerRequests: [], createPrayer: jest.fn() }),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'dashboardHome.actions.newSermon': 'New sermon',
        'addSermon.newSermon': 'New sermon',
        'addSermon.titleLabel': 'Title',
        'addSermon.verseLabel': 'Scripture Reference',
        'addSermon.plannedDateLabel': 'Planned preaching date (optional)',
        'addSermon.save': 'Save',
        'addSermon.cancel': 'Cancel',
        'freshness.copyTextAction': 'Copy text',
        'buttons.dismiss': 'Dismiss',
        'writeRecovery.refusedLabel': 'Save refused',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
        'writeRecovery.sermonFailed': 'Sermon changes were not saved.',
      };
      return translations[key] ?? options?.defaultValue ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

// Non-React export helpers use the same language as the surrounding test UI.
jest.mock('@locales/i18n', () => ({
  i18n: { t: (_key: string, fallback?: string) => fallback ?? _key, language: 'en' },
}));


function renderDashboard() {
  const harness = membershipEngineHarness([]);
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
  const view = render(
    <QueryProvider>
      <DataEngineProvider>
        <DashboardPage />
      </DataEngineProvider>
    </QueryProvider>
  );
  return { harness, view };
}

async function quickCreate() {
  fireEvent.click(await screen.findByRole('button', { name: 'New sermon' }));
  const title = await screen.findByLabelText('Title');
  await waitFor(() => expect(title).toBeEnabled());
  fireEvent.change(title, { target: { value: 'Sermon the server refused' } });
  fireEvent.change(screen.getByLabelText('Scripture Reference'), { target: { value: 'Acts 2:42' } });
  await act(async () => { await settleEngine(); });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}

describe('dashboard quick-create — a refused sermon is reported ON the dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
  });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  it('shows the refusal on the dashboard and keeps the typed text in the stored request', async () => {
    const { harness, view } = renderDashboard();
    jest.mocked(harness.transport.send).mockImplementation(async command =>
      ({ kind: 'refused', operationId: command.operationId, code: 'permission-denied' }));
    await quickCreate();
    await act(async () => { await harness.engine.retry(); await settleEngine(); });

    // The person is TOLD, on the page they are looking at.
    await waitFor(() => expect(screen.getByText('dataSync.collectionAttention')).toBeInTheDocument());
    const [request] = await harness.commits.list('user-1');
    expect(request.state).toBe('refused');
    expect(JSON.stringify(request)).toContain('Sermon the server refused');
    expect(JSON.stringify(request)).toContain('Acts 2:42');
    view.unmount();
  });

  it('does not report anything while nothing has failed', async () => {
    const { harness, view } = renderDashboard();
    await quickCreate();
    await act(async () => { await harness.engine.retry(); await settleEngine(); });

    expect(harness.read((await harness.commits.list('user-1'))[0]?.baseline.resource ?? { collection: 'sermons', id: 'none' }).value)
      .toMatchObject({ title: 'Sermon the server refused' });
    expect(screen.queryByText('dataSync.collectionAttention')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.unmount();
  });
});
