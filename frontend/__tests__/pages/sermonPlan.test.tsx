import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import SermonPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page'; // Alias path
import { createBrowserDataEngine } from '@/data-engine/browser.client';
import { DataEngineProvider } from '@/data-engine/react.client';
import { draftKey, saveDraft } from '@/utils/durableDraft';
import '@testing-library/jest-dom';

import { documentEngineHarness } from '../../test-utils/documentEngineHarness';

import type { DocumentData, EngineMetadata } from '@/data-engine/types';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock MutationObserver globally for this test file
global.MutationObserver = jest.fn(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  takeRecords: jest.fn(() => []),
}));

// Mock Next.js router and params
let mockSearchParams = new URLSearchParams();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockToast = toast as jest.Mocked<typeof toast>;

jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'test-sermon-id' }),
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/sermons/test-sermon-id/plan',
}));

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(), // deprecated
    removeListener: jest.fn(), // deprecated
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// The plan page runs on the data engine: it opens the sermon document through the real engine, with
// only the server and the browser transport replaced. Plan text, thoughts and the outline are stored
// through the engine writer, so what a click did is read from the document the server holds.
jest.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { uid: 'test-user' }, loading: false }),
}));
jest.mock('@/data-engine/browser.client', () => ({ createBrowserDataEngine: jest.fn() }));
jest.mock('idb-keyval', () => ({ createStore: jest.fn() }));

jest.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'test-user' }, loading: false }),
}));

// The legacy reader must stay untouched on the engine.
jest.mock('@/services/sermon.service', () => ({
  getSermonById: jest.fn(),
}));

// Mock child components (if any are direct children of the page)
jest.mock('@/components/plan/KeyFragmentsModal', () => {
  const React = require('react');
  return function MockKeyFragmentsModal(props: any) {
    return (
      <div data-testid="key-fragments-modal">
        Mocked Key Fragments Modal
        <button
          type="button"
          data-testid="key-fragments-update-thought"
          onClick={() => {
            void props.onThoughtSave?.({
              id: 't1',
              text: 'Updated Thought',
              outlinePointId: 'intro-p1',
              tags: ['introduction'],
              keyFragments: ['frag1'],
              date: '2024-01-01',
            })?.persistence.catch(() => undefined);
          }}
        >
          Update thought
        </button>
        <button
          type="button"
          data-testid="key-fragments-save-thought"
          onClick={() => {
            void props.onThoughtSave?.({
              id: 't1',
              text: 'Saved Thought',
              outlinePointId: 'intro-p1',
              tags: ['introduction'],
              keyFragments: ['frag1', 'saved-frag'],
              date: '2024-01-01',
            })?.persistence.catch(() => undefined);
          }}
        >
          Save thought
        </button>
        <button
          type="button"
          data-testid="key-fragments-save-thought-next"
          onClick={() => {
            void props.onThoughtSave?.({
              id: 't1',
              text: 'Saved Thought 2',
              outlinePointId: 'intro-p1',
              tags: ['introduction'],
              keyFragments: ['frag1', 'saved-frag', 'saved-frag-2'],
              date: '2024-01-01',
            })?.persistence.catch(() => undefined);
          }}
        >
          Save thought next
        </button>
      </div>
    );
  };
});
jest.mock('@/components/plan/PlanStyleSelector', () => () => <div data-testid="plan-style-selector">Mocked Plan Style Selector</div>);
jest.mock('@/components/plan/ViewPlanMenu', () => {
  const React = require('react');
  return function MockViewPlanMenu(props: { onStartPreachingMode?: () => void }) {
    return (
      <div data-testid="view-plan-menu">
        <button type="button" data-testid="start-preaching" onClick={props.onStartPreachingMode ?? undefined}>
          Start Preaching
        </button>
      </div>
    );
  };
});
jest.mock('@/components/ExportButtons', () => {
  const React = require('react');
  return function MockExportButtons(props: {
    getExportContent?: (
      format: 'plain' | 'markdown',
      options?: { includeTags?: boolean; type?: 'thoughts' | 'plan' }
    ) => Promise<string>;
    getPdfContent?: () => Promise<React.ReactNode>;
  }) {
    const [result, setResult] = React.useState('');

    return (
      <div data-testid="export-buttons">
        <button
          type="button"
          data-testid="export-plain"
          onClick={async () => setResult(await props.getExportContent?.('plain') || '')}
        >
          Export plain
        </button>
        <button
          type="button"
          data-testid="export-markdown"
          onClick={async () => setResult(await props.getExportContent?.('markdown') || '')}
        >
          Export markdown
        </button>
        <button
          type="button"
          data-testid="export-thoughts"
          onClick={async () => setResult(await props.getExportContent?.('plain', { type: 'thoughts' }) || '')}
        >
          Export thoughts
        </button>
        <button
          type="button"
          data-testid="export-plan"
          onClick={async () => setResult(await props.getExportContent?.('plain', { type: 'plan' }) || '')}
        >
          Export plan
        </button>
        <button
          type="button"
          data-testid="export-thoughts-with-tags"
          onClick={async () => setResult(await props.getExportContent?.('plain', { type: 'thoughts', includeTags: true }) || '')}
        >
          Export thoughts with tags
        </button>
        <button
          type="button"
          data-testid="export-pdf"
          onClick={async () => {
            const node = await props.getPdfContent?.();
            setResult(React.isValidElement(node) ? 'pdf-ready' : 'pdf-empty');
          }}
        >
          Export pdf
        </button>
        {result && <div data-testid="export-result">{result}</div>}
      </div>
    );
  };
});
jest.mock('@/components/PreachingTimer', () => {
  const React = require('react');
  return function MockPreachingTimer(props: any) {
    const { onTimerStateChange } = props;
    const didRun = React.useRef(false);
    React.useEffect(() => {
      if (didRun.current) return;
      didRun.current = true;
      onTimerStateChange?.({
        currentPhase: 'introduction',
        phaseProgress: 0.5,
        totalProgress: 0.1,
        phaseProgressByPhase: {
          introduction: 0.5,
          main: 0,
          conclusion: 0,
        },
        timeRemaining: 600,
        isFinished: false,
      });
    }, [onTimerStateChange]);

    return <div data-testid="preaching-timer">Mocked Preaching Timer</div>;
  };
});
jest.mock('@/components/FloatingTextScaleControls', () => () => <div data-testid="floating-text-controls">Mocked Floating Text Controls</div>);
jest.mock('@components/ui/RichMarkdownEditor', () => {
  const React = require('react');
  return {
    RichMarkdownEditor: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
      <textarea
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    ),
  };
});

