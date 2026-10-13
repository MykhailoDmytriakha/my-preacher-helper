import { act, render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { membershipEngineHarness } from '../../../test-utils/membershipEngineHarness';
import { settleEngine } from '../../../test-utils/documentEngineHarness';
import OptionMenu from '@/components/dashboard/OptionMenu';
import { Sermon } from '@/models/models';
import type { ResourceSnapshot } from '@/data-engine/types';

jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));
jest.mock('@/components/ui/DatePickerField', () => ({ __esModule: true, default: ({ value, onChange }: any) =>
  <input aria-label="Date" value={value} onChange={event => onChange(event.target.value)} /> }));

const mockRouterRefresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: mockRouterRefresh,
  }),
}));

const mockInvalidateQueries = jest.fn();
const mockRemoveQueries = jest.fn();
const TEST_OWNER_UID = 'owner-under-test';
const mockSetQueryData = jest.fn();
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
    // Deleting a sermon must EVICT its detail cache entry, or the deleted sermon stays
    // readable from the persisted cache and Back re-opens a live editor over it.
    removeQueries: mockRemoveQueries,
    // The source-note writer merges its one field into the cached list and pairs that with an
    // invalidate; without these the stub client throws the moment a link is saved.
    setQueryData: mockSetQueryData,
    cancelQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));

// The playlist membership sweep hook (used for series add/move/remove) internally
// calls useMutation — stub it so this test's partial react-query mock is enough.
/**
 * The picker's own list comes from the notes cache, which this suite has no QueryClient for.
 * Only the READ is stubbed — the writer under test stays real, because it is the thing these
 * tests are about.
 */
jest.mock('@/hooks/useSermonNoteLinks', () => {
  const actual = jest.requireActual('@/hooks/useSermonNoteLinks');
  return {
    ...actual,
    useStudyNoteDirectory: () => ({
      notes: [
        {
          id: 'note-2',
          userId: 'user-1',
          title: 'A note to tick',
          content: '',
          tags: [],
          scriptureRefs: [],
          isDraft: false,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      loading: false,
      // A known-good list: only then may an unresolved link be shown as "deleted".
      ready: true,
    }),
  };
});

jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'user-1' }, loading: false }),
}));

// Mock the Icons component
jest.mock('@components/Icons', () => ({
  DotsVerticalIcon: () => <div data-testid="dots-vertical-icon" />,
}));

// The edit dialog is engine-owned and has its own suite; here only the menu wiring matters.
jest.mock('@/components/sermon/EngineEditSermonModal', () => ({
  EngineEditSermonModal: ({ sermonId, onClose }: { sermonId: string; onClose: () => void }) => (
    <div data-testid="edit-sermon-modal" data-sermon-id={sermonId}>
      <button onClick={() => onClose()}>Close</button>
    </div>
  ),
}));

jest.mock('@/components/church/ChurchField', () => ({
  __esModule: true,
  default: ({ value, onChange }: any) =>
    <input aria-label="Church" value={value?.name ?? ''} onChange={event => onChange({ id: 'church-typed', name: event.target.value, city: 'City' })} />,
}));

// Mock the entire i18n module
jest.mock('@locales/i18n', () => {}, { virtual: true });

// Mock the useTranslation hook
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { series?: string }) => {
      const translations: { [key: string]: string } = {
        'optionMenu.options': 'Options',
        'optionMenu.edit': 'Edit',
        'optionMenu.delete': 'Delete',
        'optionMenu.deleteConfirm': 'Are you sure you want to delete this sermon?',
        'optionMenu.deleteError': 'Error deleting sermon',
        'common.delete': 'Confirm delete',
        'common.cancel': 'Keep it',
        'workspaces.series.actions.removeFromSeries': 'Remove from Series',
        'workspaces.series.actions.removeFromSeriesKeepsSermon': 'The sermon itself stays.',
      };
      if (key === 'workspaces.series.actions.removeFromSeriesConfirm') {
        return `Remove the sermon from "${options?.series}"?`;
      }

      return translations[key] || key;
    },
    // The source-note picker resolves Bible book names from the active language.
    i18n: { language: 'en' },
  }),
}));

