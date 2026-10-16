import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import GroupDetailPage from '@/(pages)/(private)/groups/[id]/page';
import { useSeries } from '@/hooks/useSeries';
import { useAuth } from '@/providers/AuthProvider';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { membershipEngineHarness } from '../../test-utils/membershipEngineHarness';
import { documentEngineHarness, settleEngine } from '../../test-utils/documentEngineHarness';
import { hasGroupsAccess } from '@/services/userSettings.service';

jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('@/hooks/useStickyOffsets', () => ({
  ...jest.requireActual('@/hooks/useStickyOffsets'),
  useStickyOffsets: () => ({ setHeaderRef: jest.fn(), navHeight: 65, belowHeader: 65 }),
}));

jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

const mockPush = jest.fn();
const mockReplace = jest.fn();
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
    replace: mockReplace,
  }),
  // A reference in a block opens the Bible with the way back here.
  usePathname: () => '/groups/group-1',
  useSearchParams: () => new URLSearchParams(),
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

jest.mock('@/hooks/useSeries', () => ({
  useSeries: jest.fn(() => ({ series: [{ id: 'mock-series-1', title: 'Mock Series', color: '#000000' }] })),
}));

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: jest.fn(() => ({ user: { uid: 'user-1' } })),
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: () => ({ settings: { firstDayOfWeek: 'sunday' } }),
}));

jest.mock('react-day-picker/dist/style.css', () => ({}));

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

const mockUseSeries = useSeries as jest.MockedFunction<typeof useSeries>;
const mockUseAuth = jest.mocked(useAuth);
const mockHasGroupsAccess = hasGroupsAccess as jest.MockedFunction<typeof hasGroupsAccess>;
const mockToastSuccess = toast.success as jest.MockedFunction<typeof toast.success>;

// The membership sweep exposes stable spies (see the jest.mock factory above).

