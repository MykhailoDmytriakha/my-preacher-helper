import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';
import { useDashboardSermons } from '@/hooks/useDashboardSermons';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockAddSermons = jest.fn();
const mockUseDashboardSermons = useDashboardSermons as jest.MockedFunction<typeof useDashboardSermons>;

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/hooks/useDashboardSermons', () => ({ useDashboardSermons: jest.fn() }));
jest.mock('@/utils/sermonSearch', () => ({ tokenizeQuery: () => [], matchesSermonQuery: () => true }));
jest.mock('@utils/dateFormatter', () => ({ formatDate: () => '2026-08-12' }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) => {
      if (key === 'workspaces.series.actions.selectedCount') return `Selected ${options?.count ?? 0}`;
      return ({
        'workspaces.series.detail.selectSermonsTitle': 'Select sermons',
        'workspaces.series.detail.selectSermonsDescription': 'Choose sermons',
        'workspaces.series.actions.addSelected': 'Add selected',
        'workspaces.series.actions.adding': 'Adding',
        'workspaces.series.actions.addSermon': 'Add sermon',
        'addSermon.createNewSermon': 'Create sermon',
        'common.cancel': 'Cancel',
        'common.search': 'Search sermons',
        'dashboard.thoughts': 'thoughts',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      }[key] ?? options?.defaultValue ?? key);
    },
  }),
}));

describe('AddSermonToSeriesModal write refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddSermons.mockReset();
    mockUseDashboardSermons.mockReturnValue({
      sermons: [{ id: 'sermon-1', title: 'Exact refused sermon', verse: 'Romans 8:28', date: '2026-08-12', thoughts: [], userId: 'user-1' }],
      loading: false,
      error: null,
      refresh: jest.fn(),
    } as unknown as ReturnType<typeof useDashboardSermons>);
  });

  it('keeps a refused sermon membership selected instead of closing as if it were attached', async () => {
    // Pins the loss where a denied membership hid the chosen sermon and made the series look updated.
    mockAddSermons.mockRejectedValue(makeFirestoreError('permission-denied', 'Permission denied'));
    const onClose = jest.fn();
    render(<AddSermonToSeriesModal onClose={onClose} onCreateNewSermon={jest.fn()} onAddSermons={(ids) => persistedWrite(mockAddSermons(ids))} currentSeriesSermonIds={[]} seriesId="series-1" />);

    fireEvent.click(screen.getByText('Exact refused sermon'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

    await waitFor(() => expect(mockAddSermons).toHaveBeenCalledWith(['sermon-1']));
    // The MESSAGE now belongs to this entity's recovery descriptor (see
    // docs/recoverable-writes.md): it carries the text and follows the person off this
    // screen, and a second message from the editor showed one refusal as two failures.
    // What the editor still owes the person is asserted below: it stays open, holding
    // exactly what they entered, and claims nothing was saved.
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Exact refused sermon')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes silently when sermon membership is deferred to a queue', async () => {
    const onClose = jest.fn();
    render(<AddSermonToSeriesModal onClose={onClose} onCreateNewSermon={jest.fn()} onAddSermons={() => queuedWrite('series:sermons', Promise.resolve())} currentSeriesSermonIds={[]} seriesId="series-1" />);

    fireEvent.click(screen.getByText('Exact refused sermon'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
