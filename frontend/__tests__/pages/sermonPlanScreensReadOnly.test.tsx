import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import ManualConspectusPage from '@/(pages)/(private)/sermons/[id]/plan/manual/page';
import AiPlanPage from '@/(pages)/(private)/sermons/[id]/plan/page';

import type { Sermon } from '@/models/models';

/**
 * THE PLAN SCREENS WHILE DEVICE STORAGE IS SILENT (BUG-20261002-sermon-read-only-copy-bare-page).
 *
 * The engine then hands the screen a copy it can only read. The screens used to swap themselves
 * for a bare reader — a link, a title and the plan run together — so the preacher lost the page
 * they know at the moment they open it to read. Each screen now stays itself and simply offers
 * nothing it could not keep: no editor, no save, no generation, no mode switch.
 *
 * The engine writers are real here; only the document is a stand-in, so a control that slipped
 * through and wrote would show up as a call on it.
 */

const writes: string[] = [];
let mockSermon: Record<string, unknown> | null = null;
let mockReadOnly = true;
let mockSearchParams = new URLSearchParams();

const refuse = (name: string) => jest.fn(() => {
  writes.push(name);
  return Promise.reject(Object.assign(new Error('read-only'), { code: 'read-only' }));
});

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  isCollectionOnEngine: () => true,
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useDataEngine: () => ({ owner: 'user-1' }),
  useDataDocument: () => ({
    data: mockSermon, confirmed: mockReadOnly ? null : mockSermon, remote: null, state: null, status: null,
    loading: false, readOnly: mockReadOnly, copySource: mockReadOnly ? 'server' : null,
    readOnlyReason: null, error: null,
    edit: refuse('edit'), update: refuse('update'), commit: refuse('commit'), save: refuse('save'),
    remove: refuse('remove'), acceptRemote: jest.fn(), keepLocal: jest.fn(), retry: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => <div data-testid="engine-sync-status" /> }));
jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));
jest.mock('@/hooks/useFreshnessUid', () => ({ useFreshnessUid: () => 'user-1' }));
jest.mock('@/hooks/useDocumentFreshness', () => ({
  useDocumentFreshness: () => ({ state: 'fresh', remote: null, remotelyDeleted: false, markSynced: jest.fn() }),
}));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub() }));
jest.mock('@/hooks/useSermonNoteLinks', () => ({
  ...jest.requireActual('@/hooks/useSermonNoteLinks'),
  useSourceNotes: () => ({ notes: [], missingIds: [], loading: false }),
}));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  usePathname: () => '/sermons/sermon-1/plan',
}));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock('@/components/plan/ViewPlanMenu', () => ({ __esModule: true, default: () => <div data-testid="plan-header-view-menu" /> }));
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => <div data-testid="plan-header-export" /> }));
jest.mock('@/components/plan/PlanStyleSelector', () => ({ __esModule: true, default: () => <div data-testid="plan-style-selector" /> }));
jest.mock('@components/ui/RichMarkdownEditor', () => ({
  RichMarkdownEditor: ({ value, onChange }: { value: string; onChange: (text: string) => void }) => (
    <textarea data-testid="rich-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));
let timerMounts = 0;
jest.mock('@/components/PreachingTimer', () => ({
  __esModule: true,
  default: function PreachingTimerStub() {
    React.useEffect(() => { timerMounts += 1; }, []);
    return <div data-testid="preaching-timer" />;
  },
}));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false, media: query, onchange: null, dispatchEvent: jest.fn(),
    addEventListener: jest.fn(), removeEventListener: jest.fn(), addListener: jest.fn(), removeListener: jest.fn(),
  }),
});

const sermonFixture = (overrides: Partial<Sermon> = {}) => ({
  id: 'sermon-1',
  userId: 'user-1',
  title: 'A sermon in progress',
  verse: '1 Chronicles 4:9-10',
  date: new Date('2026-01-01').toISOString(),
  thoughts: [
    { id: 't1', text: 'Warriors gathered', tags: ['Introduction'], outlinePointId: 'p1', date: '2026-01-01' },
    { id: 't2', text: 'Jabez prayed', tags: ['Main Part'], outlinePointId: 'p2', subPointId: 'sp1', date: '2026-01-01' },
  ],
  structure: { introduction: ['t1'], main: ['t2'], conclusion: [], ambiguous: [] },
  outline: {
    introduction: [{ id: 'p1', text: 'Who stood out' }],
    main: [{ id: 'p2', text: 'About Jabez', subPoints: [{ id: 'sp1', text: 'His prayer', position: 1 }] }],
    conclusion: [{ id: 'p3', text: 'What to take home' }],
  },
  planText: { p1: 'Warriors, marksmen, craftsmen', p2: 'He called on God', sp1: 'Bless me indeed', p3: 'Ask' },
  ...overrides,
}) as unknown as Record<string, unknown>;

