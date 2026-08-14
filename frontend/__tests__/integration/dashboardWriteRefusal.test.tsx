import {
  onlineManager,
  useQuery,
} from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import SermonCard from '@/components/dashboard/SermonCard';
import { useDashboardOptimisticSermons } from '@/hooks/useDashboardOptimisticSermons';
import { QueryProvider } from '@/providers/QueryProvider';
import { isWriteRefusedError } from '@/services/conflictSafeUpdate.client';
import { getEffectiveIsPreached } from '@/utils/preachDateStatus';
import { createIDBPersister } from '@/utils/queryPersister';

import type { Sermon } from '@/models/models';

// FirestoreError's constructor is private, so TypeScript refuses `new FirestoreError(...)`
// even though the class is exported. The cast keeps the REAL SDK class at runtime — which is
// the point of these tests, they assert on the object a denied write actually produces —
// while satisfying the type checker. Resolve it lazily because Jest also mocks selected
// Firestore functions in neighboring integration suites.
const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

// Preach-date writes cross the Next API boundary. The route preserves the SDK
// refusal code and the browser service reattaches it to an ordinary Error.
const makeApiWriteRefusal = (): Error & { code: string; status: number } =>
  Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
    status: 403,
  });

const mockUpdateSermon = jest.fn();
const mockAddPreachDate = jest.fn();

jest.mock('@/utils/queryPersister', () => ({
  createIDBPersister: jest.fn(),
}));

jest.mock('@services/firebaseAuth.service', () => ({
  auth: { currentUser: { uid: 'user-1' } },
}));

jest.mock('@services/sermon.service', () => ({
  createSermon: jest.fn(),
  deleteSermon: jest.fn(),
  updateSermon: (...args: unknown[]) => mockUpdateSermon(...args),
}));

jest.mock('@services/preachDates.service', () => ({
  addPreachDate: (...args: unknown[]) => mockAddPreachDate(...args),
  deletePreachDate: jest.fn(),
  updatePreachDate: jest.fn(),
}));

jest.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

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

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
}));