/**
 * The deletion question is the app's own window now, not `window.confirm`: open it, then answer
 * it inside the dialog, the way a person does.
 */
const answerDeleteQuestion = async (answer: 'confirm' | 'cancel') => {
  const dialog = await screen.findByRole('dialog', { name: 'Are you sure you want to delete this sermon?' });
  await act(async () => {
    fireEvent.click(within(dialog).getByRole('button', { name: answer === 'confirm' ? 'Confirm delete' : 'Keep it' }));
  });
};

describe('OptionMenu Component', () => {
  // Default mock sermon
  const mockSermon: Sermon = {
    id: 'sermon-1',
    title: 'Test Sermon',
    verse: 'John 3:16',
    date: '2023-01-01',
    thoughts: [],
    userId: 'user-1', // Add the required userId property
  };
  
  const defaultProps = {
    sermon: mockSermon,
    onDelete: jest.fn(),
    onUpdate: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouterRefresh.mockReset();
  });
  
  /**
   * THE WIRING, not the picker: these two assert that the menu really offers the source-note
   * action and really mounts the dialog. Without them the whole feature could be deleted from
   * this menu while every component and hook test stayed green — which is exactly what an
   * adversarial review pointed out.
   */
  it('offers "link a note" when the sermon has none, and opens the picker', () => {
    render(<OptionMenu {...defaultProps} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);

    const action = screen.getByText('sermon.sourceNotes.menuAdd');
    fireEvent.click(action);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers "change linked notes" once the sermon names one', () => {
    render(<OptionMenu {...defaultProps} sermon={{ ...mockSermon, sourceNoteIds: ['note-1'] }} />);
    fireEvent.click(screen.getByTestId('dots-vertical-icon').closest('button') as HTMLElement);

    expect(screen.getByText('sermon.sourceNotes.menuEdit')).toBeInTheDocument();
    expect(screen.queryByText('sermon.sourceNotes.menuAdd')).not.toBeInTheDocument();
  });

  it('renders correctly with the menu button', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Check the menu button is rendered
    expect(screen.getByTestId('dots-vertical-icon')).toBeInTheDocument();
  });
  
  it('shows options when menu is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Click the menu button
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Check options are displayed
    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });
  
  it('hides menu when clicked outside', () => {
    render(
      <div>
        <div data-testid="outside">Outside</div>
        <OptionMenu {...defaultProps} />
      </div>
    );
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Ensure menu is open
    expect(screen.getByText('Edit')).toBeInTheDocument();
    
    // Click outside
    fireEvent.click(screen.getByTestId('outside'));
    
    // Menu should close
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
  });
  
  it('opens edit modal when Edit button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Check modal is shown
    expect(screen.getByTestId('edit-sermon-modal')).toHaveAttribute('data-sermon-id', 'sermon-1');
  });
  
  it('closes edit modal when Close button is clicked', () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Edit
    fireEvent.click(screen.getByText('Edit'));
    
    // Modal should be open
    expect(screen.getByTestId('edit-sermon-modal')).toBeInTheDocument();
    
    // Click Close in modal
    fireEvent.click(screen.getByText('Close'));
    
    // Modal should close
    expect(screen.queryByTestId('edit-sermon-modal')).not.toBeInTheDocument();
  });
  
  it.each([false, true])('uses one pinned engine form to toggle preached=%s ', async preached => {
    const previous = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
    const sermon: Sermon = { ...mockSermon, isPreached: preached, preachDates: [{
      id: 'date', date: '2099-10-03', status: preached ? 'preached' : 'planned',
      church: { id: 'church', name: 'Named church', city: '' }, createdAt: 'now',
    }] };
    const { id, ...value } = sermon;
    const resource = { collection: 'sermons', id };
    const harness = membershipEngineHarness([{ resource, value: value as never, metadata: null }]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><OptionMenu sermon={sermon} /></DataEngineProvider>);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Options' }));
      fireEvent.click(screen.getByText(preached ? 'optionMenu.markAsNotPreached' : 'optionMenu.markAsPreached'));
      const save = await screen.findByRole('button', { name: 'buttons.save' });
      await waitFor(() => expect(save).toBeEnabled());
      expect(harness.transport.send).not.toHaveBeenCalled();
      fireEvent.click(save);
      await act(async () => { await harness.engine.retry(); await settleEngine(); });
      await waitFor(() => expect(harness.read(resource).value!.isPreached).toBe(!preached));
      expect(harness.transport.send).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previous;
    }
  });

  it('deletes an engine sermon through the engine, leaving a tombstone', async () => {
    const previous = process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons';
    const { id, ...value } = mockSermon;
    const resource = { collection: 'sermons', id };
    const harness = membershipEngineHarness([{ resource, value: value as never, metadata: null }]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const onDelete = jest.fn();
    const view = render(<DataEngineProvider><OptionMenu sermon={mockSermon} onDelete={onDelete} /></DataEngineProvider>);
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Options' }));
      fireEvent.click(screen.getByText('Delete'));
      await answerDeleteQuestion('confirm');
      await waitFor(() => expect(onDelete).toHaveBeenCalledWith(id));
      await act(async () => { await harness.engine.retry(); await settleEngine(); });
      await waitFor(() => expect(harness.read(resource).metadata?.deleted).toBe(true));
    } finally {
      view.unmount();
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS;
      else process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = previous;
    }
  });

  it('asks in the app\'s own window, never in the browser\'s box', async () => {
    const native = jest.spyOn(window, 'confirm');
    render(<OptionMenu {...defaultProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    fireEvent.click(screen.getByText('Delete'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(native).not.toHaveBeenCalled();
    native.mockRestore();
  });

  describe('removing the sermon from its series', () => {
    const series = [{
      id: 'series-1',
      userId: 'user-1',
      title: 'Advent',
      theme: '',
      bookOrTopic: '',
      sermonIds: [],
      items: [{ id: 'item-1', type: 'sermon' as const, refId: 'sermon-1', position: 0 }],
      status: 'active' as const,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }];

    it.each(['move', 'remove'] as const)('uses a pinned engine action for %s', async mode => {
      const { id: sourceId, ...source } = series[0];
      const item = { ...source.items[0], position: 1 }; source.items = [item];
      const harness = membershipEngineHarness([
        { resource: { collection: 'series', id: sourceId }, metadata: null, value: source },
        { resource: { collection: 'series', id: 'target' }, metadata: null, value: { ...source, title: 'Lent', items: [] } },
        { resource: { collection: 'sermons', id: 'sermon-1' }, metadata: null, value: { userId: 'user-1', title: 'Sermon', verse: '', thoughts: [], date: '' } },
      ]);
      jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
      const view = render(<DataEngineProvider><OptionMenu {...defaultProps} series={series as never} /></DataEngineProvider>);
      try {
        fireEvent.click(screen.getByRole('button', { name: 'Options' }));
        fireEvent.click(screen.getByRole('menuitem', { name: mode === 'remove' ? 'Remove from Series' : 'workspaces.series.actions.moveToDifferentSeries' }));
        if (mode === 'move') fireEvent.click(await screen.findByRole('radio', { name: 'Lent' }));
        const save = await screen.findByRole('button', { name: 'common.save' });
        await waitFor(() => expect(save).toBeEnabled()); expect(harness.transport.send).not.toHaveBeenCalled();
        fireEvent.click(save); await act(async () => { await harness.engine.retry(); await settleEngine(); });
        await waitFor(() => expect(harness.read({ collection: 'series', id: sourceId }).value!.items).toEqual([]));
        expect(harness.read({ collection: 'series', id: 'target' }).value!.items).toEqual(mode === 'move' ? [expect.objectContaining({ type: 'sermon', refId: 'sermon-1', position: 1 })] : []);
        expect(harness.transport.send).toHaveBeenCalledTimes(1);
      } finally {
        view.unmount();
      }
    });
  });

  it('does not delete sermon when confirmation is canceled', async () => {
    render(<OptionMenu {...defaultProps} />);
    
    // Open the menu
    fireEvent.click(screen.getByRole('button', { name: 'Options' }));
    
    // Click Delete, then decline in the app's own window
    fireEvent.click(screen.getByText('Delete'));
    await answerDeleteQuestion('cancel');
    
    // Check onDelete was not called
    expect(defaultProps.onDelete).not.toHaveBeenCalled();
  });

});

/**
 * SERMONS ARE ENGINE-OWNED: every action below runs against the REAL engine (only I/O is
 * replaced) and asserts on the stored sermon document, never on a legacy writer's arguments.
 */
describe('OptionMenu on the data engine', () => {
  const resource = { collection: 'sermons', id: 'sermon-1' };
  const noteIds = ['note-1', 'note-2', 'mine', 'from-phone'];
  const baseSermon: Sermon = { id: 'sermon-1', title: 'Test Sermon', verse: 'John 3:16', date: '2023-01-01', thoughts: [], userId: 'user-1' };
  const plannedDate = (church: { id: string; name: string; city: string }) => ({
    id: 'pd-plan', date: '2026-03-10', status: 'planned' as const, church, createdAt: '2026-02-01T00:00:00Z',
  });

  /** `stored` is what the server holds; `shown` is the copy the screen hands the menu. */
  function setup(shown: Sermon, stored: Sermon = shown, props: Partial<React.ComponentProps<typeof OptionMenu>> = {}) {
    const { id: _id, ...value } = stored;
    const harness = membershipEngineHarness([
      { resource, value: value as never, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false } },
      ...noteIds.map((note): ResourceSnapshot => ({ resource: { collection: 'studyNotes', id: note }, metadata: { protocol: 1, generation: 'g', revision: 1, deleted: false },
        value: { userId: 'user-1', title: note, content: '', scriptureRefs: [], tags: [], isDraft: false } })),
    ]);
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
    const view = render(<DataEngineProvider><OptionMenu sermon={shown} {...props} /></DataEngineProvider>);
    return { harness, view, rerender: (next: Sermon) => view.rerender(<DataEngineProvider><OptionMenu sermon={next} {...props} /></DataEngineProvider>) };
  }
  const stored = (harness: ReturnType<typeof setup>['harness']) => harness.read(resource).value!;
  const deliver = (harness: ReturnType<typeof setup>['harness']) => act(async () => { await harness.engine.retry(); await settleEngine(); });
  const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Options' }));
  const settle = () => act(async () => { await settleEngine(); });
  async function saveEngineForm() {
    const save = await screen.findByRole('button', { name: 'buttons.save' });
    await waitFor(() => expect(save).toBeEnabled());
    await settle();
    fireEvent.click(save);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'buttons.save' })).not.toBeInTheDocument());
  }
  const noteBox = () => (screen.getByText('A note to tick').closest('label') as HTMLElement).querySelector('input') as HTMLInputElement;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS = 'sermons,series';
  });
  afterEach(() => { delete process.env.NEXT_PUBLIC_DATA_ENGINE_COLLECTIONS; });

  describe('marking and unmarking preached', () => {
    it('keeps dates but downgrades them to planned when unmarking a preached sermon', async () => {
      const church = { id: 'c1', name: 'Test Church', city: 'City' };
      const preached: Sermon = { ...baseSermon, isPreached: true, preachDates: [
        { id: 'pd1', date: '2024-01-15', status: 'preached', church, createdAt: '2024-01-01T00:00:00Z' },
        { id: 'pd2', date: '2024-01-20', status: 'preached', church: { id: 'c2', name: 'Another Church', city: 'City2' }, createdAt: '2024-01-01T00:00:00Z' },
      ] };
      const { harness, view } = setup(preached);
      openMenu();
      fireEvent.click(screen.getByText('optionMenu.markAsNotPreached'));
      await saveEngineForm();
      await deliver(harness);
      await waitFor(() => expect(stored(harness).isPreached).toBe(false));
      expect(stored(harness).preachDates).toEqual([
        expect.objectContaining({ id: 'pd1', status: 'planned' }), expect.objectContaining({ id: 'pd2', status: 'planned' }),
      ]);
      view.unmount();
    });

    it('marks the sermon preached on its existing planned date, keeping that date and its church', async () => {
      const planned: Sermon = { ...baseSermon, isPreached: false, preachDates: [plannedDate({ id: 'c1', name: 'Test Church', city: 'City' })] };
      const { harness, view } = setup(planned);
      openMenu();
      fireEvent.click(screen.getByText('optionMenu.markAsPreached'));
      await screen.findByLabelText('Date');
      expect(screen.getByLabelText('Church')).toHaveValue('Test Church');
      await saveEngineForm();
      await deliver(harness);
      await waitFor(() => expect(stored(harness).isPreached).toBe(true));
      expect(stored(harness).preachDates).toEqual([expect.objectContaining({ id: 'pd-plan', date: '2026-03-10', status: 'preached', church: expect.objectContaining({ name: 'Test Church' }) })]);
      view.unmount();
    });

    it('collects details when the planned date holds the stand-in church, offering the sermon\'s own congregation', async () => {
      const planned: Sermon = { ...baseSermon, isPreached: false, church: { id: 'c-grace', name: 'Grace Chapel', city: 'Fresno' },
        preachDates: [plannedDate({ id: 'church-unspecified', name: 'Church not specified', city: '' })] };
      const { harness, view } = setup(planned);
      openMenu();
      fireEvent.click(screen.getByText('optionMenu.markAsPreached'));
      await waitFor(() => expect(screen.getByLabelText('Church')).toHaveValue('Grace Chapel'));

      fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Test Church' } });
      fireEvent.change(screen.getByLabelText('calendar.audience'), { target: { value: 'Youth' } });
      await saveEngineForm();
      await deliver(harness);
      await waitFor(() => expect(stored(harness).isPreached).toBe(true));
      expect(stored(harness).preachDates).toEqual([expect.objectContaining({ id: 'pd-plan', status: 'preached', audience: 'Youth', church: expect.objectContaining({ name: 'Test Church' }) })]);
      view.unmount();
    });

    it('asks for a church before saving when the preferred date has an empty church name', async () => {
      const planned: Sermon = { ...baseSermon, preachDates: [plannedDate({ id: 'c1', name: '   ', city: '' })] };
      const { view } = setup(planned);
      openMenu();
      fireEvent.click(screen.getByText('optionMenu.markAsPreached'));
      const date = await screen.findByLabelText('Date');
      await waitFor(() => expect(date).toBeEnabled());
      await settle();
      expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
      fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Named now' } });
      await waitFor(() => expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled());
      view.unmount();
    });

    it('adds a preached date when the sermon has none', async () => {
      const { harness, view } = setup(baseSermon);
      openMenu();
      fireEvent.click(screen.getByText('optionMenu.markAsPreached'));
      const date = await screen.findByLabelText('Date');
      await waitFor(() => expect(date).toBeEnabled());
      await settle();
      fireEvent.change(date, { target: { value: '2024-01-21' } });
      fireEvent.change(screen.getByLabelText('Church'), { target: { value: 'Test Church' } });
      fireEvent.change(screen.getByLabelText('calendar.audience'), { target: { value: 'Youth' } });
      await saveEngineForm();
      await deliver(harness);
      await waitFor(() => expect(stored(harness).isPreached).toBe(true));
      expect(stored(harness).preachDates).toEqual([expect.objectContaining({ date: '2024-01-21', status: 'preached', audience: 'Youth', church: expect.objectContaining({ name: 'Test Church' }) })]);
      view.unmount();
    });
  });

  describe('deleting', () => {
    it('SPEAKS when the engine cannot take the deletion: the screen is not told and the person gets a reason', async () => {
      // No engine under the menu: nothing reports for this action, so silence would be the defect.
      const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
      const onDelete = jest.fn();
      render(<OptionMenu sermon={baseSermon} onDelete={onDelete} />);
      openMenu();
      fireEvent.click(screen.getByText('Delete'));
      await answerDeleteQuestion('confirm');
      await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Error deleting sermon'));
      expect(onDelete).not.toHaveBeenCalled();
      alertSpy.mockRestore();
    });
  });

  describe('source-note links', () => {
    const openPicker = (label: string) => { openMenu(); fireEvent.click(screen.getByText(label)); };

    it('re-arms the proof after a refusal, so a deliberate second press can win', async () => {
      // Found in the browser, not by a unit test: adopting the stored LIST is only half the exit. The
      // second press must also vouch for something the engine recognises, or the same click is
      // refused for ever — a dead end dressed as a safety feature.
      const shown: Sermon = { ...baseSermon, sourceNoteIds: ['mine'], rev: { core: 3 } };
      const { harness, view } = setup(shown, { ...baseSermon, sourceNoteIds: ['from-phone'] });
      openPicker('sermon.sourceNotes.menuEdit');
      await settle();

      // Tick another note, or there is nothing to save and the writer is skipped by design.
      fireEvent.click(noteBox());
      fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));
      // Refused: the stored list is handed back and shown, and nothing was sent.
      await screen.findByTestId('missing-note-row');
      await waitFor(() => expect(noteBox()).toBeEnabled());
      expect(harness.transport.send).not.toHaveBeenCalled();
      expect(stored(harness).sourceNoteIds).toEqual(['from-phone']);

      fireEvent.click(noteBox());
      fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));
      await deliver(harness);
      await waitFor(() => expect(stored(harness).sourceNoteIds).toEqual(['from-phone', 'note-2']));
      view.unmount();
    });

    it('keeps the opening proof even if the sermon underneath refreshes while the picker is open', async () => {
      // The picker holds the ticks it opened with; if the proof were re-read from the refreshed
      // prop, the guard would bless overwriting whatever the other device just stored.
      const opened: Sermon = { ...baseSermon, sourceNoteIds: ['mine'], rev: { core: 3 } };
      const { harness, view, rerender } = setup(opened, { ...baseSermon, sourceNoteIds: ['from-phone'] });
      openPicker('sermon.sourceNotes.menuEdit');
      await settle();

      // Another device's write arrives and the page re-renders underneath the open dialog.
      rerender({ ...baseSermon, sourceNoteIds: ['from-phone'], rev: { core: 9 } });
      fireEvent.click(noteBox());
      fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

      await screen.findByTestId('missing-note-row');
      await deliver(harness);
      expect(stored(harness).sourceNoteIds).toEqual(['from-phone']);
      expect(harness.transport.send).not.toHaveBeenCalled();
      view.unmount();
    });

    it('still writes when the person toggles away and back to the same set', async () => {
      // "Same as when I opened it" is not "nothing to do": a deliberate choice must reach the engine
      // and tell the screen. Without `force` this press would be swallowed.
      const onUpdate = jest.fn();
      const shown: Sermon = { ...baseSermon, sourceNoteIds: ['note-2'], rev: { core: 3 } };
      const { harness, view } = setup(shown, shown, { onUpdate });
      openPicker('sermon.sourceNotes.menuEdit');
      await settle();

      // Re-queried each time: the row re-renders between clicks and a captured node can detach.
      fireEvent.click(noteBox()); // untick
      fireEvent.click(noteBox()); // tick again — back to the opening set
      fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

      await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ sourceNoteIds: ['note-2'] })));
      await deliver(harness);
      expect(stored(harness).sourceNoteIds).toEqual(['note-2']);
      view.unmount();
    });

    it('keeps the copy it was given whole — a link save must not drop detail-only fields', async () => {
      // A design that chose between a "newer" list copy and a fuller detail copy by one counter could
      // drop `scratch`/`thoughts` from the screen. The menu applies a PATCH to the copy its own screen
      // handed it, so there is nothing to choose.
      const onUpdate = jest.fn();
      const fullCopy = { ...baseSermon, sourceNoteIds: [], rev: { core: 3 },
        scratch: [{ id: 'sc1', text: 'only the detail copy has this', createdAt: '2026-08-16' }] } as Sermon;
      const { harness, view } = setup(fullCopy, { ...baseSermon, sourceNoteIds: [] }, { onUpdate });
      openPicker('sermon.sourceNotes.menuAdd');
      await settle();
      fireEvent.click(noteBox());
      fireEvent.click(screen.getByText('sermon.sourceNotes.picker.save'));

      await waitFor(() => expect(onUpdate).toHaveBeenCalled());
      const published = onUpdate.mock.calls[0][0] as Sermon;
      expect(published.sourceNoteIds).toEqual(['note-2']);
      expect(published.scratch).toHaveLength(1);
      await deliver(harness);
      expect(stored(harness).sourceNoteIds).toEqual(['note-2']);
      view.unmount();
    });
  });
});