const renderPage = (page: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{page}</QueryClientProvider>
);

/** What a person could change on this screen: anything that takes typing, and every button by its name. */
const editableFields = () => document.querySelectorAll('input, textarea, [contenteditable="true"], [data-testid="rich-editor"]');
const buttonNames = () => screen.queryAllByRole('button').map((button) => button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim() || '');

/** Buttons that only move the person or the view — none of them can change the sermon. */
const READING_BUTTONS = [
  'plan.switchToStructure',
  'plan.unassignedNotice.sortAction',
  'plan.unassignedNotice.dismissAction',
];
const WRITING_BUTTONS = /^(plan\.(save|editMode|viewMode|markKeyFragments|generate|regenerate|renamePoint|renameSubPoint|deletePoint|deleteSubPoint|addPoint|addSubPoint|fromNote\.entry)|structure\.)/;

describe('the AI plan screen on a copy for reading', () => {
  beforeEach(() => {
    writes.length = 0;
    mockReadOnly = true;
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
    window.localStorage.clear();
  });

  it('is its own page — header, sections and every point with its text', () => {
    renderPage(<AiPlanPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
    expect(screen.getByTestId('sermon-plan-page-container')).toBeInTheDocument();
    for (const text of ['Who stood out', 'About Jabez', 'His prayer', 'What to take home',
      'Warriors, marksmen, craftsmen', 'He called on God', 'Bless me indeed', 'Ask', 'Warriors gathered', 'Jabez prayed']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it('offers nothing it could not keep', () => {
    renderPage(<AiPlanPage />);

    expect(editableFields()).toHaveLength(0);
    expect(screen.queryByTestId('plan-header-mode-switch')).toBeNull();
    expect(screen.queryByTestId('plan-style-selector')).toBeNull();
    expect(screen.queryByTestId('engine-sync-status')).toBeNull();
    expect(buttonNames().filter((name) => !READING_BUTTONS.includes(name))).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('shows the same controls when the sermon can be written — so the test above sees them', () => {
    mockReadOnly = false;
    renderPage(<AiPlanPage />);

    expect(screen.getByTestId('plan-header-mode-switch')).toBeInTheDocument();
    expect(buttonNames().filter((name) => WRITING_BUTTONS.test(name))).toEqual(expect.arrayContaining(['plan.save', 'plan.editMode', 'plan.markKeyFragments']));
  });

  it('keeps the way to write from the note for when writing is possible again', () => {
    mockSermon = sermonFixture({ thoughts: [], structure: undefined, planText: {}, sourceNoteIds: ['note-1'] } as Partial<Sermon>);
    renderPage(<AiPlanPage />);
    expect(screen.queryByRole('button', { name: 'plan.fromNote.entry' })).toBeNull();
    expect(writes).toEqual([]);

    document.body.innerHTML = '';
    mockReadOnly = false;
    renderPage(<AiPlanPage />);
    expect(screen.getByRole('button', { name: 'plan.fromNote.entry' })).toBeInTheDocument();
  });

  it('still preaches from the copy', () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderPage(<AiPlanPage />);
    expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    expect(writes).toEqual([]);
  });
});

describe('the hand-written plan screen on a copy for reading', () => {
  beforeEach(() => {
    writes.length = 0;
    mockReadOnly = true;
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
    window.localStorage.clear();
  });

  it.each([['by hand', ''], ['from a note', 'source=note']])('is its own page with nothing to change (%s)', (_mode, query) => {
    mockSearchParams = new URLSearchParams(query);
    renderPage(<ManualConspectusPage />);

    expect(screen.getByTestId('plan-page-header')).toBeInTheDocument();
    for (const text of ['Who stood out', 'About Jabez', 'His prayer', 'What to take home',
      'Warriors, marksmen, craftsmen', 'He called on God', 'Bless me indeed', 'Ask']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(editableFields()).toHaveLength(0);
    expect(screen.queryByTestId('plan-header-mode-switch')).toBeNull();
    expect(screen.queryByTestId('plan-style-selector')).toBeNull();
    expect(buttonNames().filter((name) => !READING_BUTTONS.includes(name))).toEqual([]);
    expect(writes).toEqual([]);
  });

  it('shows the same controls when the sermon can be written — so the test above sees them', () => {
    mockReadOnly = false;
    renderPage(<ManualConspectusPage />);

    expect(buttonNames().filter((name) => WRITING_BUTTONS.test(name))).toEqual(expect.arrayContaining(['plan.save', 'plan.editMode', 'plan.renamePoint', 'plan.deletePoint']));
  });

  it('still preaches from the copy', () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    renderPage(<ManualConspectusPage />);
    expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
  });
});

/**
 * WHEN STORAGE ANSWERS, THE EDITOR STARTS FROM THE EDITOR'S DOCUMENT.
 *
 * The copy for reading comes from the server or the device; the editor's document also carries
 * this device's unsent changes. Seeding keeps a cell's earlier value when the newer document no
 * longer has it, so text the preacher had already removed here would come back from the copy,
 * marked saved, and ride along with the next save. The screen therefore starts over when the copy
 * gives way — as it did when the copy was a separate reader — except while preaching, where the
 * timer must run on.
 */
describe('a plan screen when device storage answers again', () => {
  beforeEach(() => {
    writes.length = 0;
    timerMounts = 0;
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('shows what the editor holds, not what the copy held (%s)', (_name, Page) => {
    mockReadOnly = true;
    mockSermon = sermonFixture({ planText: { p1: 'Text removed on this device', p2: 'He called on God' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    expect(screen.getAllByText('Text removed on this device').length).toBeGreaterThan(0);

    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p2: 'He called on God' } } as Partial<Sermon>);
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
    });

    expect(screen.queryByText('Text removed on this device')).toBeNull();
    expect(screen.getAllByText('He called on God').length).toBeGreaterThan(0);
  });

  /** The AI plan kept its page while preaching at HEAD too; the preacher's timer runs on. */
  it('keeps the AI plan\'s preaching timer running when storage answers', () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    mockReadOnly = true;
    mockSermon = sermonFixture();
    const view = renderPage(<AiPlanPage />);
    expect(timerMounts).toBe(1);

    mockReadOnly = false;
    mockSermon = sermonFixture();
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><AiPlanPage /></QueryClientProvider>);
    });
    expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    expect(timerMounts).toBe(1);
  });

  /** The page stays mounted while preaching, so its cells must follow the editor's document. */
  it('drops a cell the editor\'s document no longer holds while the AI plan is preached', () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    mockReadOnly = true;
    mockSermon = sermonFixture({ planText: { p1: 'Text removed on this device', p2: 'He called on God' } } as Partial<Sermon>);
    const view = renderPage(<AiPlanPage />);
    expect(document.body.textContent).toContain('Text removed on this device');

    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p2: 'He called on God' } } as Partial<Sermon>);
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><AiPlanPage /></QueryClientProvider>);
    });
    expect(document.body.textContent).not.toContain('Text removed on this device');
    expect(document.body.textContent).toContain('He called on God');
  });

  /**
   * The hand-written plan could not be preached from a copy at all (the reader replaced it). Now it
   * can; when storage answers, the preaching view opens afresh on the editor's document.
   */
  it('preaches the hand-written plan from a copy, then from the editor\'s document', () => {
    mockSearchParams = new URLSearchParams('planView=preaching');
    mockReadOnly = true;
    mockSermon = sermonFixture({ planText: { p1: 'Text removed on this device', p2: 'He called on God' } } as Partial<Sermon>);
    const view = renderPage(<ManualConspectusPage />);
    expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    expect(document.body.textContent).toContain('Text removed on this device');

    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p2: 'He called on God' } } as Partial<Sermon>);
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><ManualConspectusPage /></QueryClientProvider>);
    });
    expect(screen.getByTestId('preaching-timer')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Text removed on this device');
    expect(document.body.textContent).toContain('He called on God');
  });
});

