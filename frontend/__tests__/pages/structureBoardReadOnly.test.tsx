import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';
import StructurePage from '@/(pages)/(private)/sermons/[id]/structure/page';

/**
 * THE STRUCTURE BOARD WHILE DEVICE STORAGE IS SILENT (BUG-20261002-sermon-read-only-copy-bare-page).
 *
 * The board used to swap itself for a bare reader: the outline as one list and every thought
 * run together underneath, with no columns and no way to tell which thought sat under which
 * point. On a copy for reading it now keeps its page — the toolbar and the three coloured
 * columns with their points, sub-points, notes and thoughts — and offers no control at all:
 * nothing to drag, type into, sort, dictate or delete.
 *
 * The engine writer is real; only the document is a stand-in, so any write would show up here.
 */

const writes: string[] = [];
let mockSermon: Record<string, unknown> | null = null;
let mockReadOnly = true;

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
    data: mockSermon, confirmed: mockSermon, remote: null, state: null, status: null,
    loading: false, readOnly: mockReadOnly, copySource: mockReadOnly ? 'server' : null,
    readOnlyReason: null, error: null,
    edit: refuse('edit'), update: refuse('update'), commit: refuse('commit'), save: refuse('save'),
    remove: refuse('remove'), acceptRemote: jest.fn(), keepLocal: jest.fn(), retry: jest.fn().mockResolvedValue(undefined),
  }),
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => <div data-testid="engine-sync-status" /> }));
jest.mock('@/services/tag.service', () => ({ getTags: jest.fn().mockResolvedValue({ requiredTags: [], customTags: [] }) }));
jest.mock('@/hooks/useRouteId', () => ({ useRouteId: () => 'sermon-1' }));
jest.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { uid: 'user-1' }, loading: false }) }));
jest.mock('@/hooks/useAiUsage', () => ({ useAiUsage: () => require('@test-utils/aiUsage').aiUsageStub() }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/sermons/sermon-1/structure',
}));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() } }));
jest.mock('@/components/ExportButtons', () => ({ __esModule: true, default: () => null }));

const sermonFixture = () => ({
  id: 'sermon-1',
  userId: 'user-1',
  title: 'A sermon in progress',
  verse: '1 Chronicles 4:9-10',
  date: '2026-01-01',
  thoughts: [
    { id: 't1', text: 'Warriors gathered', tags: ['Introduction'], outlinePointId: 'p1', date: '2026-01-01' },
    { id: 't2', text: 'Jabez prayed', tags: ['Main Part'], outlinePointId: 'p2', subPointId: 'sp1', date: '2026-01-01' },
    { id: 't3', text: 'A loose thought', tags: ['Main Part'], date: '2026-01-01' },
    { id: 't4', text: 'Not sorted yet', tags: [], date: '2026-01-01' },
  ],
  structure: { introduction: ['t1'], main: ['t2', 't3'], conclusion: [], ambiguous: ['t4'] },
  outline: {
    introduction: [{ id: 'p1', text: 'Who stood out', note: 'Read the list slowly' }],
    main: [{ id: 'p2', text: 'About Jabez', subPoints: [{ id: 'sp1', text: 'His prayer', position: 1, note: 'Pause here' }] }],
    conclusion: [{ id: 'p3', text: 'What to take home' }],
  },
}) as Record<string, unknown>;

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><StructurePage /></QueryClientProvider>
);

describe('the structure board on a copy for reading', () => {
  beforeEach(() => {
    writes.length = 0;
    mockReadOnly = true;
    mockSermon = sermonFixture();
    window.localStorage.clear();
  });

  it('keeps its page: every point, sub-point, note and thought in its own column', async () => {
    renderPage();
    const board = await screen.findByTestId('structure-read-only-board');

    expect(screen.getByRole('link', { name: 'structure.backToSermon' })).toBeInTheDocument();
    const introduction = within(board).getByRole('region', { name: 'structure.introduction' });
    expect(within(introduction).getByText('Who stood out')).toBeInTheDocument();
    expect(within(introduction).getByText('Read the list slowly')).toBeInTheDocument();
    expect(within(introduction).getByText('Warriors gathered')).toBeInTheDocument();
    const main = within(board).getByRole('region', { name: 'structure.mainPart' });
    for (const text of ['About Jabez', 'His prayer', 'Pause here', 'Jabez prayed', 'A loose thought']) {
      expect(within(main).getByText(text)).toBeInTheDocument();
    }
    expect(within(board).getByRole('region', { name: 'structure.conclusion' })).toHaveTextContent('What to take home');
    expect(within(board).getByText('Not sorted yet')).toBeInTheDocument();
  });

  it('offers nothing it could not keep', async () => {
    renderPage();
    const board = await screen.findByTestId('structure-read-only-board');

    expect(within(board).queryAllByRole('button')).toEqual([]);
    expect(document.querySelectorAll('input, textarea, [contenteditable="true"]')).toHaveLength(0);
    // Nothing on the page can be picked up: dnd-kit marks every draggable this way.
    expect(document.querySelector('[aria-roledescription="sortable"], [aria-roledescription="draggable"], [data-rfd-drag-handle-draggable-id]')).toBeNull();
    expect(screen.queryByTestId('engine-sync-status')).toBeNull();
    await waitFor(() => expect(writes).toEqual([]));
  });

  it('becomes the editing board by itself when storage answers', async () => {
    const view = renderPage();
    await screen.findByTestId('structure-read-only-board');

    mockReadOnly = false;
    act(() => {
      view.rerender(<QueryClientProvider client={new QueryClient()}><StructurePage /></QueryClientProvider>);
    });

    await waitFor(() => expect(document.querySelector('[aria-roledescription="sortable"]')).not.toBeNull());
    expect(screen.queryByTestId('structure-read-only-board')).toBeNull();
    expect(screen.getByText('Warriors gathered')).toBeInTheDocument();
  });

  it('is the editing board when the sermon can be written — so the test above sees a difference', async () => {
    mockReadOnly = false;
    renderPage();

    await screen.findByText('Warriors gathered');
    expect(screen.queryByTestId('structure-read-only-board')).toBeNull();
    expect(document.querySelector('[aria-roledescription="sortable"]')).not.toBeNull();
  });
});
