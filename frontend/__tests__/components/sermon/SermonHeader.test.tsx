import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

import SermonHeader, { type SermonHeaderEditor } from '@/components/sermon/SermonHeader';
import { DataSyncStatus, type DataSyncStatusProps } from '@/data-engine/DataSyncStatus';
import { Sermon, Series } from '@/models/models';
import { getExportContent } from '@utils/exportContent';
import '@testing-library/jest-dom';

let latestExportProps: any = null;

jest.mock('@/data-engine/DataSyncStatus', () => ({
  DataSyncStatus: jest.fn((props: DataSyncStatusProps) => <div data-testid="canonical-sync-status">
    {props.status?.phase}{props.error}
    <button onClick={props.onKeepLocal}>Canonical keep local</button>
    <button onClick={props.onAcceptRemote}>Canonical accept remote</button>
    <button onClick={props.onRetry}>Canonical retry</button>
  </div>),
}));

type TestEditor = SermonHeaderEditor & { changed: () => void };

/** A complete editor whose bindings are jest.fn and whose forms re-render the header on change. */
const buildEditor = (values: { title: string; verse: string }, overrides: Partial<SermonHeaderEditor> = {}): TestEditor => {
  const editor: TestEditor = {
    subject: 'sermon-subject', values, isReadOnly: false,
    status: { phase: 'queued', freshness: 'cache', checking: false, readFailed: false, hasForeignChange: false, canSave: false, canAcceptRemote: false, canKeepLocal: false, canRemove: false },
    error: null, changed: () => undefined,
    titleForm: form(values.title), verseForm: form(values.verse),
    keepLocal: jest.fn(async () => undefined), acceptRemote: jest.fn(async () => undefined), retry: jest.fn(async () => undefined),
    ...overrides,
  };
  function form(value: string): SermonHeaderEditor['titleForm'] {
    const binding = {
      active: false, busy: false, value,
      begin: jest.fn(async () => { binding.active = true; editor.changed(); }),
      update: jest.fn(async (text: string) => { binding.value = text; editor.changed(); }),
      save: jest.fn(async (_text: string) => { binding.active = false; editor.changed(); }),
      cancel: jest.fn(async () => { binding.active = false; editor.changed(); }),
    };
    return binding;
  }
  return editor;
};

const renderHeader = (sermon: Sermon, editor: TestEditor, series?: Series[]) => {
  const view = render(<SermonHeader sermon={sermon} series={series} editor={editor} />);
  editor.changed = () => view.rerender(<SermonHeader sermon={sermon} series={series} editor={editor} />);
  return view;
};