describe('what a copy for reading leaves untouched', () => {
  beforeEach(() => {
    writes.length = 0;
    mockReadOnly = true;
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });

  /** The bare reader showed an old sermon's whole-section text; the copy page must not hide it. */
  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('shows an old sermon\'s section text (%s)', (_name, Page) => {
    mockSermon = sermonFixture({ planText: {}, plan: {
      introduction: { outline: 'Legacy introduction text' }, main: { outline: 'Legacy main text' }, conclusion: { outline: 'Legacy closing text' },
    } } as unknown as Partial<Sermon>);
    renderPage(<Page />);
    for (const text of ['Legacy introduction text', 'Legacy main text', 'Legacy closing text']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });

  /** An empty-but-present `plan` used to hide a written `draft` behind the "not ready" screen (Codex, round 4). */
  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('shows an old sermon\'s text kept only in its draft (%s)', (_name, Page) => {
    mockSermon = sermonFixture({ thoughts: [], structure: undefined, outline: { introduction: [], main: [], conclusion: [] }, planText: {},
      plan: { introduction: { outline: '' }, main: { outline: '' }, conclusion: { outline: '' } },
      draft: { introduction: { outline: 'Last legacy draft paragraph' }, main: { outline: '' }, conclusion: { outline: '' } },
    } as unknown as Partial<Sermon>);
    renderPage(<Page />);
    expect(screen.getByText('Last legacy draft paragraph')).toBeInTheDocument();
  });

  /** A newer copy (the server's after the device's) is drawn as it is, like the reader drew it (Codex, round 4). */
  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('drops text the next copy no longer has (%s)', (_name, Page) => {
    mockSermon = sermonFixture({ planText: { p1: 'Removed between copies', p2: 'Kept words' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    expect(document.body.textContent).toContain('Removed between copies');

    mockSermon = sermonFixture({ planText: { p2: 'Kept words' } } as Partial<Sermon>);
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
    });
    expect(document.body.textContent).not.toContain('Removed between copies');
    expect(document.body.textContent).toContain('Kept words');
  });

  /**
   * Text typed on this device and not yet sent lives in the draft store. On a copy, a write still
   * queued from earlier makes its cell look unconfirmed, and the copy's (server's) words used to be
   * stored over the newer draft 250 ms after the page opened (found by Codex, 2026-10-03).
   */
  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('keeps newer unsent text in the draft store (%s)', async (_name, Page) => {
    const key = 'draft:v1:user-1:sermon-1:plan:p1';
    localStorage.setItem(key, JSON.stringify({ value: 'Unsent local words', savedAt: Date.now() }));
    localStorage.setItem('outbox:v1:intent', JSON.stringify({ id: 'intent', uid: 'user-1', collection: 'sermons', docId: 'sermon-1',
      aggregate: 'plan', patch: { 'planText.p1': 'Earlier queued words' }, baseRevision: 0, status: 'migration-required', savedAt: Date.now() }));
    mockSermon = sermonFixture({ planText: { p1: 'Older server words', p2: 'He called on God' } } as Partial<Sermon>);

    const view = renderPage(<Page />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 350)); });
    expect(JSON.parse(localStorage.getItem(key)!).value).toBe('Unsent local words');
    view.unmount();
    expect(JSON.parse(localStorage.getItem(key)!).value).toBe('Unsent local words');
  });
});

