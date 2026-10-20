import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import CouncilDetailPage from '@/(pages)/(private)/care/council/[id]/page';
import CouncilListPage from '@/(pages)/(private)/care/council/page';

const mockRefresh = jest.fn();
const mockState = { error: 'Read refused', loading: false, councils: [] };
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }), useParams: () => ({ id: 'council-1' }) }));
jest.mock('@/providers/AuthProvider', () => ({ useAuth: () => ({ user: { uid: 'owner' } }) }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('@/hooks/useCouncilsDataCollection', () => ({ useCouncilsDataCollection: () => ({ ...mockState, knownIds: new Set(), refresh: mockRefresh }) }));
jest.mock('@/hooks/useCouncilsRead', () => ({ useCouncilsRead: () => mockState }));
jest.mock('@/hooks/useCouncilDataDocument', () => ({ useCouncilDataDocument: () => ({
  ...mockState, council: null, refresh: mockRefresh, recovery: { choices: [] },
}) }));
jest.mock('@/data-engine/react.client', () => ({ DataDocumentProvider: ({ children }: { children: React.ReactNode }) => children }));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/data-engine/DataCollectionStatus', () => ({ DataCollectionStatus: () => null }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilMigration', () => ({ EngineCouncilMigration: () => null }));
jest.mock('@/(pages)/(private)/care/council/EngineCouncilCreator', () => ({ EngineCouncilCreator: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

beforeEach(() => { jest.resetAllMocks(); });

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