jest.mock('@/components/calendar/ChurchAutocomplete', () => ({
  __esModule: true,
  default: ({ initialValue, onChange }: {
    initialValue?: { name?: string };
    onChange: (church: { id: string; name: string; city: string }) => void;
  }) => (
    <label>
      Church
      <input
        aria-label="Church"
        defaultValue={initialValue?.name ?? ''}
        onChange={(event) => onChange({ id: 'church-1', name: event.target.value, city: 'Everett' })}
      />
    </label>
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string; defaultValue?: string }) => {
      const translations: Record<string, string> = {
        'optionMenu.options': 'Options',
        'optionMenu.edit': 'Edit',
        'optionMenu.markAsPreached': 'Mark as preached',
        'optionMenu.markAsNotPreached': 'Mark as not preached',
        'optionMenu.delete': 'Delete',
        'editSermon.editSermon': 'Edit Sermon',
        'editSermon.titleLabel': 'Title',
        'editSermon.titlePlaceholder': 'Enter sermon title',
        'editSermon.verseLabel': 'Scripture Reference',
        'editSermon.versePlaceholder': 'Enter scripture reference',
        'editSermon.plannedDateLabel': 'Planned preaching date (optional)',
        'editSermon.plannedDateHint': 'Leave empty if you do not want a planned date',
        'editSermon.clearPlannedDate': 'Clear',
        'calendar.addPreachDate': 'Add Preach Date',
        'calendar.editPreachDate': 'Edit Preach Date',
        'calendar.date': 'Date',
        'calendar.audience': 'Audience',
        'calendar.notes': 'Notes',
        'calendar.unspecifiedChurch': 'Church not specified',
        'dashboard.created': 'Created',
        'dashboard.preached': 'Preached',
        'buttons.cancel': 'Cancel',
        'buttons.save': 'Save',
        'buttons.saving': 'Saving',
        'buttons.dismiss': 'Dismiss',
        'freshness.copyTextAction': 'Copy text',
        'writeRecovery.refusedLabel': 'Save refused',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
        'writeRecovery.sermonFailed': 'Sermon changes were not saved.',
      };
      return translations[key] ?? options?.defaultValue ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

const originalSermon: Sermon = {
  id: 'sermon-refusal',
  userId: 'user-1',
  title: 'Stored sermon title',
  verse: 'John 3:16',
  date: '2026-08-11T00:00:00.000Z',
  thoughts: [],
  preachDates: [],
};

function DashboardHarness() {
  const { data: sermons = [] } = useQuery<Sermon[]>({
    queryKey: ['sermons', 'user-1'],
    queryFn: async () => [originalSermon],
    enabled: false,
    initialData: [originalSermon],
  });
  const { syncStatesById, actions } = useDashboardOptimisticSermons();
  // `/sermons` renders the Active tab by filtering preached sermons out. This
  // boundary matters: a premature optimistic `isPreached=true` unmounts the card
  // and its portal modal before a refused write can render an alert.
  const sermon = sermons.find((candidate) => !getEffectiveIsPreached(candidate));

  if (!sermon) return <p>No active sermons</p>;
  return (
    <SermonCard
      sermon={sermon}
      onDelete={jest.fn()}
      onUpdate={jest.fn()}
      syncState={syncStatesById[sermon.id]}
      optimisticActions={actions}
    />
  );
}

const renderDashboard = () => {
  (createIDBPersister as jest.MockedFunction<typeof createIDBPersister>).mockReturnValue({
    persistClient: jest.fn().mockResolvedValue(undefined),
    restoreClient: jest.fn().mockResolvedValue(undefined),
    removeClient: jest.fn().mockResolvedValue(undefined),
  });

  return render(
    <QueryProvider>
      <DashboardHarness />
    </QueryProvider>
  );
};

const openOptions = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Options' }));
};

describe('dashboard refusal recovery through the real mutation hook', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateSermon.mockReset();
    mockAddPreachDate.mockReset();
    onlineManager.setOnline(true);
  });

  it('keeps a refused sermon edit in the open form and rolls the rendered card back', async () => {
    const refusal = makeFirestoreError(
      'permission-denied',
      'Missing or insufficient permissions.'
    );
    expect({ name: refusal.name, code: refusal.code, message: refusal.message }).toEqual({
      name: 'FirebaseError',
      code: 'permission-denied',
      message: 'Missing or insufficient permissions.',
    });
    expect(isWriteRefusedError(refusal)).toBe(true);
    mockUpdateSermon.mockRejectedValue(refusal);
    renderDashboard();

    openOptions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Exact refused sermon title' },
    });
    fireEvent.change(screen.getByLabelText('Scripture Reference'), {
      target: { value: 'Exact refused sermon verse' },
    });
    fireEvent.change(screen.getByLabelText('Planned preaching date (optional)'), {
      target: { value: '2026-11-20' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockUpdateSermon).toHaveBeenCalledTimes(1));
    // Reported by the dashboard badge / recovery descriptor — one refusal, one
    // reporter. The dialog's duty is below: it stays open with every field intact.
    // `find`, not `get`: the suite-wide portal stub in jest.setup.js tears its portal root
    // down and rebuilds it whenever the parent re-renders, so the dialog blinks out of the
    // DOM for a tick. Real `createPortal` does not do this.
    const dialog = await screen.findByRole('dialog', { name: 'Edit Sermon' });
    /**
     * IT SAYS SO, and says so HERE. The card badge that owns this refusal is deliberately
     * hidden while this dialog covers it, so if the dialog also stayed silent the person
     * would be left with an unchanged form and every reason to think the save went
     * through. Exactly one alert: the reporter moves, it does not multiply.
     */
    await waitFor(() =>
      expect(within(dialog).getByRole('alert')).toHaveTextContent('Save refused')
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Exact refused sermon title');
    expect(within(dialog).getByLabelText('Scripture Reference')).toHaveValue('Exact refused sermon verse');
    expect(within(dialog).getByLabelText('Planned preaching date (optional)')).toHaveValue('2026-11-20');

    const card = screen.getByTestId('sermon-card-sermon-refusal');
    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent('Stored sermon title');
    expect(within(card).queryByRole('heading', { level: 3, name: 'Exact refused sermon title' })).not.toBeInTheDocument();
    expect(mockUpdateSermon).toHaveBeenCalledTimes(1);
  });

  it('keeps refused preaching details in the open form and out of the rendered sermon status', async () => {
    const refusal = makeApiWriteRefusal();
    expect({ name: refusal.name, code: refusal.code, status: refusal.status }).toEqual({
      name: 'Error',
      code: 'permission-denied',
      status: 403,
    });
    mockAddPreachDate.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(refusal), 25))
    );
    renderDashboard();

    openOptions();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark as preached' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-11-19' } });
    fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Refused Church' } });
    fireEvent.change(screen.getByLabelText('Audience'), { target: { value: 'Exact refused audience' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Exact refused preaching notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockAddPreachDate).toHaveBeenCalledTimes(1));
    // Reported by the dashboard badge / recovery descriptor — one refusal, one
    // reporter. The dialog's duty is below: it stays open with every field intact.
    const dialog = screen.getByRole('dialog', { name: 'Add Preach Date' });
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-19');
    expect(within(dialog).getByLabelText('Church')).toHaveValue('Refused Church');
    expect(within(dialog).getByLabelText('Audience')).toHaveValue('Exact refused audience');
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('Exact refused preaching notes');

    const card = screen.getByTestId('sermon-card-sermon-refusal');
    await waitFor(() => expect(within(card).queryByText('Preached')).not.toBeInTheDocument());
    expect(mockAddPreachDate).toHaveBeenCalledTimes(1);
  });
});