/**
 * THE PERSON'S OWN WORDS ACROSS EVERY SWITCH (found by Codex, round 2, 2026-10-03).
 *
 * Text typed a moment before the copy arrives — straight from the editor, or after stepping into
 * the preaching view — must reach the draft store; and a draft this screen stored and the server
 * then confirmed must be retired, not offered back as if it were lost.
 */
describe('drafts across copy and editor', () => {
  const draftOf = (nodeId: string) => JSON.parse(localStorage.getItem(`draft:v1:user-1:sermon-1:plan:${nodeId}`) || 'null')?.value;
  const switchTo = (view: ReturnType<typeof renderPage>, Page: React.ComponentType) => {
    act(() => { view.rerender(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>); });
  };
  const typeIntoFirstCell = (text: string) => {
    fireEvent.click(screen.getAllByRole('button', { name: 'plan.editMode' })[0]);
    fireEvent.change(screen.getAllByTestId('rich-editor')[0], { target: { value: text } });
  };

  beforeEach(() => {
    jest.useFakeTimers();
    writes.length = 0;
    mockReadOnly = false;
    mockSearchParams = new URLSearchParams();
    mockSermon = sermonFixture();
    localStorage.clear();
  });
  afterEach(() => { jest.useRealTimers(); });

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('stores the last keystrokes when the copy arrives at once (%s)', (_name, Page) => {
    const view = renderPage(<Page />);
    typeIntoFirstCell('Safe swap words');
    mockReadOnly = true;
    switchTo(view, Page);
    expect(draftOf('p1')).toBe('Safe swap words');
  });

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('stores the last keystrokes when the copy arrives in the preaching view (%s)', (_name, Page) => {
    const view = renderPage(<Page />);
    typeIntoFirstCell('Last keystrokes before preaching');
    mockSearchParams = new URLSearchParams('planView=preaching');
    switchTo(view, Page);
    mockReadOnly = true;
    switchTo(view, Page);
    act(() => { jest.advanceTimersByTime(350); });
    view.unmount();
    expect(draftOf('p1')).toBe('Last keystrokes before preaching');
  });

  // AI plan only: the hand-written plan offers a confirmed draft back after any remount, at HEAD too
  // (BUGS.md, «Подтверждённый черновик может остаться…»).
  it.each([['AI plan', AiPlanPage]])('retires its own draft once the server confirms it, even across a copy (%s)', (_name, Page) => {
    localStorage.setItem('outbox:v1:intent', JSON.stringify({ id: 'intent', uid: 'user-1', collection: 'sermons', docId: 'sermon-1',
      aggregate: 'plan', patch: { 'planText.p1': 'Queued words' }, baseRevision: 0, status: 'migration-required', savedAt: Date.now() }));
    mockSermon = sermonFixture({ planText: { p1: 'Queued words' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    act(() => { jest.advanceTimersByTime(350); });
    expect(draftOf('p1')).toBe('Queued words');

    mockSearchParams = new URLSearchParams('planView=preaching');
    switchTo(view, Page);
    mockReadOnly = true;
    switchTo(view, Page);
    act(() => { jest.advanceTimersByTime(350); });
    // Still queued, so still owed: a copy on screen confirms nothing.
    expect(draftOf('p1')).toBe('Queued words');
    localStorage.removeItem('outbox:v1:intent');
    // The editor's document is a new value, not the copy object.
    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p1: 'Queued words' } } as Partial<Sermon>);
    switchTo(view, Page);
    act(() => { jest.advanceTimersByTime(350); });
    mockSearchParams = new URLSearchParams();
    switchTo(view, Page);

    expect(screen.queryByText('plan.draftRecoveryRestore')).toBeNull();
    expect(draftOf('p1')).toBeUndefined();
  });

  /** Codex round 3: the queue drains while a copy is shown in the preaching view, then the person leaves it. */
  it('does not offer back a draft the server confirmed while the AI plan was preached from a copy', () => {
    localStorage.setItem('outbox:v1:intent', JSON.stringify({ id: 'intent', uid: 'user-1', collection: 'sermons', docId: 'sermon-1',
      aggregate: 'plan', patch: { 'planText.p1': 'Queued words' }, baseRevision: 0, status: 'migration-required', savedAt: Date.now() }));
    mockSearchParams = new URLSearchParams('planView=preaching');
    mockSermon = sermonFixture({ planText: { p1: 'Queued words' } } as Partial<Sermon>);
    const view = renderPage(<AiPlanPage />);
    act(() => { jest.advanceTimersByTime(350); });
    expect(draftOf('p1')).toBe('Queued words');

    mockReadOnly = true;
    mockSermon = sermonFixture({ planText: { p1: 'Queued words' } } as Partial<Sermon>);
    switchTo(view, AiPlanPage);
    localStorage.removeItem('outbox:v1:intent');
    window.dispatchEvent(new Event('outbox:changed'));
    mockSermon = sermonFixture({ planText: { p1: 'Queued words' } } as Partial<Sermon>);
    switchTo(view, AiPlanPage);
    act(() => { jest.advanceTimersByTime(350); });
    mockSearchParams = new URLSearchParams();
    switchTo(view, AiPlanPage);

    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p1: 'Newer confirmed paragraph' } } as Partial<Sermon>);
    switchTo(view, AiPlanPage);
    act(() => { jest.advanceTimersByTime(350); });

    expect(screen.queryByText('plan.draftRecoveryRestore')).toBeNull();
    expect(draftOf('p1')).toBeUndefined();
  });
});

