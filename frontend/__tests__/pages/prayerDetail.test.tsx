import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import PrayerDetailPage from '@/(pages)/(private)/prayers/[id]/page';
import { awaitAcceptance, persistedWrite } from '@/utils/recoverableWrite';
import '@testing-library/jest-dom';

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockToastSuccess = jest.fn();
const mockToastError = jest.fn();
const mockUsePrayerRequests = jest.fn();
const mockUsePrayerDetail = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockRouteParams: { id?: string } = { id: 'p1' };

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock('next/navigation', () => ({
  useParams: () => mockRouteParams,
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  // The verse window a reference opens reads where the reader came from.
  usePathname: () => '/prayers/p1',
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

jest.mock('@/hooks/usePrayerDetail', () => ({
  usePrayerDetail: (...args: unknown[]) => mockUsePrayerDetail(...args),
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
            await awaitAcceptance(onSubmit('Answer text'), () => undefined);
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
  it('wires separate physical copy choices for prayer text and its answer', () => {
    const saveCopies = ['first-save', 'second-save'].map((key, index) => ({ key, documentId: 'p1', value: { payload: { id: 'p1', updates: { title: `Saved prayer ${index}` } }, actualRevision: index } }));
    const statusCopies = ['first-status', 'second-status'].map((key, index) => ({ key, documentId: 'p1', value: { payload: { id: 'p1', status: 'answered', answerText: `Saved answer ${index}` }, actualRevision: index } }));
    const chooseSave = jest.fn(); const chooseStatus = jest.fn();
    mockUsePrayerRequests.mockReturnValue({ ...mockUsePrayerRequests(), saveConflict: saveCopies[0].value,
      statusConflict: statusCopies[0].value, resolvingConflict: false,
      saveConflictChoices: { copies: saveCopies, selectedKey: saveCopies[0].key, activation: 0, select: chooseSave },
      statusConflictChoices: { copies: statusCopies, selectedKey: statusCopies[0].key, activation: 0, select: chooseStatus } });
    render(<PrayerDetailPage />);
    const pickers = screen.getAllByRole('combobox', { name: 'unsavedDraft.chooseCopy' });
    expect(pickers).toHaveLength(2);
    fireEvent.change(pickers[0], { target: { value: 'second-save' } });
    fireEvent.change(pickers[1], { target: { value: 'second-status' } });
    expect(chooseSave).toHaveBeenCalledWith('second-save');
    expect(chooseStatus).toHaveBeenCalledWith('second-status');
  });

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
    mockRouteParams = { id: 'p1' };
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [activePrayer],
      loading: false,
      updatePrayer: jest.fn(() => persistedWrite(Promise.resolve())),
      deletePrayer: jest.fn(() => persistedWrite(Promise.resolve())),
      addUpdate: jest.fn(() => persistedWrite(Promise.resolve())),
      setStatus: jest.fn(() => persistedWrite(Promise.resolve())),
    });
    mockUsePrayerDetail.mockReturnValue({ prayer: activePrayer, isLoading: false });
  });

  it('opens the prayer named by the actual offline address when router params are empty', () => {
    mockRouteParams = {};
    window.history.replaceState(null, '', '/prayers/offline-prayer');
    mockUsePrayerDetail.mockImplementation((id: string) => ({ prayer: id === 'offline-prayer' ? activePrayer : null, isLoading: false }));
    const view = render(<PrayerDetailPage />);
    try {
      expect(screen.getByText('Pray for family')).toBeInTheDocument();
      expect(screen.getByText('Need wisdom')).toBeInTheDocument();
    } finally { view.unmount(); window.history.replaceState(null, '', '/'); }
  });

  it('renders the single-document result when the cached list is empty', () => {
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [],
      loading: false,
      updatePrayer: jest.fn(),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus: jest.fn(),
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText('Pray for family')).toBeInTheDocument();
    expect(screen.queryByText('prayer.notFound')).not.toBeInTheDocument();
  });

  // Case 2026-10-12-block-diagram, L8: a reference in a prayer opens its verse, as in a note or a group.
  it('makes a reference in the prayer, its answer and its updates a link to the verse', () => {
    const withVerses = {
      ...activePrayer,
      description: 'Просим мудрости по Иак 1:5',
      status: 'answered',
      answerText: 'Ответ пришёл, как в Флп 4:19',
      updates: [{ id: 'u1', text: 'Держимся Рим 8:28', createdAt: '2026-03-02T00:00:00.000Z' }],
    };
    mockUsePrayerDetail.mockReturnValue({ prayer: withVerses, isLoading: false });
    mockUsePrayerRequests.mockReturnValue({ ...mockUsePrayerRequests(), prayerRequests: [withVerses] });

    const { container } = render(<PrayerDetailPage />);

    const links = Array.from(container.querySelectorAll('[data-scripture-link]')).map((link) => link.textContent);
    expect(links).toEqual(expect.arrayContaining(['Иак 1:5', 'Флп 4:19', 'Рим 8:28']));
  });

  // Codex review 2026-10-27: one line alone does not say the prayer's language — «1Цар» is 1 Samuel in Russian and
  // 1 Kings in Ukrainian; and the title, read like the rest, links too.
  it('reads a reference in the language of the whole prayer, and links one in its title', () => {
    const ukrainian = { ...activePrayer, title: 'Молимося за мудрість, як Соломон: 1Цар 3:9', description: 'Почуй і дай', updates: [{ id: 'u1', text: '1Цар 3:5', createdAt: '2026-03-02T00:00:00.000Z' }] };
    mockUsePrayerDetail.mockReturnValue({ prayer: ukrainian, isLoading: false });
    mockUsePrayerRequests.mockReturnValue({ ...mockUsePrayerRequests(), prayerRequests: [ukrainian] });

    const { container } = render(<PrayerDetailPage />);

    const links = Array.from(container.querySelectorAll('[data-scripture-link]'));
    expect(links.map((link) => link.textContent)).toEqual(expect.arrayContaining(['1Цар 3:9', '1Цар 3:5']));
    // Read in Ohienko under a Russian interface: the mark beside each link names it.
    expect(container.querySelectorAll('[data-scripture-bible]').length).toBeGreaterThanOrEqual(2);
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
    expect(container.querySelector('[data-page-loading]')).not.toBeNull();
  });

  it('renders the shared not-found state only for a confirmed missing prayer', () => {
    mockUsePrayerDetail.mockReturnValue({ prayer: null, isLoading: false,
      presence: { kind: 'absent', source: 'server',
        snapshot: { resource: { collection: 'prayerRequests', id: 'p1' }, value: null, metadata: null } },
      refresh: jest.fn() });
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [],
      loading: false,
      updatePrayer: jest.fn(),
      deletePrayer: jest.fn(),
      addUpdate: jest.fn(),
      setStatus: jest.fn(),
    });

    render(<PrayerDetailPage />);

    expect(screen.getByText('recordAvailability.notFound')).toBeInTheDocument();
    expect(screen.queryByText('recordAvailability.notHereYet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    expect(mockPush).toHaveBeenCalledWith('/prayers');
  });

  it('does not call a failed unread prayer missing and retries that prayer read', async () => {
    const refresh = jest.fn(async () => undefined);
    mockUsePrayerDetail.mockReturnValue({ prayer: null, isLoading: false,
      presence: { kind: 'unknown', source: null, snapshot: null }, refresh });
    render(<PrayerDetailPage />);
    expect(screen.queryByText('prayer.notFound')).not.toBeInTheDocument();
    expect(screen.getByText('recordAvailability.notHereYet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataSync.retry' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'common.back' }));
    expect(mockPush).toHaveBeenCalledWith('/prayers');
  });

  it('shows a pending explicit deletion without inventing completed absence', () => {
    mockUsePrayerDetail.mockReturnValue({ prayer: null, isLoading: false,
      presence: { kind: 'deleting', source: 'local',
        snapshot: { resource: { collection: 'prayerRequests', id: 'p1' }, value: activePrayer, metadata: null } },
      refresh: jest.fn() });
    render(<PrayerDetailPage />);
    expect(screen.queryByText('prayer.notFound')).not.toBeInTheDocument();
    expect(screen.getByText('recordAvailability.deleting')).toBeInTheDocument();
  });

  it('handles edit, update, status, and delete flows for active prayers', async () => {
    const updatePrayer = jest.fn(() => persistedWrite(Promise.resolve()));
    const deletePrayer = jest.fn(() => persistedWrite(Promise.resolve()));
    const addUpdate = jest.fn(() => persistedWrite(Promise.resolve()));
    const setStatus = jest.fn(() => persistedWrite(Promise.resolve()));

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
      // replace, not push — the deleted prayer must not stay one Back away (BUG-20260905).
      expect(mockReplace).toHaveBeenCalledWith('/prayers');
    });

    // Editor-owned messages belong to their modals. The page itself only announces
    // a direct status change after a persisted acceptance.
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Prayer updated');
    expect(mockToastSuccess).toHaveBeenCalledWith('Prayer status changed');
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Update added');
    expect(mockToastSuccess).not.toHaveBeenCalledWith('Prayer deleted');
  });

  it('a REFUSED answer keeps the modal open, so the typed text is not destroyed', async () => {
    answeredModalClosedAfterSubmit.mockClear();
    // The page used to catch the refusal and return, which FULFILS the promise — and
    // a fulfilled submit closes the modal. The answer, which lives nowhere but that
    // modal, went with it while a toast said the save had failed.
    const staleError = Object.assign(new Error('refused'), { isStaleWrite: true, actualRevision: 7 });
    const setStatus = jest.fn(() => persistedWrite(Promise.reject(staleError)));

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

    const prayerWithUpdates = {
      ...activePrayer,
      status: 'answered',
      updates: [
        { id: 'u1', text: 'Older update', createdAt: '2026-03-02T00:00:00.000Z' },
        { id: 'u2', text: 'Newer update', createdAt: '2026-03-04T00:00:00.000Z' },
      ],
    };
    mockUsePrayerDetail.mockReturnValue({ prayer: prayerWithUpdates, isLoading: false });
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [prayerWithUpdates],
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

  // BUG-20261027-plan-scrolls-back-to-section, its class: the address's way in is taken once — the prayer saved or
  // coming again from the server never scrolls back to the target and flashes it again.
  it('scrolls once and removes its arrival ring even when the prayer changes', async () => {
    jest.useFakeTimers();
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const scrollIntoView = jest.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mockSearchParams = new URLSearchParams('q=update&focus=update&updateId=u2');
    const prayerWithUpdates = {
      ...activePrayer,
      updates: [{ id: 'u2', text: 'An update', createdAt: '2026-03-04T00:00:00.000Z' }],
    };
    mockUsePrayerDetail.mockReturnValue({ prayer: prayerWithUpdates, isLoading: false });
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [prayerWithUpdates],
      loading: false,
      updatePrayer: jest.fn().mockResolvedValue(undefined),
      deletePrayer: jest.fn().mockResolvedValue(undefined),
      addUpdate: jest.fn().mockResolvedValue(undefined),
      setStatus: jest.fn().mockResolvedValue(undefined),
    });
    try {
      const { rerender } = render(<PrayerDetailPage />);
      act(() => { jest.advanceTimersByTime(50); });
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      const target = document.getElementById('prayer-update-u2');
      expect(target).toHaveClass('ring-2');
      mockUsePrayerDetail.mockReturnValue({ prayer: { ...prayerWithUpdates, title: 'Saved a moment ago' }, isLoading: false });
      rerender(<PrayerDetailPage />);
      act(() => { jest.advanceTimersByTime(2200); });
      expect(target).not.toHaveClass('ring-2');
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
    } finally {
      Element.prototype.scrollIntoView = originalScrollIntoView;
      jest.useRealTimers();
    }
  });

  it('renders answered prayers, update timeline, and the restore action', async () => {
    const setStatus = jest.fn().mockResolvedValue(undefined);

    const answeredPrayer = {
      ...activePrayer,
      status: 'answered',
      answeredAt: '2026-03-03T00:00:00.000Z',
      answerText: 'God answered this prayer.',
      updates: [
        { id: 'u1', text: 'Older update', createdAt: '2026-03-02T00:00:00.000Z' },
        { id: 'u2', text: 'Newer update', createdAt: '2026-03-04T00:00:00.000Z' },
      ],
    };
    mockUsePrayerDetail.mockReturnValue({ prayer: answeredPrayer, isLoading: false });
    mockUsePrayerRequests.mockReturnValue({
      prayerRequests: [answeredPrayer],
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

  it('lets the refused ANSWER own the screen — no second banner for the same event', () => {
    /**
     * This page has TWO conflict kinds: a refused edit and a refused answer/status change.
     * A refused answer once showed two banners and four competing actions for one event.
     * The conflict banner holds the person's text, so it is the only one on screen.
     */
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

    expect(screen.getByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.queryByText('freshness.title')).not.toBeInTheDocument();
  });
});