const DEFAULT_SERIES = [{ id: 'mock-series-1', title: 'Mock Series', color: '#000000' }];
// A series whose items list this group — so the derive shows the linked chip.
const SERIES_WITH_GROUP = [
  {
    id: 'mock-series-1',
    title: 'Mock Series',
    color: '#000000',
    items: [{ id: 'group-group-1', type: 'group', refId: 'group-1', position: 1 }],
  },
];

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
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as any);
    mockHasGroupsAccess.mockResolvedValue(false);
    mockUseParams.mockReturnValue({ id: 'group-1' });
    mockUseSeries.mockReturnValue({ series: DEFAULT_SERIES } as any);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Seeds the stored group document and renders the page inside a real DataEngineProvider. */
  function setupGroupPage(overrides: Partial<any> = {}, { cached = true }: { cached?: boolean } = {}) {
    const { id: _id, ...value } = createMockGroup(overrides);
    const harness = documentEngineHarness(
      { resource: { collection: 'groups', id: 'group-1' },
        metadata: { protocol: 1, generation: 'group-generation', revision: 1, deleted: false }, value },
      { cached },
    );
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><GroupDetailPage /></DataEngineProvider>);
    // Pushes everything the page queued to the (fake) server and returns what it now stores.
    // `pagehide` makes the editor save now instead of waiting out its autosave delay.
    const delivered = async () => {
      // First let the edit land in the draft and the editor re-arm its page-hide listener ...
      await act(async () => { await settleEngine(); });
      await act(async () => { window.dispatchEvent(new Event('pagehide')); await settleEngine(); });
      await act(async () => { await harness.engine.retry(); await settleEngine(); });
      return harness.server.value as any;
    };
    return { harness, view, delivered };
  }

  it('shows a loading skeleton before the document arrives', async () => {
    setupGroupPage({}, { cached: false });
    expect(document.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    expect(screen.queryByDisplayValue('Family Group')).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue('Family Group')).toBeInTheDocument();
    expect(document.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });

  it('shows the load error when the group no longer exists', async () => {
    const harness = documentEngineHarness({ resource: { collection: 'groups', id: 'group-1' },
      metadata: { protocol: 1, generation: 'group-generation', revision: 2, deleted: true }, value: null },
    { cached: false });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    render(<DataEngineProvider><GroupDetailPage /></DataEngineProvider>);

    expect(await screen.findByText('Failed to load group')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete group' })).not.toBeInTheDocument();
  });

  it('populates meeting date fields from group data', async () => {
    setupGroupPage();

    expect(await screen.findByDisplayValue('2026-02-11')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hall')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Youth')).toBeInTheDocument();
  });

  it('never lets one long word widen the page: its columns may shrink below their widest word', async () => {
    // A grid column sized `1fr` or `auto` grows to its longest unbreakable word: a pasted link in a
    // block note or content made the page 1298 px on an 820 px iPad and hid "Start meeting"
    // (BUG-20261010-group-long-note-pushes-start-off-screen). `grid-cols-1` and `minmax(0,1fr)`
    // give the tracks a zero minimum. jsdom lays nothing out; the width is measured in WebKit.
    setupGroupPage();
    await screen.findByDisplayValue('Family Group');

    const pageGrid = screen.getByRole('heading', { name: 'Group Flow' }).closest('.grid');
    expect(pageGrid).toHaveClass('grid-cols-1', 'xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]');
  });

  it('deletes the group only after confirmation, removes it from the store and replaces the route with /groups', async () => {
    const { harness, delivered } = setupGroupPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete group' }));
    expect(await screen.findByText(/Delete this group permanently\?/)).toBeInTheDocument();

    // Cancelling changes nothing.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await delivered();
    expect(harness.server.value).not.toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    // replace, not push: the page we are leaving is the group that was just deleted,
    // so it must not stay one Back away — BUG-20260905.
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/groups'));
    expect(mockPush).not.toHaveBeenCalled();
    await delivered();
    expect(harness.server.value).toBeNull();
  });

  it.each([true, false])('opens immediately without a beta check when online is %s', async (online) => {
    const onlineSpy = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    try {
      const { view } = setupGroupPage();

      expect(await screen.findByRole('button', { name: 'Delete group' })).toBeInTheDocument();
      expect(mockUseSeries).toHaveBeenCalledWith('user-1');
      expect(mockHasGroupsAccess).not.toHaveBeenCalled();
      expect(screen.queryByText('Groups workspace is disabled')).not.toBeInTheDocument();
      view.unmount();
    } finally {
      onlineSpy.mockRestore();
    }
  });

  it('hides the editor when signed out', async () => {
    const { view } = setupGroupPage();
    expect(await screen.findByRole('button', { name: 'Delete group' })).toBeInTheDocument();

    mockUseAuth.mockReturnValue({ user: null } as any);
    view.rerender(<DataEngineProvider><GroupDetailPage /></DataEngineProvider>);

    expect(screen.queryByRole('button', { name: 'Delete group' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(mockUseSeries).toHaveBeenLastCalledWith(null);
  });

  it('renders empty flow placeholder when no blocks exist', async () => {
    setupGroupPage({ templates: [], flow: [], meetingDates: [] });

    expect(await screen.findByText('No blocks yet')).toBeInTheDocument();
  });

  it('stores flow add, edit and delete actions in the group document', async () => {
    const { delivered } = setupGroupPage();
    await screen.findByDisplayValue('Family Group');

    // Add a block: the new template and flow item are stored together.
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main topic' }));
    let stored = await delivered();
    expect(stored.templates).toHaveLength(2);
    expect(stored.flow).toHaveLength(2);

    // Edit the original block through the side editor.
    fireEvent.click(screen.getAllByText('Main topic')[0]);
    fireEvent.change(await screen.findByLabelText('Block Name (Template)'), { target: { value: 'Updated Block' } });
    fireEvent.change(screen.getByLabelText('Duration (min)'), { target: { value: '30' } });
    stored = await delivered();
    expect(stored.templates.find((template: any) => template.id === 'tpl-1').title).toBe('Updated Block');
    expect(stored.flow.find((item: any) => item.id === 'flow-1').durationMin).toBe(30);

    // Cycle the block status (filled -> empty).
    fireEvent.click(screen.getByTitle('Filled'));
    stored = await delivered();
    expect(stored.templates.find((template: any) => template.id === 'tpl-1').status).toBe('empty');

    // Delete the original block: its flow item and its now unreferenced template go away.
    fireEvent.click(screen.getAllByRole('button', { name: 'More options' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    stored = await delivered();
    expect(stored.flow.map((item: any) => item.id)).not.toContain('flow-1');
    expect(stored.templates.map((template: any) => template.id)).not.toContain('tpl-1');
    expect(stored.flow).toHaveLength(1);
  });

  it('pins the block editor below the measured app nav and bounds it to the window', async () => {
    setupGroupPage();
    await screen.findByDisplayValue('Family Group');
    fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Main topic' }));
    fireEvent.click(screen.getAllByText('Main topic')[0]);
    const field = await screen.findByLabelText('Block Name (Template)');

    const panel = field.closest('[class~="xl:sticky"]') as HTMLElement;
    expect(panel).not.toBeNull();
    // 65px nav + 16px gap: the panel's own header is never hidden under the nav.
    expect(panel.style.top).toBe('81px');
    // jsdom lays nothing out (top 0), so the panel counts as stuck: window 768 - 81 - 16.
    expect(panel.style.getPropertyValue('--flow-editor-max-h')).toBe('671px');
  });

  it('stores the new flow order after a drag-end reorder', async () => {
    const templates = [
      { id: 'tpl-1', type: 'topic', title: 'Main topic', content: 'Discussion content', status: 'filled',
        scriptureRefs: [], questions: [], createdAt: 'x', updatedAt: 'x' },
      { id: 'tpl-2', type: 'notes', title: 'Second block', content: 'Second block content', status: 'draft',
        scriptureRefs: [], questions: [], createdAt: 'x', updatedAt: 'x' },
    ];
    const flow = [
      { id: 'flow-1', templateId: 'tpl-1', order: 1, durationMin: 25 },
      { id: 'flow-2', templateId: 'tpl-2', order: 2, durationMin: 10 },
    ];
    const { harness, delivered } = setupGroupPage({ templates, flow });
    await screen.findByDisplayValue('Family Group');
    expect((harness.server.value as any).flow.map((item: any) => item.id)).toEqual(['flow-1', 'flow-2']);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger drag end' }));

    const stored = await delivered();
    expect(stored.flow.map((item: any) => [item.id, item.order])).toEqual([['flow-2', 1], ['flow-1', 2]]);
  });

  it('stores a meeting date when there is no existing date', async () => {
    const { delivered } = setupGroupPage({ meetingDates: [] });
    await screen.findByDisplayValue('Family Group');

    const dateInput = screen.getByPlaceholderText('No date') as HTMLInputElement;
    fireEvent.focus(dateInput);
    fireEvent.change(dateInput, { target: { value: '2026-03-01' } });

    const stored = await delivered();
    expect(stored.meetingDates).toHaveLength(1);
    expect(stored.meetingDates[0]).toEqual(expect.objectContaining({ date: '2026-03-01' }));
  });

  it('removes the meeting date from the store when the date field is cleared', async () => {
    const { delivered } = setupGroupPage();
    const dateInput = await screen.findByDisplayValue('2026-02-11');

    fireEvent.change(dateInput, { target: { value: '' } });

    const stored = await delivered();
    expect(stored.meetingDates).toEqual([]);
  });

  it('stores edited title, description and meeting location', async () => {
    const { delivered } = setupGroupPage();
    fireEvent.change(await screen.findByDisplayValue('Family Group'), { target: { value: 'Updated Group' } });

    fireEvent.change(screen.getByDisplayValue('Group description'), { target: { value: 'Updated Description' } });
    fireEvent.change(screen.getByDisplayValue('Hall'), { target: { value: 'New Hall' } });

    const stored = await delivered();
    expect(stored.title).toBe('Updated Group');
    expect(stored.description).toBe('Updated Description');
    expect(stored.meetingDates[0]).toEqual(expect.objectContaining({ id: 'date-1', date: '2026-02-11', location: 'New Hall', audience: 'Youth' }));
    // Untouched content is carried over unchanged.
    expect(stored.status).toBe('active');
    expect(stored.flow.map((item: any) => item.id)).toEqual(['flow-1']);
  });

});

describe('GroupDetailPage with the actual data engine', () => {
  function setupEnginePage() {
    mockUseParams.mockReturnValue({ id: 'group-1' });
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as ReturnType<typeof useAuth>);
    const harness = documentEngineHarness({ resource: { collection: 'groups', id: 'group-1' },
      metadata: { protocol: 1, generation: 'group-generation', revision: 1, deleted: false }, value: {
        userId: 'user-1', title: 'Engine group', status: 'draft', templates: [], flow: [], meetingDates: [], createdAt: 'created', updatedAt: 'old',
      } });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    function Workspace({ show = true }) {
      return <DataEngineProvider>{show && <GroupDetailPage />}</DataEngineProvider>;
    }
    return { ...harness, harness, Workspace, view: render(<Workspace />) };
  }
  it('reads the group during silent storage and becomes editable when the editor opens', async () => {
    const { trackStorage, resetDeviceStorageForTests, STORAGE_SILENCE_MS, STORAGE_WAKE_GRACE_MS } = await import('@/utils/deviceStorage');
    jest.useFakeTimers(); resetDeviceStorageForTests();
    mockUseParams.mockReturnValue({ id: 'group-1' });
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as ReturnType<typeof useAuth>);
    const harness = documentEngineHarness({ resource: { collection: 'groups', id: 'group-1' },
      metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false }, value: {
        userId: 'user-1', title: 'Prepared group', description: 'Description to read', status: 'draft', templates: [], flow: [], createdAt: 'created', updatedAt: 'old',
      } });
    let finishOpening!: () => void;
    jest.mocked(createBrowserDataEngine).mockImplementation(() => {
      const browser = harness.createBrowser(); const open = browser.engine.openEditor.bind(browser.engine);
      jest.spyOn(browser.engine, 'openEditor').mockImplementation((...args) => new Promise(resolve => {
        finishOpening = () => { void open(...args).then(resolve); };
      }));
      return browser;
    });
    const view = render(<DataEngineProvider><GroupDetailPage /></DataEngineProvider>);
    void trackStorage('engine-state', new Promise(() => undefined));
    await act(async () => { await jest.advanceTimersByTimeAsync(STORAGE_SILENCE_MS + STORAGE_WAKE_GRACE_MS + 10); });
    await screen.findByRole('heading', { name: 'Prepared group' });
    expect(screen.getByText('Description to read')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    await act(async () => { finishOpening(); await settleEngine(); });
    expect(await screen.findByDisplayValue('Prepared group')).toBeEnabled();
    expect(harness.transport.send).not.toHaveBeenCalled();
    view.unmount(); resetDeviceStorageForTests(); jest.useRealTimers();
  });
  it('uses one pinned engine action for series assignment', async () => {
    mockUseParams.mockReturnValue({ id: 'group-1' });
    mockUseAuth.mockReturnValue({ user: { uid: 'user-1' } } as ReturnType<typeof useAuth>);
    mockUseSeries.mockReturnValue({ series: [] } as never);
    const item = { id: 'group-group-1', type: 'group', refId: 'group-1', position: 1 };
    const harness = membershipEngineHarness([
      { resource: { collection: 'groups', id: 'group-1' }, metadata: null, value: {
        userId: 'user-1', title: 'Engine group', status: 'draft', templates: [], flow: [], meetingDates: [], createdAt: 'created', updatedAt: 'old',
      } },
      ...['Source', 'Target'].map(id => ({ resource: { collection: 'series', id }, metadata: null,
        value: { userId: 'user-1', title: id, items: id === 'Source' ? [item] : [], sermonIds: [], seriesKind: 'group' } })),
    ]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><GroupDetailPage /></DataEngineProvider>);
    await screen.findByDisplayValue('Engine group');
    fireEvent.click(screen.getByRole('button', { name: 'Assign to series' }));
    const target = await screen.findByRole('radio', { name: 'Target' }); fireEvent.click(target);
    await act(async () => { await settleEngine(); }); expect(harness.transport.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common.save' }));
    await act(async () => { await harness.engine.retry(); await settleEngine(); });
    await waitFor(() => expect(harness.read({ collection: 'series', id: 'Target' }).value!.items).toEqual([item]));
    expect(harness.read({ collection: 'series', id: 'Source' }).value!.items).toEqual([]);
    expect(harness.transport.send).toHaveBeenCalledTimes(1); view.unmount();
  });
  it('durably owns the last keystroke before navigation and delivers it on reconnect', async () => {
    const { harness, Workspace, view } = setupEnginePage();
    const input = await screen.findByDisplayValue('Engine group');
    act(() => harness.engine.setOnline(false));
    fireEvent.change(input, { target: { value: 'Last offline keystroke' } });
    view.rerender(<Workspace show={false} />);
    await act(async () => { await settleEngine(); });
    const commits = await harness.commits.list('user-1');
    expect(commits.some(commit => commit.command?.kind === 'update' && commit.command.changes.some(change =>
      change.path[0] === 'title' && change.after.value === 'Last offline keystroke'))).toBe(true);
    expect(harness.server.value?.title).toBe('Engine group');
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
    expect(harness.server.value?.title).toBe('Last offline keystroke');
    view.rerender(<Workspace />);
    expect(await screen.findByDisplayValue('Last offline keystroke')).toBeInTheDocument();
    view.unmount();
  });
  it('adopts clean remote text while focused and preserves a later competing local edit', async () => {
    const { harness, view } = setupEnginePage();
    const input = await screen.findByDisplayValue('Engine group');
    fireEvent.focus(input);
    await act(async () => { await harness.remote({ title: 'Remote clean text' }); });
    expect(input).toHaveValue('Remote clean text');
    act(() => harness.engine.setOnline(false));
    fireEvent.change(input, { target: { value: 'Local competing text' } });
    await act(async () => { await settleEngine(); });
    // The server advances while this editor owns an offline draft.
    await act(async () => { await harness.remote({ title: 'Remote competing text' }); });
    expect(input).toHaveValue('Local competing text');
    await act(async () => { harness.engine.setOnline(true); await harness.engine.retry(); await settleEngine(); });
    fireEvent.blur(input);
    await act(async () => { await settleEngine(); });
    expect(input).toHaveValue('Local competing text');
    expect(harness.server.value?.title).toBe('Remote competing text');
    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'freshness.conflictTakeTheirs' }));
    await waitFor(() => expect(input).toHaveValue('Remote competing text'));
    view.unmount();
  });
});