jest.mock('react-textarea-autosize', () => {
  const React = require('react');
  return function MockTextareaAutosize(props: any) {
    const { onChange, onHeightChange, ...rest } = props;
    return (
      <textarea
        {...rest}
        onChange={(event) => {
          onChange?.(event);
          onHeightChange?.((event.target as HTMLTextAreaElement).scrollHeight ?? 0);
        }}
      />
    );
  };
});

// Mock i18n with the specific translations needed for this test
const translate = (key: string, options?: Record<string, unknown>) => {
  const translations: Record<string, string> = {
    'plan.unassignedNotice.title': 'Unsorted thoughts: {{amount}}',
    'plan.unassignedNotice.description': 'They will not appear in the plan.',
    'plan.unassignedNotice.sortAction': 'Sort them',
    'plan.unassignedNotice.dismissAction': 'Got it',
    'plan.noThoughtsToGenerate': 'No thoughts to generate from',
    'plan.addPoint': 'Add point',
    'plan.addPointPlaceholder': 'Point title',
    'plan.addConfirm': 'Add',
    'plan.addCancel': 'Cancel',
    'plan.notReadyTitle': 'The plan is not assembled yet',
    'plan.notReadyDescription': 'Finish that, or write it by hand.',
    'plan.missingThoughts': 'No thoughts have been recorded',
    'plan.missingUnassigned': 'Thoughts not sorted onto points: {{amount}}',
    'plan.missingPoints': 'The plan has no points',
    'plan.writeByHand': 'Write by hand',
    'plan.workOnSermon': 'Work on sermon',
    'plan.workOnStructure': 'Sort the thoughts',
    'plan.markKeyFragments': 'Mark Key Fragments',
    'plan.generating': 'Generating...',
    'plan.regenerate': 'Regenerate',
    'plan.generate': 'Generate',
    'plan.noThoughts': 'No thoughts',
    'plan.noContent': 'No content',
    'plan.noSermonPoints': 'No structure points',
    'plan.contentGenerated': 'Content generated',
    'plan.pointSaved': 'Point saved',
    'plan.sectionSaved': 'Section saved',
    'plan.save': 'Save',
    'plan.viewMode': 'View Mode',
    'plan.editMode': 'Edit Mode',
    'sections.introduction': 'Introduction',
    'sections.main': 'Main',
    'sections.conclusion': 'Conclusion',
    'common.scripture': 'Scripture',
    'actions.backToSermon': 'Back to Sermon',
    'errors.sermonNotFound': 'Sermon not found',
    'errors.failedToLoadSermon': 'Failed to load sermon',
    'errors.outlinePointNotFound': 'SermonOutline point not found',
    'errors.failedToGenerateContent': 'Failed to generate content',
    'errors.failedToSavePoint': 'Failed to save point',
    'tags.introduction': 'Introduction',
    'tags.mainPart': 'Main',
    'tags.conclusion': 'Conclusion',
  };
  const template = translations[key] || (options?.defaultValue as string | undefined) || key;
  // Interpolate {{var}} so assertions can check the NUMBER the screen shows, not just
  // that some banner appeared.
  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
    options && name in options ? String(options[name]) : whole
  );
};

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: translate,
  }),
}));

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

