import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import DashboardPage from '@/(pages)/(private)/dashboard/page';
import { QueryProvider } from '@/providers/QueryProvider';

/**
 * Why this file exists NEXT TO `dashboardWriteRefusal.test.tsx`:
 *
 * That suite renders a hand-built harness which wires `syncState` into a SermonCard by
 * hand. It passed while the REAL `/dashboard` dropped `syncStatesById` on the floor and
 * rendered plain links — so a sermon quick-created there could be refused, and the person
 * saw a row that looked saved with no verdict, no text and no way to recover it. The
 * modal is silent by contract, so nothing else was going to speak.
 *
 * The rule this pins down: a screen that STARTS a write must render the reporter for it.
 * Therefore this suite imports the actual page component and nothing else.
 */

const mockCreateSermon = jest.fn();

// A real (empty) persister, not `jest.fn()`: the provider calls `restoreClient` on mount,
// and a persister that is `undefined` takes the whole QueryClient context down with it.
jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: () => ({
    persistClient: async () => undefined,
    restoreClient: async () => undefined,
    removeClient: async () => undefined,
  }),
}));

jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'user-1' } },
}));

jest.mock('@services/sermon.service', () => ({
  createSermon: (...args: unknown[]) => mockCreateSermon(...args),
  deleteSermon: jest.fn(),
  updateSermon: jest.fn(),
  getSermons: jest.fn().mockResolvedValue([]),
}));

jest.mock('@services/preachDates.service', () => ({
  addPreachDate: jest.fn(),
  deletePreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));

jest.mock('@/hooks/useSeriesMembership', () => ({
  useSeriesMembership: () => ({
    addToSeries: jest.fn(),
    addRefsToSeries: jest.fn(),
    removeFromAllSeries: jest.fn(),
    reorderSeries: jest.fn(),
  }),
}));

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
jest.mock('@/hooks/useGroups', () => ({ useGroups: () => ({ groups: [] }) }));
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

// `exportContent.ts` (pulled in by SermonCard) reads translations at MODULE LOAD, so the
// stub has to answer `t` before anything renders.
jest.mock('@locales/i18n', () => ({
  i18n: { t: (_key: string, fallback?: string) => fallback ?? _key, language: 'en' },
}));

const permissionDenied = () => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor('permission-denied', 'Missing or insufficient permissions.');
};

describe('dashboard quick-create — a refused sermon is reported ON the dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the refusal, the typed text and a way to copy it', async () => {
    mockCreateSermon.mockRejectedValue(permissionDenied());

    render(
      <QueryProvider>
        <DashboardPage />
      </QueryProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'New sermon' }));

    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Sermon the server refused' },
    });
    fireEvent.change(screen.getByLabelText('Scripture Reference'), {
      target: { value: 'Acts 2:42' },
    });
    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-09-13' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // (1) the person is TOLD — by the form, which is the only thing they can see. It
    // covers the page, so a badge drawn on the row underneath would be unreadable.
    const formVerdict = await screen.findByRole('alert');
    expect(formVerdict).toHaveTextContent('Save refused');
    // Exactly one message: the row keeps quiet while the form owns the screen.
    expect(screen.getAllByRole('alert')).toHaveLength(1);

    // (2) the draft is still in the fields — nothing was cleared on the way
    expect(screen.getByLabelText('Title')).toHaveValue('Sermon the server refused');
    expect(screen.getByLabelText('Scripture Reference')).toHaveValue('Acts 2:42');

    // (3) once the form is closed the row takes over, carrying EVERYTHING that was
    // entered — a draft handed back without the date is a draft still to be redone.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    const rowVerdict = await screen.findByRole('alert');
    expect(rowVerdict).toHaveTextContent('Save refused');
    expect(rowVerdict).toHaveTextContent('Sermon the server refused');
    expect(rowVerdict).toHaveTextContent('Acts 2:42');
    expect(rowVerdict).toHaveTextContent('2026-09-13');
    expect(within(rowVerdict).getByRole('button', { name: 'Copy text' })).toBeInTheDocument();
  });

  it('does not report anything while nothing has failed', async () => {
    mockCreateSermon.mockResolvedValue({
      id: 'sermon-ok',
      userId: 'user-1',
      title: 'Accepted sermon',
      verse: 'Acts 2:42',
      date: '2026-08-14T00:00:00.000Z',
      thoughts: [],
    });

    render(
      <QueryProvider>
        <DashboardPage />
      </QueryProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'New sermon' }));
    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Accepted sermon' },
    });
    fireEvent.change(screen.getByLabelText('Scripture Reference'), {
      target: { value: 'Acts 2:42' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockCreateSermon).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
