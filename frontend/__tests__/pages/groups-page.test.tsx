import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GroupsPage from '@/(pages)/(private)/groups/page';
import { useGroupsDataCollection } from '@/hooks/useGroupsDataCollection';
import { useSeries } from '@/hooks/useSeries';
import { useAuth } from '@/providers/AuthProvider';
import { newClientId } from '@/utils/clientId';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
}));

jest.mock('@/hooks/useGroupsDataCollection', () => ({
  useGroupsDataCollection: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(() => ({ series: [] })),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('@/utils/clientId', () => ({
  newClientId: jest.fn(),
}));

// The page reads the engine through these; there is no DataEngineProvider in this test.
jest.mock('@/data-engine/react.client', () => ({
  useDataEngine: jest.fn(() => ({ browser: null, owner: 'user-1' })),
  useRecoveryDiscovery: jest.fn(() => ({ choices: [], loading: false, error: null, recover: jest.fn() })),
}));

jest.mock('@/data-engine/DataCollectionStatus', () => ({
  DataCollectionStatus: ({ state }: any) => <div data-testid="collection-status">{state ? 'has-state' : 'no-state'}</div>,
}));

jest.mock('@/data-engine/DataSyncStatus', () => ({
  DataSyncStatus: ({ subject }: any) => <div data-testid="sync-status">{String(subject)}</div>,
}));

jest.mock('@/components/diagnostics/TechnicalDetailsButton', () => ({
  TechnicalDetailsButton: () => <button type="button">technical-details</button>,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

// Stubs expose the props the page passes, so the tests can check the arguments and not only the rendering.
jest.mock('@/components/groups/EngineCreateGroupModal', () => ({
  EngineCreateGroupModal: ({ groupId, recoveryId, onClose, onQueued }: any) => (
    <div data-testid="engine-create-group-modal" data-group-id={groupId} data-recovery-id={recoveryId ?? ''}>
      <button onClick={() => onQueued(groupId)}>queue-create</button>
      <button onClick={onClose}>close-create</button>
    </div>
  ),
}));

jest.mock('@/components/groups/EngineDeleteGroupModal', () => ({
  EngineDeleteGroupModal: ({ groupId, onClose }: any) => (
    <div data-testid="engine-delete-group-modal" data-group-id={groupId}>
      <button onClick={onClose}>close-delete</button>
    </div>
  ),
}));

jest.mock('@/components/groups/GroupCard', () => {
  return function MockGroupCard({ group, onDelete }: any) {
    return (
      <div data-testid={`group-card-${group.id}`}>
        <span>{group.title}</span>
        <button onClick={onDelete}>{`Delete ${group.id}`}</button>
      </div>
    );
  };
});

const mockUseGroupsDataCollection = useGroupsDataCollection as jest.MockedFunction<typeof useGroupsDataCollection>;
const mockUseAuth = jest.mocked(useAuth);
const mockNewClientId = jest.mocked(newClientId);

describe('GroupsPage', () => {
  const refreshGroups = jest.fn();
  const baseCollection = {
    groups: [
      { id: 'g1', title: 'Group One', status: 'active' },
      { id: 'g2', title: 'Group Two', status: 'draft' },
    ],
    loading: false,
    error: null,
    refreshGroups,
    state: null,
    complete: true,
    freshness: 'fresh',
  };
  const withCollection = (patch: Record<string, unknown> = {}) =>
    mockUseGroupsDataCollection.mockReturnValue({ ...baseCollection, ...patch } as any);

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);
    mockNewClientId.mockReturnValue('fresh-group-id');
    withCollection();
  });

  it('renders error state', () => {
    withCollection({ groups: [], error: new Error('boom') });

    render(<GroupsPage />);

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to load groups');
  });

  it('keeps creation reachable when loading the list fails and opens the engine create modal with a fresh id', () => {
    withCollection({ groups: [], error: new Error('offline') });
    render(<GroupsPage />);

    fireEvent.click(screen.getAllByRole('button', { name: 'New group' })[0]);

    const modal = screen.getByTestId('engine-create-group-modal');
    expect(modal).toHaveAttribute('data-group-id', 'fresh-group-id');
    expect(screen.getByText('Failed to load groups')).toBeInTheDocument();
  });

  it('renders loading skeleton and empty state', () => {
    withCollection({ groups: [], loading: true, complete: false });
    const { rerender } = render(<GroupsPage />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByText('No groups yet. Create your first group.')).not.toBeInTheDocument();

    withCollection({ groups: [], loading: false, complete: true });
    rerender(<GroupsPage />);
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.getByText('No groups yet. Create your first group.')).toBeInTheDocument();
  });

  it('does not claim the list is empty while the collection is still incomplete', () => {
    withCollection({ groups: [], loading: false, complete: false });
    render(<GroupsPage />);

    expect(screen.queryByText('No groups yet. Create your first group.')).not.toBeInTheDocument();
    expect(screen.getByTestId('groups-grid')).toBeInTheDocument();
  });

  it('refreshes the list from the refresh button', () => {
    render(<GroupsPage />);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it('opens the engine create modal with a fresh group id and navigates to the new group once it is queued', async () => {
    render(<GroupsPage />);
    expect(screen.queryByTestId('engine-create-group-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New group' }));

    const modal = screen.getByTestId('engine-create-group-modal');
    expect(modal).toHaveAttribute('data-group-id', 'fresh-group-id');
    expect(modal).toHaveAttribute('data-recovery-id', '');
    expect(mockPush).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('queue-create'));

    expect(mockPush).toHaveBeenCalledWith('/groups/fresh-group-id');
    await waitFor(() => expect(screen.queryByTestId('engine-create-group-modal')).not.toBeInTheDocument());
  });

  it('closes the create modal without navigating', () => {
    render(<GroupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));

    fireEvent.click(screen.getByText('close-create'));

    expect(screen.queryByTestId('engine-create-group-modal')).not.toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the engine delete modal for the chosen group and leaves the deletion to the modal', () => {
    render(<GroupsPage />);
    expect(screen.queryByTestId('engine-delete-group-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete g1' }));

    expect(screen.getByTestId('engine-delete-group-modal')).toHaveAttribute('data-group-id', 'g1');
    // The page itself deletes nothing and keeps both cards until the modal's own write lands.
    expect(screen.getByTestId('group-card-g1')).toBeInTheDocument();
    expect(screen.getByTestId('group-card-g2')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-delete'));
    expect(screen.queryByTestId('engine-delete-group-modal')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete g2' }));
    expect(screen.getByTestId('engine-delete-group-modal')).toHaveAttribute('data-group-id', 'g2');
  });

  it('reads groups and series for the signed-in user', () => {
    render(<GroupsPage />);

    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument();
    expect(screen.getByText('Group One')).toBeInTheDocument();
    expect(useSeries).toHaveBeenCalledWith('user-1');
  });

  it('rebuilds the page for a different user so the previous user\'s open modal does not carry over', () => {
    const { rerender } = render(<GroupsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    expect(screen.getByTestId('engine-create-group-modal')).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ user: { uid: 'user-2' } } as any);
    rerender(<GroupsPage />);

    expect(screen.queryByTestId('engine-create-group-modal')).not.toBeInTheDocument();
    expect(useSeries).toHaveBeenLastCalledWith('user-2');
  });

  it('asks for no series and no user data after logout', () => {
    const { rerender } = render(<GroupsPage />);

    mockUseAuth.mockReturnValue({ user: null } as any);
    rerender(<GroupsPage />);

    expect(useSeries).toHaveBeenLastCalledWith(null);
  });
});