const resource = { collection: 'sermons', id: 'test-sermon-id' };
const metadata: EngineMetadata = { protocol: 1, generation: 'g1', revision: 1, deleted: false };

const defaultSermon = (): DocumentData => ({
  userId: 'test-user',
  title: 'Test Sermon',
  verse: 'Test Verse',
  date: new Date().toISOString(),
  thoughts: [
    { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], keyFragments: ['frag1'], date: '2024-01-01' },
    { id: 't2', text: 'Thought 2', outlinePointId: 'main-p1', tags: ['main'], date: '2024-01-01' },
    { id: 't3', text: 'Thought 3', outlinePointId: 'con-p1', tags: ['conclusion'], date: '2024-01-01' },
  ],
  plan: {
    introduction: { outline: "Intro SermonOutline Mock", outlinePoints: { 'intro-p1': 'Generated Intro Content' } },
    main: { outline: "Main SermonOutline Mock", outlinePoints: { 'main-p1': 'Generated Main Content' } },
    conclusion: { outline: "Conclusion SermonOutline Mock", outlinePoints: { 'con-p1': 'Generated Conclusion Content' } },
  },
  outline: {
    introduction: [{ id: 'intro-p1', text: 'Intro Point 1' }],
    main: [{ id: 'main-p1', text: 'Main Point 1' }],
    conclusion: [{ id: 'con-p1', text: 'Conclusion Point 1' }],
  },
  structure: {
    introduction: ['t1'],
    main: ['t2'],
    conclusion: ['t3'],
  },
});

let harness: ReturnType<typeof documentEngineHarness>;

/** The sermon the server holds and this device has a copy of; pass the whole document to replace the default. */
function openSermon(document: Record<string, unknown> = defaultSermon()) {
  // Fields left `undefined` are absent from a stored document.
  harness = documentEngineHarness({ resource, metadata, value: JSON.parse(JSON.stringify(document)) as DocumentData });
  jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);
}

const renderWithQueryClient = (ui: React.ReactElement) => {
  const queryClient = createTestQueryClient();
  return render(<QueryClientProvider client={queryClient}><DataEngineProvider>{ui}</DataEngineProvider></QueryClientProvider>);
};

const storedPlanText = () => (harness.server.value?.planText ?? {}) as Record<string, string>;
const storedThoughts = () => (harness.server.value?.thoughts ?? []) as Array<{ id: string; text: string; keyFragments?: string[] }>;

