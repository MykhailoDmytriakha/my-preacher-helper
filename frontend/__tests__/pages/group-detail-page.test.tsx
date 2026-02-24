import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import GroupDetailPage from '@/(pages)/(private)/groups/[id]/page';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { hasGroupsAccess } from '@/services/userSettings.service';

const mockPush = jest.fn();
const mockUseParams = jest.fn(() => ({ id: 'group-1' }));
const mockArrayMove = jest.fn((items: any[], from: number, to: number) => {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (!moved) return next;
  next.splice(to, 0, moved);
  return next;
});

jest.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useRouter: () => ({
    push: mockPush,
  }),
}));

jest.mock('lodash/debounce', () => jest.fn((fn) => {
  const debounced = (...args: any[]) => fn(...args);
  debounced.cancel = jest.fn();
  debounced.flush = jest.fn();
  return debounced;
}));

jest.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: any) => (
    <div data-testid="dnd-context">
      <button
        type="button"
        onClick={() => onDragEnd({ active: { id: 'flow-1' }, over: { id: 'flow-2' } })}
      >
        Trigger drag end
      </button>
      {children}
    </div>
  ),
  closestCenter: jest.fn(),
  KeyboardSensor: jest.fn(),
  PointerSensor: jest.fn(),
  useSensor: jest.fn(() => ({})),
  useSensors: jest.fn(() => []),
}));

jest.mock('@dnd-kit/sortable', () => ({
  arrayMove: (...args: [any[], number, number]) => mockArrayMove(...args),
  SortableContext: ({ children }: any) => <>{children}</>,
  sortableKeyboardCoordinates: jest.fn(),
  verticalListSortingStrategy: jest.fn(),
  useSortable: jest.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: jest.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

jest.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Transform: {
      toString: () => '',
    },
  },
}));

jest.mock('@/hooks/useGroupDetail', () => ({
  useGroupDetail: jest.fn(),
}));

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(() => ({ series: [{ id: 'mock-series-1', title: 'Mock Series', color: '#000000' }] })),
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

jest.mock('@/components/series/SeriesSelector', () => ({
  __esModule: true,
  default: ({ onSelect, onClose }: any) => (
    <div data-testid="series-selector-mock">
      <button onClick={() => onSelect('mock-series-1')}>Select Mock Series</button>
      <button onClick={onClose}>Close Selector</button>
    </div>
  ),
}));

const mockUseGroupDetail = useGroupDetail as jest.MockedFunction<typeof useGroupDetail>;
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

const createMockGroup = (overrides: Partial<any> = {}) =>
  ({
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
    ...overrides,
  }) as any;

