import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GroupsPage from '@/(pages)/(private)/groups/page';
import { useGroups } from '@/hooks/useGroups';
import { hasGroupsAccess } from '@/services/userSettings.service';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

jest.mock('@/hooks/useGroups', () => ({
  useGroups: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(() => ({ series: [] })),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('@/services/userSettings.service', () => ({
  ...jest.requireActual('@/services/userSettings.service'),
  hasGroupsAccess: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue || key,
  }),
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock('@/components/ui/ConfirmModal', () => {
  return function MockConfirmModal({ isOpen, onClose, onConfirm, confirmText, cancelText }: any) {
    if (!isOpen) return null;
    return (
      <div data-testid="confirm-modal">
        <p>Delete this group permanently?</p>
        <button onClick={onConfirm}>{confirmText || 'Confirm'}</button>
        <button onClick={onClose}>{cancelText || 'Cancel'}</button>
      </div>
    );
  };
});

jest.mock('@/components/groups/CreateGroupModal', () => {
  return function MockCreateGroupModal({ onClose, onCreate }: any) {
    return (
      <div data-testid="create-group-modal">
        <button
          onClick={() =>
            onCreate({
              userId: 'user-1',
              title: 'New Group',
              status: 'draft',
              templates: [],
              flow: [],
              meetingDates: [],
              createdAt: 'x',
              updatedAt: 'x',
              seriesId: null,
              seriesPosition: null,
            })
          }
        >
          submit-create
        </button>
        <button onClick={onClose}>close-create</button>
      </div>
    );
  };
});

jest.mock('@/components/groups/GroupCard', () => {
  return function MockGroupCard({ group, onDelete, deleting }: any) {
    return (
      <div data-testid={`group-card-${group.id}`}>
        <span>{group.title}</span>
        <button onClick={onDelete}>{deleting ? 'Deleting...' : `Delete ${group.id}`}</button>
      </div>
    );
  };
});

const mockUseGroups = useGroups as jest.MockedFunction<typeof useGroups>;
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

describe('GroupsPage', () => {
  const createNewGroup = jest.fn();
  const deleteExistingGroup = jest.fn();
  const refreshGroups = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).confirm = jest.fn(() => true);
    mockHasGroupsAccess.mockResolvedValue(true);
    // The write contract: createNewGroup returns a WriteSubmission whose acceptance
    // says WHY closing is safe. A group create is owned by the durable queue, so the
    // honest outcome is `queued` — and `queued` may never be announced as saved.
    createNewGroup.mockImplementation(() => queuedWrite('group:create:test', Promise.resolve()));
    // A WriteSubmission, not a bare promise: `awaitAcceptance` reads `.acceptance`, so a
    // resolved `undefined` threw a TypeError and the test silently exercised the FAILURE
    // branch — passing while proving nothing about a successful delete.
    deleteExistingGroup.mockReturnValue(persistedWrite(Promise.resolve(undefined)));
    refreshGroups.mockResolvedValue(undefined);
    mockUseGroups.mockReturnValue({
      groups: [
        { id: 'g1', title: 'Group One', status: 'active' },
        { id: 'g2', title: 'Group Two', status: 'draft' },
      ] as any,
      loading: false,
      error: null,
      refreshGroups,
      createNewGroup,
      deleteExistingGroup,
    } as any);
  });

  it('renders error state', () => {
    mockUseGroups.mockReturnValue({
      groups: [],
      loading: false,
      error: new Error('boom'),
    } as any);

    render(<GroupsPage />);
    return waitFor(() => {
      expect(screen.getByText('Failed to load groups')).toBeInTheDocument();
    });
  });

  it('renders loading skeleton and empty state', () => {
    mockUseGroups.mockReturnValue({
      groups: [],
      loading: true,
      error: null,
      refreshGroups,
      createNewGroup,
      deleteExistingGroup,
    } as any);
    const { rerender } = render(<GroupsPage />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);

    mockUseGroups.mockReturnValue({
      groups: [],
      loading: false,
      error: null,
      refreshGroups,
      createNewGroup,
      deleteExistingGroup,
    } as any);
    rerender(<GroupsPage />);
    return waitFor(() => {
      expect(screen.getByText('No groups yet. Create your first group.')).toBeInTheDocument();
    });
  });

  it('refreshes, opens create modal and handles create success/error', async () => {
    render(<GroupsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refreshGroups).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    expect(screen.getByTestId('create-group-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByText('submit-create'));
    await waitFor(() => expect(createNewGroup).toHaveBeenCalledTimes(1));

    // A REFUSED create: acceptance rejects, so the page must not close the modal and
    // must not announce anything. Under the old shape this was a rejected bare
    // promise, which the page could not tell from a write that had merely started.
    createNewGroup.mockImplementationOnce(() =>
      persistedWrite(
        Promise.reject(
          Object.assign(new Error('Missing or insufficient permissions.'), {
            code: 'permission-denied',
            name: 'FirebaseError',
          })
        )
      )
    );
    fireEvent.click(screen.getByRole('button', { name: 'New group' }));
    fireEvent.click(screen.getByText('submit-create'));
    await waitFor(() => expect(createNewGroup).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('create-group-modal')).toBeInTheDocument();
  });

  it('deletes group only after confirmation', async () => {
    render(<GroupsPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete g1' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete g1' }));

    await waitFor(() => {
      expect(screen.getByText('Delete this group permanently?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteExistingGroup).toHaveBeenCalledWith('g1'));

    fireEvent.click(screen.getByRole('button', { name: 'Delete g2' }));

    await waitFor(() => {
      expect(screen.getByText('Delete this group permanently?')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteExistingGroup).toHaveBeenCalledTimes(1);
  });

  it('renders access disabled state when groups feature is off', async () => {
    mockHasGroupsAccess.mockResolvedValueOnce(false);

    render(<GroupsPage />);

    await waitFor(() => {
      expect(screen.getByText('Groups workspace is disabled')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open settings' })).toHaveAttribute('href', '/settings');
    });
  });
});