describe('Sermon Plan Page UI Smoke Test', () => {
  // Store original fetch
  const originalFetch = global.fetch;

  beforeEach(async () => {
    mockSearchParams = new URLSearchParams();
    mockPush.mockClear();
    mockReplace.mockClear();
    mockToast.success.mockClear();
    mockToast.error.mockClear();
    // Ensure we're using real timers for this test
    jest.useRealTimers();
    window.localStorage.clear();

    // Reset fetch mock before each test
    global.fetch = jest.fn().mockImplementation((url, options) => {
      if (url.includes('/api/sermons/test-sermon-id/plan')) {
        // Mock successful response for plan generation GET request
        if (url.includes('outlinePointId=')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ content: 'Mock Generated Content' }),
          });
        }
        if (options?.method === 'PUT') {
          return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
        }
      }
      // Fallback for unhandled URLs
      return Promise.resolve({ ok: false, status: 404 });
    });

    openSermon();
  });

  afterEach(() => {
    // Restore original fetch after each test
    global.fetch = originalFetch;
    jest.clearAllMocks(); // Clear other mocks too
  });

  it('shows no notice when every thought is sorted', async () => {
    openSermon({
      ...defaultSermon(),
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], date: '2024-01-01' },
      ],
      plan: undefined,
      outline: {
        introduction: [{ id: 'intro-p1', text: 'Intro Point 1' }],
        main: [],
        conclusion: [],
      },
      structure: undefined,
    });

    renderWithQueryClient(<SermonPlanPage />);

    expect((await screen.findAllByText('Intro Point 1')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Unsorted thoughts/)).not.toBeInTheDocument();
  }, 15000);

  /**
   * NO THOUGHTS IS A FORK, NOT A WALL — and not an open door either.
   *
   * Someone who simply has not recorded their thoughts yet must not land silently on an
   * empty writing surface; someone who never intended to use thoughts must not be barred.
   * So the screen asks once, and offers all three continuations.
   */
  it('asks how to prepare when the sermon is not whole', async () => {
    openSermon({
      ...defaultSermon(),
      thoughts: [],
      plan: undefined,
      outline: {
        introduction: [],
        main: [{ id: 'main-p1', text: 'Main Point 1' }],
        conclusion: [{ id: 'con-p1', text: 'Conclusion Point 1' }],
      },
      structure: undefined,
    });

    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByText('The plan is not assembled yet')).toBeInTheDocument();
    expect(screen.getByText('No thoughts have been recorded')).toBeInTheDocument();
    // All three ways out are offered — recording, sorting, writing by hand.
    expect(screen.getByRole('button', { name: 'Work on sermon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort the thoughts' })).toBeInTheDocument();
    // Writing by hand is a screen of its own — this one only offers the way there.
    fireEvent.click(screen.getByRole('button', { name: 'Write by hand' }));
    expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id/plan/manual');
    expect(screen.queryByText('Main Point 1')).not.toBeInTheDocument();
  }, 15000);

  /**
   * TEXT WHOSE POINT WAS REMOVED STAYS IN SIGHT ON THE WARNING SCREEN TOO.
   *
   * Removing the last written point turns this page into the readiness screen, which used to
   * return before the orphaned-text area was ever reached: the paragraph was stored, and shown
   * nowhere.
   */
  it('keeps text of a removed point visible on the readiness screen', async () => {
    window.localStorage.clear();
    saveDraft(draftKey('test-user', 'test-sermon-id', 'plan:gone-point'), 'A paragraph whose point was removed');
    openSermon({
      ...defaultSermon(),
      thoughts: [],
      plan: undefined,
      outline: { introduction: [], main: [{ id: 'main-p1', text: 'Main Point 1' }], conclusion: [] },
      structure: undefined,
    });

    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByText('The plan is not assembled yet')).toBeInTheDocument();
    expect(await screen.findByText('A paragraph whose point was removed')).toBeInTheDocument();
    window.localStorage.clear();
  }, 15000);

  /**
   * A WRITTEN PLAN IS NEVER HIDDEN BEHIND THE WARNING.
   *
   * Readiness answers "is this whole enough to generate from", and that question has nothing
   * to say about reading a document someone already wrote. Gating the render on readiness
   * alone meant a single thought dropped in afterwards replaced a finished plan with the
   * amber screen — on the way to the pulpit, the text was simply gone.
   */
  it('shows an already written plan even while thoughts are unsorted', async () => {
    openSermon({
      ...defaultSermon(),
      // Loose thought: attached to no outline point, so readiness says "not ready".
      thoughts: [{ id: 't-loose', text: 'A thought nobody sorted yet', tags: [], date: new Date().toISOString() }],
      outline: {
        introduction: [{ id: 'intro-p1', text: 'Intro Point 1' }],
        main: [{ id: 'main-p1', text: 'Main Point 1' }],
        conclusion: [{ id: 'con-p1', text: 'Conclusion Point 1' }],
      },
      plan: {
        introduction: { outline: '## Intro Point 1\n\nWhat I will actually say' },
        main: { outline: '' },
        conclusion: { outline: '' },
      },
      structure: undefined,
    });

    renderWithQueryClient(<SermonPlanPage />);

    // The plan itself renders (the point heads both its editor card and its plan column)...
    expect((await screen.findAllByText('Intro Point 1')).length).toBeGreaterThan(0);
    // ...and the warning screen does not stand in front of it.
    expect(screen.queryByText('The plan is not assembled yet')).not.toBeInTheDocument();
  }, 15000);

  it('applies static section tone classes to plan columns and headers', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    const introductionSection = await screen.findByTestId('introduction-interleaved-section');
    const mainSection = screen.getByTestId('main-interleaved-section');
    const conclusionSection = screen.getByTestId('conclusion-interleaved-section');

    expect(introductionSection).toHaveClass('border-amber-200', 'dark:border-amber-800', 'bg-amber-50', 'dark:bg-amber-900/40');
    expect(mainSection).toHaveClass('border-blue-200', 'dark:border-blue-800', 'bg-blue-50', 'dark:bg-blue-900/20');
    expect(conclusionSection).toHaveClass('border-green-200', 'dark:border-green-800', 'bg-green-50', 'dark:bg-green-900/20');

    expect(screen.getByRole('heading', { name: /^Introduction$/ })).toHaveClass('text-amber-800', 'dark:text-amber-200');
    expect(screen.getByRole('heading', { name: /^Main$/ })).toHaveClass('text-blue-800', 'dark:text-blue-200');
    expect(screen.getByRole('heading', { name: /^Conclusion$/ })).toHaveClass('text-green-800', 'dark:text-green-200');
  });

  it('wires section header action through layout context (switch to structure)', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('introduction-interleaved-section');
    const switchButtons = screen.getAllByTitle('Switch to Structure view');
    fireEvent.click(switchButtons[0]);

    expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id/structure');
  });

  it('renders immersive view when planView=immersive', async () => {
    mockSearchParams = new URLSearchParams('planView=immersive');
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByTestId('sermon-plan-immersive-view')).toBeInTheDocument();
    expect(screen.queryByTestId('sermon-plan-page-container')).not.toBeInTheDocument();
  });

  it('renders preaching view when planView=preaching', async () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByTestId('preaching-timer')).toBeInTheDocument();
    expect(screen.queryByTestId('sermon-plan-page-container')).not.toBeInTheDocument();
  });

  it('shows progress overlays when timer state is provided in preaching view', async () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderWithQueryClient(<SermonPlanPage />);

    const progressBars = await screen.findAllByRole('progressbar');
    expect(progressBars.length).toBeGreaterThan(0);
  });

  it('renders overlay portal when planView=overlay', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-page-container');
    expect(await screen.findByTestId('sermon-plan-overlay')).toBeInTheDocument();
  });

  it('copies overlay content using the clipboard', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-overlay');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('copies immersive content using the clipboard', async () => {
    mockSearchParams = new URLSearchParams('planView=immersive');
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-immersive-view');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
  });

  it('uses fallback copy when clipboard write fails', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');

    // Simulate clipboard denial/failure
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('Denied')) },
      configurable: true,
    });

    const mockExecCommand = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      value: mockExecCommand,
      writable: true,
      configurable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('sermon-plan-overlay');
    const copyButtons = screen.getAllByTitle('copy.copyFormatted');

    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(mockExecCommand).toHaveBeenCalledWith('copy');
      expect(mockToast.success).toHaveBeenCalledWith('plan.copySuccess');
    });
  });

  it('toggles edit mode and saves outline point content', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-right-section');

    const editButtons = screen.getAllByTitle('Edit Mode');
    fireEvent.click(editButtons[0]);

    const textareas = await screen.findAllByPlaceholderText('No content');
    fireEvent.change(textareas[0], { target: { value: 'Updated Intro Content' } });

    const saveButtons = await screen.findAllByTitle('Save');
    expect(saveButtons[0]).toBeEnabled();
    fireEvent.click(saveButtons[0]);

    // The text goes into the sermon document under the node's own key, and the plan is assembled on read.
    await waitFor(() => {
      expect(storedPlanText()['intro-p1']).toBe('Updated Intro Content');
    });
    // Only the edited node travels — no other point's text rides along.
    expect(Object.keys(storedPlanText())).toEqual(['intro-p1']);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Point saved');
    });
  });

  it('shows error toast when generate request fails', async () => {
    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/sermons/test-sermon-id/plan?outlinePointId=')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({}),
        });
      }
      if (options?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const generateButtons = screen.getAllByTitle(/Generate|Regenerate/);
    fireEvent.click(generateButtons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to generate content');
    });
  });

  // A paragraph rewritten on another device since this screen opened is never overwritten by a save:
  // the person is told, and the other device's words stay stored.
  it('shows error toast and keeps the other device\'s paragraph when the save is refused', async () => {
    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-right-section');

    const editButtons = screen.getAllByTitle('Edit Mode');
    fireEvent.click(editButtons[0]);

    const textareas = await screen.findAllByPlaceholderText('No content');
    fireEvent.change(textareas[0], { target: { value: 'Updated Intro Content' } });

    await act(async () => { await harness.remote({ planText: { 'intro-p1': 'Rewritten on the phone' } }); });

    const saveButtons = await screen.findAllByTitle('Save');
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    expect(mockToast.success).not.toHaveBeenCalledWith('Point saved');
    expect(storedPlanText()['intro-p1']).toBe('Rewritten on the phone');
  });

  it('updates local plan state when generate request succeeds', async () => {
    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const generateButtons = screen.getAllByTitle(/Generate|Regenerate/);
    fireEvent.click(generateButtons[0]);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Content generated');
    });

    expect(screen.getAllByText('Mock Generated Content').length).toBeGreaterThan(0);
    const previewSurfaces = screen.getAllByTestId('plan-point-preview-surface');
    expect(previewSurfaces[0]).toHaveClass('overflow-visible');
    expect(previewSurfaces[0]).toHaveClass('bg-gray-50/70');
  });

  it('keeps multiple plan point generate loaders independent', async () => {
    const pendingGenerations = new Map<string, {
      resolve: (value: unknown) => void;
      promise: Promise<unknown>;
    }>();

    (global.fetch as jest.Mock).mockImplementation((url, options) => {
      if (typeof url === 'string' && url.includes('/api/sermons/test-sermon-id/plan?outlinePointId=')) {
        const pointId = new URL(url, 'http://localhost').searchParams.get('outlinePointId') || 'unknown';
        let resolve!: (value: unknown) => void;
        const promise = new Promise((res) => {
          resolve = res;
        });
        pendingGenerations.set(pointId, { resolve, promise });
        return promise;
      }
      if (options?.method === 'PUT') {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: false, status: 404 });
    });

    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const generateButtons = screen.getAllByTitle(/Generate|Regenerate/);
    fireEvent.click(generateButtons[0]);

    await waitFor(() => {
      expect(generateButtons[0]).toHaveAttribute('title', 'Generating...');
    });

    fireEvent.click(generateButtons[1]);

    await waitFor(() => {
      expect(generateButtons[0]).toHaveAttribute('title', 'Generating...');
      expect(generateButtons[1]).toHaveAttribute('title', 'Generating...');
    });

    await act(async () => {
      pendingGenerations.get('intro-p1')?.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: 'Intro regenerated independently' }),
      });
      await pendingGenerations.get('intro-p1')?.promise;
    });

    await waitFor(() => {
      expect(generateButtons[0]).toHaveAttribute('title', 'Regenerate');
      expect(generateButtons[1]).toHaveAttribute('title', 'Generating...');
    });

    await act(async () => {
      pendingGenerations.get('main-p1')?.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: 'Main regenerated independently' }),
      });
      await pendingGenerations.get('main-p1')?.promise;
    });

    await waitFor(() => {
      expect(generateButtons[1]).toHaveAttribute('title', 'Regenerate');
    });
  });

  it('opens key fragments modal for an outline point', async () => {
    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const keyFragmentButtons = screen.getAllByTitle('Mark Key Fragments');
    fireEvent.click(keyFragmentButtons[0]);

    expect(await screen.findByTestId('key-fragments-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('key-fragments-update-thought'));
    await waitFor(() => {
      expect(screen.getByText('Updated Thought')).toBeInTheDocument();
    });
    // The edit is stored in the sermon document, through the engine and not the legacy thought writer.
    await waitFor(() => expect(storedThoughts().find((thought) => thought.id === 't1')?.text).toBe('Updated Thought'));
  });

  it('keeps the newest key fragment save when two are made in a row', async () => {
    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('plan-introduction-left-section');

    const keyFragmentButtons = screen.getAllByTitle('Mark Key Fragments');
    fireEvent.click(keyFragmentButtons[0]);

    expect(await screen.findByTestId('key-fragments-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('key-fragments-save-thought'));
    await waitFor(() => {
      expect(screen.getByText('Saved Thought')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('key-fragments-save-thought-next'));
    await waitFor(() => {
      expect(screen.getByText('Saved Thought 2')).toBeInTheDocument();
    });
    expect(screen.queryByText('Thought 1')).not.toBeInTheDocument();

    await waitFor(() => {
      const t1 = storedThoughts().find((thought) => thought.id === 't1');
      expect(t1?.text).toBe('Saved Thought 2');
      expect(t1?.keyFragments).toEqual(['frag1', 'saved-frag', 'saved-frag-2']);
    });
    expect(screen.getByText('Saved Thought 2')).toBeInTheDocument();
  });

  it('handles copy fallback exceptions and reports copy error', async () => {
    mockSearchParams = new URLSearchParams('planView=overlay');

    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: jest.fn().mockRejectedValue(new Error('clipboard denied')),
        write: jest.fn().mockRejectedValue(new Error('clipboard write denied')),
      },
      configurable: true,
    });

    const originalCreateRange = document.createRange;
    document.createRange = jest.fn().mockImplementation(() => ({
      selectNodeContents: () => {
        throw new Error('range fail');
      },
    })) as unknown as typeof document.createRange;

    Object.defineProperty(document, 'execCommand', {
      value: jest.fn(() => {
        throw new Error('exec command failed');
      }),
      writable: true,
      configurable: true,
    });

    // Force advanced clipboard branch check path.
    Object.defineProperty(window, 'ClipboardItem', {
      value: function ClipboardItem() { },
      configurable: true,
      writable: true,
    });

    renderWithQueryClient(<SermonPlanPage />);
    await screen.findByTestId('sermon-plan-overlay');

    const copyButtons = screen.getAllByTitle('copy.copyFormatted');
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('plan.copyError');
    });

    document.createRange = originalCreateRange;
  });

  it('enters preaching mode with push (not replace) so back() returns to plan', async () => {
    mockSearchParams = new URLSearchParams();
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');
    const startPreachingButton = screen.getByTestId('start-preaching');
    fireEvent.click(startPreachingButton);

    expect(mockPush).toHaveBeenCalledWith(
      '/sermons/test-sermon-id/plan?planView=preaching',
      { scroll: false }
    );
    expect(mockReplace).not.toHaveBeenCalled();
  });

  describe('scrolling to the section named in the address', () => {
    const originalRaf = window.requestAnimationFrame;
    const originalScrollIntoView = Element.prototype.scrollIntoView;

    beforeEach(() => {
      window.requestAnimationFrame = (callback: FrameRequestCallback) => window.setTimeout(callback, 0);
    });

    afterEach(() => {
      window.requestAnimationFrame = originalRaf;
      Element.prototype.scrollIntoView = originalScrollIntoView;
    });

    it('auto-scrolls to a section when section param is provided', async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      mockSearchParams = new URLSearchParams('section=introduction');

      renderWithQueryClient(<SermonPlanPage />);

      await screen.findByTestId('plan-introduction-left-section');

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    });

    it('auto-scrolls to the main section when the main section param is provided', async () => {
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      mockSearchParams = new URLSearchParams('section=main');

      renderWithQueryClient(<SermonPlanPage />);

      await screen.findByTestId('plan-main-left-section');

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    });

    it('falls back to querySelector when section param does not match a ref-backed section', async () => {
      const originalQuerySelector = document.querySelector;
      const fallbackElement = document.createElement('div');
      const fallbackScroll = jest.fn();
      fallbackElement.scrollIntoView = fallbackScroll;
      document.querySelector = jest.fn().mockImplementation((selector: string) => {
        if (selector === '[data-section="appendix"]') {
          return fallbackElement;
        }
        return originalQuerySelector.call(document, selector);
      });
      mockSearchParams = new URLSearchParams('section=appendix');

      try {
        renderWithQueryClient(<SermonPlanPage />);

        await screen.findByTestId('plan-introduction-left-section');

        await waitFor(() => expect(fallbackScroll).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'start'
        }));
        expect(document.querySelector).toHaveBeenCalledWith('[data-section="appendix"]');
      } finally {
        document.querySelector = originalQuerySelector;
      }
    });
  });

  it('exports plain and markdown content through export button callbacks', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');

    fireEvent.click(screen.getByTestId('export-plain'));
    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('Test Sermon');
    });
    expect(screen.getByTestId('export-result')).toHaveTextContent('Test Verse');
    expect(screen.getByTestId('export-result')).not.toHaveTextContent('# Test Sermon');

    fireEvent.click(screen.getByTestId('export-markdown'));
    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('# Test Sermon');
    });
    expect(screen.getByTestId('export-result')).toHaveTextContent('## Introduction');
  });

  it('exports thoughts and plan as distinct text content', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');

    fireEvent.click(screen.getByTestId('export-thoughts'));
    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('Thought 2');
    });
    expect(screen.getByTestId('export-result')).not.toHaveTextContent('Intro SermonOutline Mock');

    fireEvent.click(screen.getByTestId('export-plan'));
    await waitFor(() => {
      // The stored assembled string ("Intro SermonOutline Mock") is no longer a source:
      // the document is built from the cells, so the cell's text is what gets exported.
      expect(screen.getByTestId('export-result')).toHaveTextContent('Generated Intro Content');
    });
    expect(screen.getByTestId('export-result')).not.toHaveTextContent('Thought 2');
  });

  it('builds PDF export content through export button callbacks', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');

    fireEvent.click(screen.getByTestId('export-pdf'));

    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('pdf-ready');
    });
  });

  it('renders not-found state and routes back to the sermon page', async () => {
    harness = documentEngineHarness({ resource, metadata: { ...metadata, deleted: true }, value: null });
    jest.mocked(createBrowserDataEngine).mockImplementation(harness.createBrowser);

    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByText('Sermon not found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sermon' }));

    expect(mockPush).toHaveBeenCalledWith('/sermons/test-sermon-id');
  });

  it('exports fallback no-content text when verse and plan outlines are missing', async () => {
    openSermon({
      ...defaultSermon(),
      title: 'No Verse Sermon',
      verse: '',
      thoughts: [
        { id: 't1', text: 'Thought 1', outlinePointId: 'intro-p1', tags: ['introduction'], date: '2024-01-01' },
      ],
      plan: {
        introduction: { outline: '', outlinePoints: {} },
        main: { outline: '', outlinePoints: {} },
        conclusion: { outline: '', outlinePoints: {} },
      },
      outline: {
        introduction: [{ id: 'intro-p1', text: 'Intro Point 1' }],
        main: [],
        conclusion: [],
      },
      structure: {
        introduction: ['t1'],
        main: [],
        conclusion: [],
      },
    });

    renderWithQueryClient(<SermonPlanPage />);

    await screen.findByTestId('plan-introduction-left-section');

    fireEvent.click(screen.getByTestId('export-plain'));
    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('No Verse Sermon');
    });
    expect(screen.getByTestId('export-result')).toHaveTextContent('No content');
    expect(screen.getByTestId('export-result')).not.toHaveTextContent('Test Verse');

    fireEvent.click(screen.getByTestId('export-markdown'));
    await waitFor(() => {
      expect(screen.getByTestId('export-result')).toHaveTextContent('## Introduction');
    });
    expect(screen.getByTestId('export-result')).toHaveTextContent('No content');
    expect(screen.getByTestId('export-result')).not.toHaveTextContent('> Test Verse');
  });

});

