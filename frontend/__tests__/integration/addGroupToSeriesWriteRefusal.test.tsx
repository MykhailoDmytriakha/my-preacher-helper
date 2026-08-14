import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import AddGroupToSeriesModal from '@/components/series/AddGroupToSeriesModal';
import { useGroups } from '@/hooks/useGroups';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const makeFirestoreError = (code: string, message = code): Error & { code: string } => {
  const { FirestoreError } = jest.requireActual<typeof import('firebase/firestore')>('firebase/firestore');
  const Ctor = FirestoreError as unknown as new (code: string, message: string) => Error & { code: string };
  return new Ctor(code, message);
};

const mockAddGroups = jest.fn();
const mockUseGroups = useGroups as jest.MockedFunction<typeof useGroups>;

jest.mock('react-dom', () => ({ ...jest.requireActual('react-dom'), createPortal: (node: React.ReactNode) => node }));
jest.mock('@/hooks/useGroups', () => ({ useGroups: jest.fn() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'user-1' } }) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string; count?: number }) => {
      if (key === 'workspaces.series.actions.selectedCount') return `Selected ${options?.count ?? 0}`;
      return ({
        'navigation.groups': 'Groups',
        'workspaces.series.actions.addGroup': 'Add groups to series',
        'workspaces.series.actions.addSelected': 'Add selected',
        'workspaces.series.actions.adding': 'Adding',
        'common.cancel': 'Cancel',
        'common.search': 'Search groups',
        'writeRecovery.refused': 'Save refused. Nothing was saved; your text is still here.',
      }[key] ?? options?.defaultValue ?? key);
    },
  }),
}));

describe('AddGroupToSeriesModal write refusal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAddGroups.mockReset();
    mockUseGroups.mockReturnValue({
      groups: [{ id: 'group-1', title: 'Exact refused group', description: 'The selected membership' }],
      loading: false,
    } as ReturnType<typeof useGroups>);
  });

  it('keeps a refused group membership selected instead of closing as if it were attached', async () => {
    // Pins the loss where a denied membership erased the person's selected group while implying it joined the series.
    mockAddGroups.mockRejectedValue(makeFirestoreError('not-found', 'Series not found'));
    const onClose = jest.fn();
    render(
      <AddGroupToSeriesModal
        onClose={onClose}
        onAddGroups={(ids) => persistedWrite(mockAddGroups(ids))}
        currentSeriesGroupIds={[]}
      />
    );

    fireEvent.click(screen.getByText('Exact refused group'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

    await waitFor(() => expect(mockAddGroups).toHaveBeenCalledWith(['group-1']));
    // The MESSAGE now belongs to this entity's recovery descriptor (see
    // docs/recoverable-writes.md): it carries the text and follows the person off this
    // screen, and a second message from the editor showed one refusal as two failures.
    // What the editor still owes the person is asserted below: it stays open, holding
    // exactly what they entered, and claims nothing was saved.
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByText('Exact refused group')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes silently when group membership is deferred to a queue', async () => {
    const onClose = jest.fn();
    render(<AddGroupToSeriesModal onClose={onClose} onAddGroups={() => queuedWrite('series:groups', Promise.resolve())} currentSeriesGroupIds={[]} />);

    fireEvent.click(screen.getByText('Exact refused group'));
    fireEvent.click(screen.getByRole('button', { name: 'Add selected' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
