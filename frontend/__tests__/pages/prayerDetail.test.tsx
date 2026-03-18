import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrayerDetailPage from '@/(pages)/(private)/prayers/[id]/page';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
const mockToastSuccess = jest.fn();
const mockUsePrayerRequests = jest.fn();

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'p1' }),
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { uid: 'user-1' },
  }),
}));

jest.mock('@/hooks/usePrayerRequests', () => ({
  usePrayerRequests: () => mockUsePrayerRequests(),
}));

jest.mock('@/components/prayer/PrayerStatusBadge', () => ({
  __esModule: true,
  default: ({ status }: { status: string }) => <div data-testid="prayer-status-badge">{status}</div>,
}));

jest.mock('@/components/prayer/CreatePrayerModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="edit-modal">
      <button onClick={() => onSubmit({ title: 'Edited prayer', description: 'Edited description', tags: ['hope'] })}>
        submit edit
      </button>
      <button onClick={onClose}>close edit</button>
    </div>
  ),
}));

jest.mock('@/components/prayer/AddUpdateModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="add-update-modal">
      <button onClick={() => onSubmit('Fresh note')}>submit update</button>
      <button onClick={onClose}>close update</button>
    </div>
  ),
}));

jest.mock('@/components/prayer/MarkAnsweredModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="mark-answered-modal">
      <button onClick={() => onSubmit('Answer text')}>submit answer</button>
      <button onClick={onClose}>close answer</button>
    </div>
  ),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        'prayer.title': 'Prayer Journal',
        'prayer.toast.updated': 'Prayer updated',
        'prayer.toast.deleted': 'Prayer deleted',
        'prayer.toast.updateAdded': 'Update added',
        'prayer.toast.statusChanged': 'Prayer status changed',
        'prayer.actions.addUpdate': 'Add Update',
        'prayer.actions.markAnswered': 'Mark Answered',
        'prayer.actions.markNotAnswered': 'Mark Not Answered',
        'prayer.actions.markActive': 'Mark Active',
        'prayer.actions.edit': 'Edit',
        'prayer.actions.delete': 'Delete',
        'prayer.delete.confirm_button': 'Delete forever',
        'prayer.detail.addedOn': 'Added on',
        'prayer.detail.updatedOn': 'Updated on',
        'prayer.detail.answeredOn': 'Answered on',
        'prayer.detail.updates': 'Updates',
        'prayer.detail.noUpdates': 'No updates yet',
        'prayer.answerText.label': 'God answered',
        'prayer.answerText.edit': 'Edit answer',
        'prayer.answerText.add': 'Add answer',
      };

      return translations[key] || key;
    },
  }),
}));

describe('PrayerDetailPage', () => {
  const activePrayer = {
    id: 'p1',
    userId: 'user-1',
    title: 'Pray for family',
    description: 'Need wisdom',
    tags: ['family', 'hope'],
    status: 'active',
    updates: [],
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-02T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [activePrayer],
      loading: false,
      updatePrayer: jest.fn().mockResolvedValue(undefined),
      deletePrayer: jest.fn().mockResolvedValue(undefined),
      addUpdate: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
    });
  });

  it('renders loading skeletons while the page is fetching', () => {
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [],
      loading: true,
      updatePrayer: jest.fn(),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus: jest.fn(),
    });

    const { container } = render(<PrayerDetailPage />);

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders the not-found state when the prayer is missing', () => {
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [],
      loading: false,
      updatePrayer: jest.fn(),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus: jest.fn(),
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText('Prayer request not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← Back' })).toHaveAttribute('href', '/prayers');
  });

  it('handles edit, update, status, and delete flows for active prayers', async () => {
    const updatePrayer = jest.fn().mockResolvedValue(undefined);
    const deletePrayer = jest.fn().mockResolvedValue(undefined);
    const addUpdate = jest.fn().mockResolvedValue(undefined);
    const setStatus = jest.fn().mockResolvedValue(undefined);

    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [activePrayer],
      loading: false,
      updatePrayer,
      deletePrayer,
      addUpdate,
      setStatus,
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText('Pray for family')).toBeInTheDocument();
    expect(screen.getByText('No updates yet')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit edit' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Update' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit update' }));

    fireEvent.click(screen.getByRole('button', { name: 'Mark Not Answered' }));

    fireEvent.click(screen.getByRole('button', { name: 'Mark Answered' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit answer' }));

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('button', { name: 'Delete forever?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever?' }));

    await waitFor(() => {
      expect(updatePrayer).toHaveBeenCalledWith('p1', {
        title: 'Edited prayer',
        description: 'Edited description',
        tags: ['hope'],
      });
      expect(addUpdate).toHaveBeenCalledWith('p1', 'Fresh note');
      expect(setStatus).toHaveBeenCalledWith('p1', 'not_answered');
      expect(setStatus).toHaveBeenCalledWith('p1', 'answered', 'Answer text');
      expect(deletePrayer).toHaveBeenCalledWith('p1');
      expect(mockPush).toHaveBeenCalledWith('/prayers');
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer updated');
    expect(mockToastSuccess).toHaveBeenCalledWith('Update added');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer status changed');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer deleted');
  });

  it('renders answered prayers, update timeline, and the restore action', async () => {
    const setStatus = jest.fn().mockResolvedValue(undefined);

    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [
        {
          ...activePrayer,
          status: 'answered',
          answeredAt: '2026-03-03T00:00:00.000Z',
          answerText: 'God answered this prayer.',
          updates: [
            { id: 'u1', text: 'Older update', createdAt: '2026-03-02T00:00:00.000Z' },
            { id: 'u2', text: 'Newer update', createdAt: '2026-03-04T00:00:00.000Z' },
          ],
        },
      ],
      loading: false,
      updatePrayer: jest.fn().mockResolvedValue(undefined),
      deletePrayer: jest.fn().mockResolvedValue(undefined),
      addUpdate: jest.fn().mockResolvedValue(undefined),
      setStatus,
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText('God answered')).toBeInTheDocument();
    expect(screen.getByText('God answered this prayer.')).toBeInTheDocument();
    expect(screen.getByText('Older update')).toBeInTheDocument();
    expect(screen.getByText('Newer update')).toBeInTheDocument();
    expect(screen.getByText('(2)')).toBeInTheDocument();
    expect(screen.getByTestId('prayer-status-badge')).toHaveTextContent('answered');

    fireEvent.click(screen.getByRole('button', { name: 'Mark Active' }));

    await waitFor(() => {
      expect(setStatus).toHaveBeenCalledWith('p1', 'active');
    });
  });
});
