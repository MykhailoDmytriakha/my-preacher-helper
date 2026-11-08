import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import CouncilDetailPage from '@/(pages)/(private)/care/council/[id]/page';
import CouncilListPage from '@/(pages)/(private)/care/council/page';

import type { FailureWords } from '@/utils/actionFailureMessage';

const council = { id: 'council-1', userId: 'owner', title: 'Draft council', status: 'draft', topics: [
  { id: 'topic-1', title: 'First', kind: 'discussion', questions: [], options: [], outcomes: [] },
  { id: 'topic-2', title: 'Second', kind: 'discussion', questions: [], options: [], outcomes: [] },
] };
const mockCouncil = { council: null as typeof council | null, readOnly: false, errorWords: null as FailureWords | null };
const mockRefresh = jest.fn();
const mockState = { error: 'Read refused', loading: false, councils: [] as (typeof council)[] };
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }), usePathname: () => '/care/council/council-1', useSearchParams: () => new URLSearchParams() }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('@/hooks/useCouncilsDataCollection', () => ({ useCouncilsDataCollection: () => ({ ...mockState, knownIds: new Set(), refresh: mockRefresh }) }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => mockState }));
jest.mock('@/hooks/useCouncilDataDocument', () => ({ useCouncilDataDocument: () => ({
  ...mockState, ...mockCouncil, refresh: mockRefresh, recoveryIdentity: 'council-1', recovery: { choices: [] },
}) }));
jest.mock('@/data-engine/react.client', () => ({
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => children,
  useDataEngine: () => ({ owner: council.userId }),
}));
jest.mock('@/data-engine/DataCollectionStatus', () => ({ DataCollectionStatus: () => null }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilMigration', () => ({ EngineCouncilMigration: () => null }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilCreator', () => ({ EngineCouncilCreator: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => {
  jest.clearAllMocks();
  mockRefresh.mockReset();
  mockCouncil.council = null;
  mockCouncil.readOnly = false;
  mockCouncil.errorWords = null;
  mockState.councils = [];
});

describe.each([['list', CouncilListPage], ['detail', CouncilDetailPage]] as const)('%s read retry', (_name, Page) => {
  it('keeps the existing read error without an escaping asynchronous rejection or a second notice', async () => {
    let refuse!: (error: Error) => void;
    mockRefresh.mockImplementationOnce(() => new Promise((_resolve, reject) => { refuse = reject; }));
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: 'council.retry' }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => { refuse(new Error('Data engine request failed')); await new Promise(resolve => setTimeout(resolve, 0)); });
    expect(screen.getAllByText('council.readFailed')).toHaveLength(1);
    expect(screen.queryByText('council.emptyTitle')).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('observes a successful retry exactly once', async () => {
    mockRefresh.mockResolvedValueOnce([]);
    render(<Page />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'council.retry' })); });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('council detail read notice', () => {
  it('lets the visible read panel speak for the same document read', () => {
    mockCouncil.errorWords = { key: 'dataSync.documentFailed', readNotice: true };
    render(<CouncilDetailPage />);

    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'council.retry' })).toBeInTheDocument();
    expect(screen.queryByText('dataSync.documentFailed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dataSync.retry' })).not.toBeInTheDocument();
  });

  it('keeps a separate write refusal even when the read panel is visible', () => {
    mockCouncil.errorWords = { key: 'dataSync.phase.refused' };
    render(<CouncilDetailPage />);

    expect(screen.getByText('council.readFailed')).toBeInTheDocument();
    expect(screen.getByText('dataSync.phase.refused')).toBeInTheDocument();
  });

  it('lets the engine report a read failure when the page has no read panel', () => {
    mockState.councils = [council];
    mockCouncil.errorWords = { key: 'dataSync.documentFailed', readNotice: true };
    render(<CouncilDetailPage />);

    expect(screen.queryByText('council.readFailed')).not.toBeInTheDocument();
    expect(screen.getByText('dataSync.documentFailed')).toBeInTheDocument();
  });
});

it('closes the original delete confirmation when a council switches to its read-only copy', () => {
  mockCouncil.council = council;
  const { rerender } = render(<CouncilDetailPage />);
  fireEvent.click(screen.getByRole('button', { name: 'council.detail.delete' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();

  mockCouncil.readOnly = true;
  rerender(<CouncilDetailPage />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  mockCouncil.readOnly = false;
  rerender(<CouncilDetailPage />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('returns from Arrange to reading when the council switches to its read-only copy', () => {
  mockCouncil.council = council;
  const { rerender } = render(<CouncilDetailPage />);
  fireEvent.click(screen.getByTestId('council-reorder'));
  expect(screen.getByText('council.detail.reorderHint')).toBeInTheDocument();

  mockCouncil.readOnly = true;
  rerender(<CouncilDetailPage />);
  expect(screen.queryByText('council.detail.reorderHint')).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'First' })).toBeInTheDocument();
  mockCouncil.readOnly = false;
  rerender(<CouncilDetailPage />);
  expect(screen.getByTestId('council-reorder')).toBeInTheDocument();
});
