import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import GroupDetailPage from '@/(pages)/(private)/groups/[id]/page';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { hasGroupsAccess } from '@/services/userSettings.service';

const mockPush = jest.fn();
const mockUseParams = jest.fn(() => ({ id: 'group-1' }));

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('@/hooks/useGroupDetail', () => ({
  useGroupDetail: jest.fn(),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' } }),
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

const mockUseGroupDetail = useGroupDetail as jest.MockedFunction<typeof useGroupDetail>;
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;

describe('GroupDetailPage', () => {
  const updateGroupDetail = jest.fn();
  const addMeetingDate = jest.fn();
  const removeMeetingDate = jest.fn();
  const deleteGroupDetail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (window as any).confirm = jest.fn(() => true);
    mockHasGroupsAccess.mockResolvedValue(true);
    mockUseParams.mockReturnValue({ id: 'group-1' });
    updateGroupDetail.mockResolvedValue(undefined);
    addMeetingDate.mockResolvedValue(undefined);
    removeMeetingDate.mockResolvedValue(undefined);
    deleteGroupDetail.mockResolvedValue(undefined);

    mockUseGroupDetail.mockReturnValue({
      group: {
        id: 'group-1',
        userId: 'user-1',
        title: 'Family Group',
        description: 'Group description',
        status: 'active',
        templates: [
          {
            id: 'tpl-1',
            type: 'topic',
            title: 'Main topic',
            content: 'Discussion content',
            status: 'filled',
            scriptureRefs: [],
            questions: [],
            createdAt: 'x',
            updatedAt: 'x',
          },
        ],
        flow: [
          {
            id: 'flow-1',
            templateId: 'tpl-1',
            order: 1,
            durationMin: 25,
            instanceNotes: 'Focus on application',
          },
        ],
        meetingDates: [
          {
            id: 'date-1',
            date: '2026-02-11',
            location: 'Hall',
            audience: 'Youth',
            notes: 'Bring notes',
            createdAt: 'x',
          },
        ],
        createdAt: 'x',
        updatedAt: 'x',
        seriesId: null,
        seriesPosition: null,
      } as any,
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);
  });

  it('renders loading state', () => {
    mockUseGroupDetail.mockReturnValue({
      group: null,
      loading: true,
      error: null,
    } as any);
    render(<GroupDetailPage />);
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders error state', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: null,
      loading: false,
      error: new Error('boom'),
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load group')).toBeInTheDocument();
    });
  });

  it('saves edited group details', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    const titleInput = screen.getByDisplayValue('Family Group');
    const descriptionTextarea = screen.getByDisplayValue('Group description');
    fireEvent.change(titleInput, { target: { value: '  Updated Group  ' } });
    fireEvent.change(descriptionTextarea, { target: { value: '  Updated Description  ' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateGroupDetail).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated Group',
          description: 'Updated Description',
          status: 'active',
        })
      )
    );
  });

  it('adds and removes meeting dates', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Add meeting date' })).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('Location (optional)'), {
      target: { value: 'Room 7' },
    });
    fireEvent.change(screen.getByPlaceholderText('Audience (optional)'), {
      target: { value: 'Leaders' },
    });
    fireEvent.change(screen.getByPlaceholderText('Notes (optional)'), {
      target: { value: 'Agenda' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add meeting date' }));
    await waitFor(() =>
      expect(addMeetingDate).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'Room 7',
          audience: 'Leaders',
          notes: 'Agenda',
        })
      )
    );

    // first icon-only delete button in meetings list
    const iconButtons = screen.getAllByRole('button');
    fireEvent.click(iconButtons[iconButtons.length - 1]);
    expect(removeMeetingDate).toHaveBeenCalledWith('date-1');
  });

  it('deletes group and navigates back to /groups', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete group' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
    await waitFor(() => expect(deleteGroupDetail).toHaveBeenCalledTimes(1));
    expect(mockPush).toHaveBeenCalledWith('/groups');

    (window as any).confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
    expect(deleteGroupDetail).toHaveBeenCalledTimes(1);
  });

  it('shows disabled message when groups feature is off', async () => {
    mockHasGroupsAccess.mockResolvedValueOnce(false);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Groups workspace is disabled')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    });
  });
});