describe('GroupDetailPage', () => {
  const updateGroupDetail = jest.fn();
  const addMeetingDate = jest.fn();
  const updateMeetingDate = jest.fn();
  const removeMeetingDate = jest.fn();
  const deleteGroupDetail = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    (window as any).confirm = jest.fn(() => true);
    mockHasGroupsAccess.mockResolvedValue(true);
    mockUseParams.mockReturnValue({ id: 'group-1' });
    updateGroupDetail.mockResolvedValue(undefined);
    addMeetingDate.mockResolvedValue(undefined);
    updateMeetingDate.mockResolvedValue(undefined);
    removeMeetingDate.mockResolvedValue(undefined);
    deleteGroupDetail.mockResolvedValue(undefined);

    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup(),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
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

  it('populates meeting date fields from group data', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-02-11')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Hall')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Youth')).toBeInTheDocument();
    });
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

  it('shows error toast when deleting group fails', async () => {
    deleteGroupDetail.mockRejectedValueOnce(new Error('Delete failed'));

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Delete group' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));

    await waitFor(() => {
      expect(deleteGroupDetail).toHaveBeenCalledTimes(1);
      expect(mockToastError).toHaveBeenCalledWith('Failed to delete group');
    });
  });

  it('shows disabled message when groups feature is off', async () => {
    mockHasGroupsAccess.mockResolvedValueOnce(false);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('Groups workspace is disabled')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    });
  });

  it('renders empty flow placeholder when no blocks exist', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({ templates: [], flow: [], meetingDates: [] }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByText('No blocks yet')).toBeInTheDocument();
    });
  });

  it('triggers save handlers for flow add/edit/delete actions', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main topic' }));

    fireEvent.click(screen.getAllByText('Main topic')[0]);

    await waitFor(() => {
      expect(screen.getByLabelText('Block Name')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText('Block Name'), { target: { value: 'Updated Block' } });
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '30' } });
    fireEvent.click(screen.getByTitle('Filled'));

    const updatedBlockRow = screen.getAllByText('Updated Block')[0];
    fireEvent.click(updatedBlockRow);
    fireEvent.click(updatedBlockRow);
    fireEvent.click(updatedBlockRow);

    fireEvent.click(screen.getAllByRole('button', { name: 'More options' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(updateGroupDetail).toHaveBeenCalled();
    });
  });

  it('handles drag-end reorder and schedules autosave', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({
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
          {
            id: 'tpl-2',
            type: 'notes',
            title: 'Second block',
            content: 'Second block content',
            status: 'draft',
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
          },
          {
            id: 'flow-2',
            templateId: 'tpl-2',
            order: 2,
            durationMin: 10,
          },
        ],
      }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Trigger drag end' }));

    await waitFor(() => {
      expect(updateGroupDetail).toHaveBeenCalled();
    });

    expect(mockArrayMove).toHaveBeenCalled();
  });

  it('adds meeting date when there is no existing date', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({ meetingDates: [] }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    const dateInput = screen.getByPlaceholderText('No date') as HTMLInputElement;
    fireEvent.focus(dateInput);
    fireEvent.change(dateInput, { target: { value: '2026-03-01' } });

    await waitFor(() => {
      expect(addMeetingDate).toHaveBeenCalledWith(
        expect.objectContaining({
          date: '2026-03-01',
        })
      );
    });
  });

  it('removes meeting date when date field is cleared', async () => {
    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-02-11')).toBeInTheDocument();
    });

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '' } });

    await waitFor(() => {
      expect(removeMeetingDate).toHaveBeenCalledWith('date-1');
    });
  });

  it('shows toast error when autosave fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    updateGroupDetail.mockRejectedValueOnce(new Error('save failed'));

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByDisplayValue('Family Group'), {
      target: { value: 'Broken save' },
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });

    consoleErrorSpy.mockRestore();
  });

  it('handles assigning a group to a series', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({ seriesId: null }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assign to series' })).toBeInTheDocument();
    });

    // Open the selector modal
    fireEvent.click(screen.getByRole('button', { name: 'Assign to series' }));

    await waitFor(() => {
      expect(screen.getByTestId('series-selector-mock')).toBeInTheDocument();
    });

    // Select a series from the mock
    fireEvent.click(screen.getByText('Select Mock Series'));

    await waitFor(() => {
      // The old test checked for 'Part of a series' as the link name, but now we expect the matched series title
      // We mocked useSeries with { series: [{ id: 'mock-series-1', ... }] } above, so if the group has seriesId: 'mock-series-1', it shows the title 'Mock Series'.
      // In the current test group, seriesId is 'mock-series-1' assigned above.
      expect(updateGroupDetail).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: 'mock-series-1' })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith('Assigned to series');
      expect(screen.queryByTestId('series-selector-mock')).not.toBeInTheDocument(); // modal closes
    });
  });

  it('handles editing and unlinking an existing series assignment', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({ seriesId: 'mock-series-1' }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Mock Series' })).toHaveAttribute('href', '/series/mock-series-1');
    });

    // Edit flow
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(screen.getByTestId('series-selector-mock')).toBeInTheDocument());

    // Test the close button mechanism of the mock
    fireEvent.click(screen.getByText('Close Selector'));
    await waitFor(() => expect(screen.queryByTestId('series-selector-mock')).not.toBeInTheDocument());

    // Unlink flow
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(updateGroupDetail).toHaveBeenCalledWith(
        expect.objectContaining({ seriesId: null })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith('Unlinked from series');
    });
  });

  it('shows error toast when assigning series fails', async () => {
    updateGroupDetail.mockRejectedValueOnce(new Error('Assign series failed'));

    render(<GroupDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Assign to series' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Assign to series' }));
    await waitFor(() => expect(screen.getByTestId('series-selector-mock')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Select Mock Series'));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to assign series');
    });
  });

  it('shows error toast when unlinking series fails', async () => {
    mockUseGroupDetail.mockReturnValue({
      group: createMockGroup({ seriesId: 'mock-series-1' }),
      loading: false,
      error: null,
      updateGroupDetail,
      addMeetingDate,
      updateMeetingDate,
      removeMeetingDate,
      deleteGroupDetail,
    } as any);

    updateGroupDetail.mockRejectedValueOnce(new Error('Unlink series failed'));

    render(<GroupDetailPage />);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to unlink series');
    });
  });

  // This test uses fake timers and must be last to avoid polluting other tests
  it('auto-saves edited group details and meeting date after debounce', async () => {
    const { unmount } = render(<GroupDetailPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Family Group')).toBeInTheDocument();
    });

    // Switch to fake timers after component has rendered and settled
    jest.useFakeTimers();

    const titleInput = screen.getByDisplayValue('Family Group');
    const descriptionTextarea = screen.getByDisplayValue('Group description');
    fireEvent.change(titleInput, { target: { value: '  Updated Group  ' } });
    fireEvent.change(descriptionTextarea, { target: { value: '  Updated Description  ' } });

    // Also update meeting location
    const locationInput = screen.getByDisplayValue('Hall');
    fireEvent.change(locationInput, { target: { value: 'New Hall' } });

    // Advance past debounce delay (500ms) + saved status timer (2000ms)
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });

    expect(updateGroupDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Updated Group',
        description: 'Updated Description',
        status: 'active',
      })
    );

    // Meeting date should be updated (existing meeting id = 'date-1')
    expect(updateMeetingDate).toHaveBeenCalledWith(
      'date-1',
      expect.objectContaining({
        date: '2026-02-11',
        location: 'New Hall',
        audience: 'Youth',
      })
    );

    // Unmount before restoring real timers to flush pending debounces
    unmount();
    jest.useRealTimers();
  });
});