describe('SermonHeader canonical editor injection', () => {
  const sermon: Sermon = { id: 'canonical-sermon', userId: 'owner', title: 'Legacy title', verse: 'Legacy verse', date: '2026-09-12', thoughts: [] };
  const editor = () => buildEditor({ title: 'Canonical title', verse: 'Canonical verse' });
  const renderCanonical = (canonical: TestEditor) => renderHeader(sermon, canonical);
  beforeEach(() => { jest.clearAllMocks(); });

  it('renders canonical title and verse and delegates their saves to the editor forms', async () => {
    const canonical = editor();
    const view = renderCanonical(canonical);
    expect(screen.getByRole('heading', { name: 'Canonical title' })).toBeInTheDocument();
    expect(screen.getByText('Canonical verse')).toBeInTheDocument();
    expect(screen.getByTestId('canonical-sync-status')).toHaveTextContent('queued');
    // Lifecycle actions (dates, series, delete) run through the engine, so the menu stays.
    expect(screen.getByTestId('option-menu')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle('Edit')[0]);
    await waitFor(() => expect(screen.getByTitle('Save')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Canonical title'), { target: { value: 'Typed title' } });
    fireEvent.click(screen.getByTitle('Save'));
    await waitFor(() => expect(canonical.titleForm.save).toHaveBeenCalledWith('Typed title'));
    await waitFor(() => expect(screen.queryByTitle('Save')).not.toBeInTheDocument());
    view.rerender(<SermonHeader sermon={sermon} editor={{ ...canonical, values: { ...canonical.values, title: 'Typed title' } }} />);
    expect(screen.getByRole('heading', { name: 'Typed title' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle('Edit')[1]);
    await waitFor(() => expect(screen.getByTitle('Save')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Canonical verse'), { target: { value: 'Typed verse' } });
    fireEvent.click(screen.getByTitle('Save'));
    await waitFor(() => expect(canonical.verseForm.save).toHaveBeenCalledWith('Typed verse'));
  });

  it('uses canonical conflict actions and error text', async () => {
    const canonical = editor(); canonical.error = 'Local persistence failed';
    render(<SermonHeader sermon={sermon} editor={canonical} />);
    const props = jest.mocked(DataSyncStatus).mock.calls.at(-1)![0];
    expect(props.status).toBe(canonical.status); expect(props.error).toBe(canonical.error);
    await props.onKeepLocal?.(); await props.onAcceptRemote?.(); await props.onRetry?.();
    expect(canonical.keepLocal).toHaveBeenCalledTimes(1); expect(canonical.acceptRemote).toHaveBeenCalledTimes(1); expect(canonical.retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('freshness.conflictTitle')).not.toBeInTheDocument();
  });

  it('retains the open form on a canonical command failure', async () => {
    const canonical = editor(); jest.mocked(canonical.titleForm.save).mockRejectedValueOnce(new Error('Disk unavailable'));
    renderCanonical(canonical);
    fireEvent.click(screen.getAllByTitle('Edit')[0]);
    await waitFor(() => expect(screen.getByTitle('Save')).toBeInTheDocument());
    fireEvent.change(screen.getByDisplayValue('Canonical title'), { target: { value: 'Never discard this' } });
    fireEvent.click(screen.getByTitle('Save'));
    expect(await screen.findByText('Failed to save title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Never discard this')).toBeInTheDocument();
  });

  it('locks owner-disabled or deleted canonical editors and hides lifecycle actions', () => {
    const canonical = editor(); canonical.isReadOnly = true;
    const view = render(<SermonHeader sermon={sermon} editor={canonical} />);
    screen.getAllByTitle('Edit').forEach(button => expect(button).toBeDisabled());
    expect(screen.queryByTestId('option-menu')).not.toBeInTheDocument();
    view.rerender(<SermonHeader sermon={sermon} editor={{ ...canonical, isReadOnly: false, status: { ...canonical.status!, phase: 'deleted' } }} />);
    screen.getAllByTitle('Edit').forEach(button => expect(button).toBeDisabled());
    expect(screen.getByRole('heading', { name: 'Canonical title' })).toBeInTheDocument();
    expect(canonical.titleForm.begin).not.toHaveBeenCalled(); expect(canonical.verseForm.begin).not.toHaveBeenCalled();
  });

  it('keeps canonical empty values distinct from populated sermon values while status initializes', () => {
    const canonical = editor(); canonical.values = { title: '', verse: '' }; canonical.status = null;
    render(<SermonHeader sermon={sermon} editor={canonical} />);
    expect(screen.queryByText('Legacy title')).not.toBeInTheDocument();
    expect(screen.queryByText('Legacy verse')).not.toBeInTheDocument();
    expect(jest.mocked(DataSyncStatus).mock.calls.at(-1)![0].status).toBeNull();
    // Lifecycle actions (dates, series, delete) run through the engine, so the menu stays.
    expect(screen.getByTestId('option-menu')).toBeInTheDocument();
  });
});

// Mock dependencies
jest.mock('@/providers/ConnectionProvider', () => ({
  useConnection: jest.fn(() => ({ isOnline: true, isMagicAvailable: true, checkConnection: jest.fn() })),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), message: jest.fn(), success: jest.fn() }
}));

jest.mock('@utils/dateFormatter', () => ({
  formatDate: jest.fn(() => '2024-01-15')
}));

jest.mock('@utils/exportContent', () => ({
  getExportContent: jest.fn(() => Promise.resolve('exported content'))
}));

// Mock @headlessui/react
jest.mock('@headlessui/react', () => {
  const MockMenu = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="menu">{children}</div>
  );

  const MockMenuButton = ({ children, ...props }: { children: React.ReactNode;[key: string]: any }) => (
    <button {...props}>{children}</button>
  );

  const MockMenuItems = ({ children, ...props }: { children: React.ReactNode;[key: string]: any }) => (
    <div {...props}>{children}</div>
  );

  const MockMenuItem = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  MockMenu.Button = MockMenuButton;
  MockMenu.Items = MockMenuItems;
  MockMenu.Item = MockMenuItem;

  const MockTransition = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;

  return {
    Menu: MockMenu,
    Transition: MockTransition,
  };
});


// OptionMenu (reused from the dashboard for sermon-level actions) pulls in React Query /
// router; stub it here so SermonHeader stays a focused unit test. OptionMenu has its own tests.
jest.mock('@/components/dashboard/OptionMenu', () => {
  return function MockOptionMenu() {
    return <div data-testid="option-menu">Option Menu</div>;
  };
});

/**
 * The source-note chips read the notes cache, which this suite has no provider for — and
 * stubbing them keeps these tests about the header itself, as the other children already are.
 * The stub still ECHOES the sermon it was handed, so the wiring stays under test here while
 * the chips' own behaviour is proven in `app/components/sermon/__tests__`.
 */
jest.mock('@/components/sermon/SourceNoteChips', () => {
  const MockSourceNoteChips = ({ sermon }: { sermon: { id: string } }) => (
    <span data-testid="source-note-chips">{sermon.id}</span>
  );
  MockSourceNoteChips.displayName = 'MockSourceNoteChips';
  return { __esModule: true, default: MockSourceNoteChips };
});

jest.mock('@/components/ExportButtons', () => ({
  __esModule: true,
  default: (props: any) => {
    latestExportProps = props;
    return (
      <div data-testid="export-buttons">
        {props.extraButtons}
        <button type="button">TXT</button>
        <button type="button">PDF</button>
        <button type="button">Word</button>
      </div>
    );
  },
}));

jest.mock('@/hooks/useUserSettings', () => ({
  useUserSettings: jest.fn(() => ({
    settings: {
      enablePrepMode: true,
      enableAudioGeneration: true
    },
    loading: false,
    error: null,
    refresh: jest.fn()
  }))
}));

// Mock translations
jest.mock('react-i18next', () => ({
  useTranslation: () => {
    const translations: Record<string, string> = {
      'editSermon.verseLabel': 'Scripture Verse',
      'editSermon.versePlaceholder': 'Enter scripture verse',
      'common.save': 'Save',
      'common.cancel': 'Cancel',
      'common.edit': 'Edit',
      'common.editTitleInput': 'Edit title input',
      'errors.failedToSaveVerse': 'Failed to save verse',
      'errors.failedToSaveTitle': 'Failed to save title',
      'plan.preachButton': 'Preach',
      'workspaces.series.actions.editSeries': 'Change series',
      'workspaces.series.actions.removeFromSeries': 'Remove from series',
      'workspaces.series.actions.addSermon': 'Add sermon to series',
      'workspaces.series.badges.partOfSeries': 'Part of Series'
    };

    return {
      t: (key: string) => translations[key] || key
    };
  },
}));


/** The verse's paragraph by its whole text: the reference it opens with is a link of its own. */
const versePart = (text: string) => (_: string, element: Element | null) => element?.tagName === 'P' && element.textContent === text;

describe('SermonHeader Component', () => {
  const mount = (sermon: Sermon, series?: Series[], overrides: Partial<SermonHeaderEditor> = {}) => {
    const editor = buildEditor({ title: sermon.title, verse: sermon.verse ?? '' }, overrides);
    renderHeader(sermon, editor, series);
    return editor;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    latestExportProps = null;
  });

  const mockSermon: Sermon = {
    id: 'test-sermon-id',
    title: 'Test Sermon Title',
    verse: 'John 3:16 - For God so loved the world that he gave his one and only Son',
    date: '2024-01-15',
    userId: 'test-user-id',
    thoughts: [],
    outline: {
      introduction: [],
      main: [],
      conclusion: []
    },
    isPreached: false,
    preparation: {}
  };

  describe('Rendering', () => {
    it('renders basic structure', () => {
      mount(mockSermon);

      expect(screen.getByRole('heading', { name: 'Test Sermon Title' })).toBeInTheDocument();
      expect(screen.getByText(versePart('John 3:16 - For God so loved the world that he gave his one and only Son'))).toBeInTheDocument();
      expect(screen.getByTestId('export-buttons')).toBeInTheDocument();
    });

    it('opens the passage the verse names in the Bible, with the way back to this sermon', () => {
      const push = jest.fn();
      const navigation = jest.requireMock<{ useRouter: () => unknown }>('next/navigation');
      const useRouter = jest.spyOn(navigation, 'useRouter').mockReturnValue({ push });
      try {
        mount(mockSermon);
        fireEvent.click(screen.getByRole('button', { name: 'John 3:16' }));
        const href = new URL(String(push.mock.calls[0]?.[0]), 'https://app.test');
        expect(href.pathname).toBe('/bible');
        expect(Object.fromEntries(href.searchParams)).toMatchObject({ book: 'john', at: '3:16', to: '16', from: `/sermons/${mockSermon.id}` });
      } finally {
        useRouter.mockRestore();
      }
    });

    it('hands the sermon to the source-note chips, in the identity row', () => {
      mount(mockSermon);

      // Proves the wiring, not the chip: the header must mount it and give it THIS sermon,
      // or provenance would silently stop appearing while every other assertion stayed green.
      expect(screen.getByTestId('source-note-chips')).toHaveTextContent(mockSermon.id);
    });

    it('renders without verse when verse is empty', () => {
      const sermonWithoutVerse = { ...mockSermon, verse: '' };
      mount(sermonWithoutVerse);

      expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
      expect(screen.queryByText('John 3:16 - For God so loved the world that he gave his one and only Son')).not.toBeInTheDocument();
    });

    it('renders export buttons', () => {
      mount(mockSermon);

      // Export buttons should be present (they're rendered by ExportButtons component)
      expect(screen.getByText('TXT')).toBeInTheDocument();
      expect(screen.getByText('PDF')).toBeInTheDocument();
      expect(screen.getByText('Word')).toBeInTheDocument();
    });

    it('passes plan data to export buttons when plan exists', () => {
      const sermonWithPlan: Sermon = {
        ...mockSermon,
        plan: {
          introduction: { outline: 'Intro outline' },
          main: { outline: '' },
          conclusion: { outline: '' },
        },
      };

      mount(sermonWithPlan);

      expect(latestExportProps?.planData).toEqual({
        sermonTitle: sermonWithPlan.title,
        sermonVerse: sermonWithPlan.verse,
        introduction: 'Intro outline',
        main: '',
        conclusion: '',
      });
    });

    it('exposes export content callbacks for plain and PDF', async () => {
      mount(mockSermon);

      await latestExportProps.getExportContent('plain', { includeTags: true });
      expect(getExportContent).toHaveBeenCalledWith(mockSermon, undefined, {
        format: 'plain',
        includeTags: true,
      });

      const pdfContent = await latestExportProps.getPdfContent();
      expect(React.isValidElement(pdfContent)).toBe(true);
    });

    it('passes export type (plan/thoughts) to export function', async () => {
      mount(mockSermon);

      await latestExportProps.getExportContent('plain', { includeTags: false, type: 'plan' });
      expect(getExportContent).toHaveBeenCalledWith(mockSermon, undefined, {
        format: 'plain',
        includeTags: false,
        type: 'plan'
      });
    });

    it('opens the preaching plan inside the app, without reloading the page', () => {
      // A full reload freezes the sermon page Safari keeps for Back, and its unfinished write holds the
      // device storage the plan reads (BUG-20261020-released-page-back-says-local-failure).
      const push = jest.fn();
      const navigation = jest.requireMock<{ useRouter: () => unknown }>('next/navigation');
      const useRouter = jest.spyOn(navigation, 'useRouter').mockReturnValue({ push });
      const before = window.location.href;
      try {
        mount(mockSermon);
        fireEvent.click(screen.getByTitle('Preach'));
        expect(push).toHaveBeenCalledWith(`/sermons/${mockSermon.id}/plan?planView=preaching`);
        expect(window.location.href).toBe(before);
      } finally {
        useRouter.mockRestore();
      }
    });
  });

  describe('Title Editing', () => {
    it('sends the edited title to the editor title form', async () => {
      const editor = mount(mockSermon);

      fireEvent.click(screen.getAllByTitle('Edit')[0]);
      fireEvent.change(await screen.findByDisplayValue('Test Sermon Title'), { target: { value: 'Updated Title' } });
      fireEvent.click(screen.getByTitle('Save'));

      await waitFor(() => expect(editor.titleForm.save).toHaveBeenCalledWith('Updated Title'));
      expect(editor.verseForm.save).not.toHaveBeenCalled();
    });

    it('keeps the typed title and shows the error when the title form rejects the save', async () => {
      const editor = buildEditor({ title: mockSermon.title, verse: mockSermon.verse });
      jest.mocked(editor.titleForm.save).mockRejectedValueOnce(new Error('Save failed'));
      renderHeader(mockSermon, editor);

      fireEvent.click(screen.getAllByTitle('Edit')[0]);
      fireEvent.change(await screen.findByDisplayValue('Test Sermon Title'), { target: { value: 'Updated Title' } });
      fireEvent.click(screen.getByTitle('Save'));

      expect(await screen.findByText('Failed to save title')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Updated Title')).toBeInTheDocument();
    });
  });

  describe('Verse Editing', () => {
    const verseText = 'John 3:16 - For God so loved the world that he gave his one and only Son';

    it('sends the edited verse to the editor verse form', async () => {
      const editor = mount(mockSermon);

      fireEvent.click(screen.getAllByTitle('Edit')[1]);
      fireEvent.change(await screen.findByDisplayValue(verseText), { target: { value: 'Updated verse text' } });
      fireEvent.click(screen.getByTitle('Save'));

      await waitFor(() => expect(editor.verseForm.save).toHaveBeenCalledWith('Updated verse text'));
      expect(editor.titleForm.save).not.toHaveBeenCalled();
    });

    it('keeps the typed verse and shows the error when the verse form rejects the save', async () => {
      const editor = buildEditor({ title: mockSermon.title, verse: mockSermon.verse });
      jest.mocked(editor.verseForm.save).mockRejectedValueOnce(new Error('Save failed'));
      renderHeader(mockSermon, editor);

      fireEvent.click(screen.getAllByTitle('Edit')[1]);
      fireEvent.change(await screen.findByDisplayValue(verseText), { target: { value: 'Updated verse text' } });
      fireEvent.click(screen.getByTitle('Save'));

      expect(await screen.findByText('Failed to save verse')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Updated verse text')).toBeInTheDocument();
    });

    it('allows adding verse when sermon has no verse', async () => {
      const sermonWithoutVerse = { ...mockSermon, verse: '' };
      const editor = buildEditor({ title: sermonWithoutVerse.title, verse: '' });
      const { rerender } = renderHeader(sermonWithoutVerse, editor);

      expect(screen.queryByText(verseText)).not.toBeInTheDocument();

      rerender(<SermonHeader sermon={sermonWithoutVerse} editor={{ ...editor, values: { title: sermonWithoutVerse.title, verse: 'New verse text' } }} />);

      expect(screen.getByText('New verse text')).toBeInTheDocument();
    });

    it('passes a multi-line verse to the verse form unchanged', async () => {
      const multiLineVerse = 'John 3:16\nFor God so loved the world\nthat he gave his one and only Son';
      const editor = mount(mockSermon);

      fireEvent.click(screen.getAllByTitle('Edit')[1]);
      fireEvent.change(await screen.findByDisplayValue(verseText), { target: { value: multiLineVerse } });
      fireEvent.click(screen.getByTitle('Save'));

      await waitFor(() => expect(editor.verseForm.save).toHaveBeenCalledWith(multiLineVerse));
    });
  });

  describe('Keyboard Shortcuts', () => {
    const verseText = 'John 3:16 - For God so loved the world that he gave his one and only Son';

    it('supports Ctrl+Enter to save verse', async () => {
      const editor = mount(mockSermon);

      fireEvent.click(screen.getAllByTitle('Edit')[1]);
      const verseTextarea = await screen.findByDisplayValue(verseText);
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(verseTextarea, { key: 'Enter', ctrlKey: true });

      await waitFor(() => expect(editor.verseForm.save).toHaveBeenCalledWith('Updated verse text'));
    });

    it('supports Escape to cancel verse editing', async () => {
      const editor = mount(mockSermon);

      fireEvent.click(screen.getAllByTitle('Edit')[1]);
      const verseTextarea = await screen.findByDisplayValue(verseText);
      fireEvent.change(verseTextarea, { target: { value: 'Updated verse text' } });
      fireEvent.keyDown(verseTextarea, { key: 'Escape' });

      // Should return to display mode with original text
      expect(await screen.findByText(versePart(verseText))).toBeInTheDocument();
      expect(editor.verseForm.save).not.toHaveBeenCalled();
    });
  });

  describe('Series Management', () => {
    const mockSeries: Series[] = [
      {
        id: 'series-1',
        title: 'Test Series',
        theme: 'Test Theme',
        bookOrTopic: 'Test Book',
        color: '#FF6B6B',
        userId: 'test-user-id',
        // Membership is DERIVED from series.items/sermonIds now (the sole truth),
        // not the deprecated sermon.seriesId — so the fixture lists this sermon.
        sermonIds: ['test-sermon-id'],
        status: 'active',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z'
      }
    ];

    beforeEach(() => {
      // Mock series service functions
      jest.mock('@/services/series.service', () => ({
        addSermonToSeries: jest.fn(),
        removeSermonFromSeries: jest.fn()
      }));
    });

    it('shows series badge when sermon has seriesId', () => {
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, mockSeries);

      const seriesBadge = screen.getByText('Test Series');
      expect(seriesBadge).toBeInTheDocument();
      expect(seriesBadge.closest('a')).toHaveAttribute('title', 'Part of Series: Test Series');
    });

    it('does not show series badge when sermon is not a member of any series', () => {
      // Not in series.items/sermonIds -> derive returns nothing -> no badge.
      const standaloneSermon = { ...mockSermon, id: 'standalone-sermon-id' };
      mount(standaloneSermon, mockSeries);

      expect(screen.queryByText('Test Series')).not.toBeInTheDocument();
      expect(screen.queryByText('Part of Series')).not.toBeInTheDocument();
    });

    it('renders the sermon actions menu (which now hosts series actions) when in a series', () => {
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, mockSeries);

      // Series actions were unified into the shared OptionMenu (mocked as "option-menu").
      expect(screen.getByTestId('option-menu')).toBeInTheDocument();
    });

    it('renders the sermon actions menu for standalone sermons too', () => {
      mount(mockSermon, mockSeries);

      // Add-to-series lives in the shared OptionMenu now, not a separate header menu.
      expect(screen.getByTestId('option-menu')).toBeInTheDocument();
    });

    it('shows series management dropdown when sermon belongs to series', () => {
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, mockSeries);

      // Should show the dropdown menu button (ellipsis icon)
      const menuButtons = screen.getAllByRole('button');
      const ellipsisButton = menuButtons.find(button =>
        button.querySelector('svg') &&
        button.querySelector('svg')?.getAttribute('class')?.includes('h-4 w-4')
      );
      expect(ellipsisButton).toBeInTheDocument();
    });

    it('series badge links to series page', () => {
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, mockSeries);

      const seriesLink = screen.getByRole('link', { name: /Test Series/ });
      expect(seriesLink).toHaveAttribute('href', '/series/series-1');
    });

    it('series badge has correct styling with color', () => {
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, mockSeries);

      const seriesBadge = screen.getByText('Test Series').closest('a');
      expect(seriesBadge).toHaveStyle({
        backgroundColor: 'rgb(255, 107, 107)',
        color: '#000000'
      });
    });

    it('series badge has default styling when no color', () => {
      const seriesWithoutColor = [{ ...mockSeries[0], color: undefined }];
      const sermonWithSeries = { ...mockSermon, seriesId: 'series-1' };
      mount(sermonWithSeries, seriesWithoutColor);

      // A series with no colour of its own falls back to the shared blue chip token, so the
      // dark plate is the token's `dark:bg-blue-900/50` rather than a local `dark:bg-blue-900`.
      const seriesBadge = screen.getByText('Test Series').closest('a');
      expect(seriesBadge).toHaveClass('bg-blue-100', 'dark:bg-blue-900/50', 'text-blue-800', 'dark:text-blue-200');
      expect(seriesBadge).toHaveClass('rounded-full');
    });
  });

  describe('Component Integration', () => {
    it('hides the sermon actions menu and disables editing when the editor is read-only', () => {
      mount(mockSermon, undefined, { isReadOnly: true });

      expect(screen.queryByTestId('option-menu')).not.toBeInTheDocument();
      screen.getAllByTitle('Edit').forEach(button => expect(button).toBeDisabled());
      expect(screen.getByText('Test Sermon Title')).toBeInTheDocument();
    });

    it('hands the editor status and error to the sync status block', () => {
      const editor = mount(mockSermon, undefined, { error: 'Local persistence failed' });

      const props = jest.mocked(DataSyncStatus).mock.calls.at(-1)![0];
      expect(props.subject).toBe(editor.subject);
      expect(props.status).toBe(editor.status);
      expect(props.error).toBe('Local persistence failed');
    });
  });
});
