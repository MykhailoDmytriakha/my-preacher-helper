import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrayerDetailPage from '@/(pages)/(private)/prayers/[id]/page';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockUsePrayerRequests = jest.fn();
let mockSearchParams = new URLSearchParams();

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
  useSearchParams: () => mockSearchParams,
}));

jest.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    // Missing `error` made every failure path throw inside its own catch, which
    // rejected the submit for the WRONG reason and hid whether the page was
    // rethrowing on purpose. A partial mock of a module the code depends on is a
    // test that cannot tell right from wrong.
    error: (...args: unknown[]) => mockToastError(...args),
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

/**
 * MIRRORS THE REAL MODAL'S CONTRACT: it closes on a FULFILLED submit and stays open
 * on a rejected one. The old stub just called `onSubmit` and never closed, so the
 * composed defect was invisible — the page swallowed a refusal (fulfilling the
 * promise), the real modal closed, and the typed answer was destroyed while both
 * halves looked correct in isolation.
 */
const answeredModalClosedAfterSubmit = jest.fn();
jest.mock('@/components/prayer/MarkAnsweredModal', () => ({
  __esModule: true,
  default: ({ onSubmit, onClose }: any) => (
    <div data-testid="mark-answered-modal">
      <button
        onClick={async () => {
          try {
            await onSubmit('Answer text');
            // Reached ONLY on a fulfilled submit — which is precisely why a page that
            // swallows a refusal destroys the answer.
            answeredModalClosedAfterSubmit();
            onClose();
          } catch {
            /* stays open — the answer lives only here */
          }
        }}
      >
        submit answer
      </button>
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
    mockSearchParams = new URLSearchParams();
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

    // The strings are translated now, so the assertion follows the KEYS: hardcoded
    // English here is what let the untranslated text survive in the first place.
    expect(screen.getByText('prayer.notFound')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '← prayer.back' })).toHaveAttribute('href', '/prayers');
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
      // Third argument = the revision this edit was built from, so a save from a
      // tab that never saw another device's change is refused, not applied.
      expect(updatePrayer).toHaveBeenCalledWith(
        'p1',
        {
          title: 'Edited prayer',
          description: 'Edited description',
          tags: ['hope'],
        },
        0,
        // Fourth argument = the VALUES the form opened with. Frozen at open, like
        // the revision: a value read at save time would agree with the server by
        // construction, and the check would protect nothing.
        { title: 'Pray for family', description: 'Need wisdom', tags: ['family', 'hope'] }
      );
      expect(addUpdate).toHaveBeenCalledWith('p1', 'Fresh note');
      expect(setStatus).toHaveBeenCalledWith('p1', 'not_answered');
      // Fourth argument = the revision the answer was built from: the answer is
      // human text, so two devices answering must not overwrite each other.
      expect(setStatus).toHaveBeenCalledWith('p1', 'answered', 'Answer text', 0, {
        status: 'active',
        answerText: null,
      });
      expect(deletePrayer).toHaveBeenCalledWith('p1');
      expect(mockPush).toHaveBeenCalledWith('/prayers');
    });

    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer updated');
    expect(mockToastSuccess).toHaveBeenCalledWith('Update added');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer status changed');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer deleted');
  });

  it('a REFUSED answer keeps the modal open, so the typed text is not destroyed', async () => {
    answeredModalClosedAfterSubmit.mockClear();
    // The page used to catch the refusal and return, which FULFILS the promise — and
    // a fulfilled submit closes the modal. The answer, which lives nowhere but that
    // modal, went with it while a toast said the save had failed.
    const staleError = Object.assign(new Error('refused'), { isStaleWrite: true, actualRevision: 7 });
    const setStatus = jest.fn().mockRejectedValue(staleError);

    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [activePrayer],
      loading: false,
      updatePrayer: jest.fn().mockResolvedValue(undefined),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus,
    });

    render(<PrayerDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark Answered' }));
    fireEvent.click(screen.getByRole('button', { name: 'submit answer' }));

    await waitFor(() => expect(setStatus).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The submit must REJECT, so the modal never reaches its close — that is the
    // only thing standing between a refusal and the loss of the typed answer.
    expect(answeredModalClosedAfterSubmit).not.toHaveBeenCalled();
    expect(answeredModalClosedAfterSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('mark-answered-modal')).toBeInTheDocument();
  });

  it('highlights and scrolls to the exact matched word from a prayer card search target', async () => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockSearchParams = new URLSearchParams('q=Newer&focus=update&updateId=u2');

    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [
        {
          ...activePrayer,
          status: 'answered',
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
      setStatus: jest.fn().mockResolvedValue(undefined),
    });

    try {
      render(<PrayerDetailPage />);

      expect(screen.getByText('Newer')).toHaveTextContent('Newer');

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalled();
      });

      const scrolledElement = scrollIntoView.mock.contexts[0] as unknown as Element;
      expect(scrolledElement?.tagName).toBe('MARK');
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
    }
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

  it('holds a refused ANSWER on the page, not inside the modal that closed', () => {
    // The modal is gone the moment a write fails — the backdrop, the ✕ and a reload
    // all take it. The refused answer has to be somewhere the page itself shows.
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [activePrayer],
      loading: false,
      updatePrayer: jest.fn(),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus: jest.fn(),
      saveConflict: null,
      statusConflict: {
        payload: { id: 'p1', status: 'answered', answerText: 'God provided a job' },
        actualRevision: 4,
      },
      keepMineOnStatusConflict: jest.fn(),
      takeTheirsOnStatusConflict: jest.fn(),
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText(/God provided a job/)).toBeInTheDocument();
  });
});