/**
 * THE PLAN SCREEN MUST SHOW THE WHOLE PLAN — BUG-20260816-ai-plan-screen-hides-subpoint-text.
 *
 * This screen built one editable cell per outline POINT while the document is assembled from
 * all NODES, so text written under a sub-point appeared when preaching and nowhere on the
 * screen where the plan is edited. The preacher met his own plan looking half empty and could
 * not reach the missing half at all.
 */
describe('sub-point text on the paired plan screen', () => {
  const withSubPoint = {
    userId: 'test-user',
    title: 'Град Божий',
    verse: 'Пс 86',
    date: new Date().toISOString(),
    thoughts: [],
    outline: {
      introduction: [
        { id: 'p1', text: 'Перепись', subPoints: [{ id: 'sub-vz', text: 'Перепись в ВЗ', position: 1000 }] },
      ],
      main: [],
      conclusion: [],
    },
    planText: { p1: 'Текст самого пункта', 'sub-vz': 'Родословие Адама — Быт 5:1' },
  };

  beforeEach(() => {
    openSermon(withSubPoint);
  });

  it('shows the text written under a sub-point', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    expect(await screen.findByText('Текст самого пункта')).toBeInTheDocument();
    expect(await screen.findByText('Родословие Адама — Быт 5:1')).toBeInTheDocument();
  });

  /**
   * Scoped to the EDITOR column on purpose: the heading also appears beside the thoughts on
   * the left, and an unscoped query would pass on that one while the cell stayed nameless.
   */
  it('names the sub-point above its own cell, so the text is not orphaned on screen', async () => {
    renderWithQueryClient(<SermonPlanPage />);

    const editorColumn = (await screen.findAllByTestId('plan-introduction-right-section'))[0];
    // The column renders before its cells' text arrives from the document; on the two-core build
    // machine that gap is long enough for a synchronous query to miss the text (deploy of 2026-10-13).
    expect(await within(editorColumn).findByText('Перепись в ВЗ')).toBeInTheDocument();
    expect(await within(editorColumn).findByText('Родословие Адама — Быт 5:1')).toBeInTheDocument();
  });
});