/**
 * BUG-20261003-preaching-on-copy-stores-copy-words-as-draft. A queued cell's words live in the queue;
 * the screen may hold other words for it — a copy's, or a document that never saw a write queued
 * before its collection moved to the engine. The device draft must keep the queued words.
 */
describe('a device draft of a queued cell', () => {
  const key = 'draft:v1:user-1:sermon-1:plan:p1';
  const queue = (words: string) => window.localStorage.setItem('outbox:v1:intent', JSON.stringify({
    id: 'intent', uid: 'user-1', collection: 'sermons', docId: 'sermon-1', aggregate: 'plan',
    patch: { 'planText.p1': words }, baseRevision: 0, status: 'migration-required', savedAt: Date.now(),
  }));

  beforeEach(() => {
    jest.useFakeTimers();
    writes.length = 0;
    mockReadOnly = false;
    mockSearchParams = new URLSearchParams();
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('keeps the queued words when the document holds older ones (%s)', (_name, Page) => {
    window.localStorage.setItem(key, JSON.stringify({ value: 'Unsent local words', savedAt: Date.now() }));
    queue('Unsent local words');
    mockSermon = sermonFixture({ planText: { p1: 'Older server words', p2: 'Other paragraph' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    act(() => { jest.advanceTimersByTime(350); });
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Unsent local words');
    view.unmount();
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Unsent local words');
  });

  /** Codex: words typed after the queue entry, then the page closed — the draft is the newest. */
  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('keeps a draft newer than the queue (%s)', (_name, Page) => {
    window.localStorage.setItem(key, JSON.stringify({ value: 'Later unsent draft', savedAt: Date.now() }));
    queue('Earlier queued words');
    mockSermon = sermonFixture({ planText: { p1: 'Older server words', p2: 'Other paragraph' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    act(() => { jest.advanceTimersByTime(350); });
    view.unmount();
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Later unsent draft');
  });

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('stores the queued words when no draft holds the cell (%s)', (_name, Page) => {
    queue('Queued words only');
    mockSermon = sermonFixture({ planText: { p1: 'Older server words', p2: 'Other paragraph' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    act(() => { jest.advanceTimersByTime(350); });
    view.unmount();
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Queued words only');
  });
});

describe('a device draft while a plan is preached from a copy', () => {
  const key = 'draft:v1:user-1:sermon-1:plan:p1';

  beforeEach(() => {
    jest.useFakeTimers();
    writes.length = 0;
    mockReadOnly = true;
    mockSearchParams = new URLSearchParams('planView=preaching');
    window.localStorage.clear();
  });
  afterEach(() => jest.useRealTimers());

  it.each([['AI plan', AiPlanPage], ['hand-written plan', ManualConspectusPage]])('keeps the unsent local words over the copy\'s (%s)', (_name, Page) => {
    window.localStorage.setItem(key, JSON.stringify({ value: 'Unsent local words', savedAt: Date.now() }));
    window.localStorage.setItem('outbox:v1:intent', JSON.stringify({
      id: 'intent', uid: 'user-1', collection: 'sermons', docId: 'sermon-1', aggregate: 'plan',
      patch: { 'planText.p1': 'Unsent local words' }, baseRevision: 0, status: 'migration-required', savedAt: Date.now(),
    }));
    mockSermon = sermonFixture({ planText: { p1: 'Old copy words', p2: 'Other paragraph' } } as Partial<Sermon>);
    const view = renderPage(<Page />);
    act(() => { jest.advanceTimersByTime(350); });
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Unsent local words');

    mockReadOnly = false;
    mockSermon = sermonFixture({ planText: { p1: 'Unsent local words', p2: 'Other paragraph' } } as Partial<Sermon>);
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><Page /></QueryClientProvider>);
    });
    act(() => { jest.advanceTimersByTime(350); });
    expect(JSON.parse(window.localStorage.getItem(key)!).value).toBe('Unsent local words');
  });
});
