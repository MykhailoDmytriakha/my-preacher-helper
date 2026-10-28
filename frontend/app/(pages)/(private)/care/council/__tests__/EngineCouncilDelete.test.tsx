import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import CouncilDetailPage from '../[id]/page';

import type { Council } from '@/models/models';
import '@testing-library/jest-dom';

/**
 * DELETING A COUNCIL LEAVES ITS PAGE ONLY AFTER THE DELETE IS HELD (BUG-20261012-council-delete-false-failure).
 *
 * The page used to leave at once: leaving closed the editor while its remove was still on the way,
 * the engine answered "Editor is no longer active", and the person read "the council could not be
 * saved" about a council that was in fact deleted. Every other screen waits for its delete first.
 */

let settle: { resolve: () => void; reject: (error: unknown) => void } | null = null;
const mockDeleteCouncil = jest.fn(() => new Promise<void>((resolve, reject) => { settle = { resolve, reject }; }));
const mockReplace = jest.fn();
const mockPush = jest.fn();

jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush, replace: mockReplace }), useParams: () => ({ id: 'council-1' }), usePathname: () => '/care/council/council-1', useSearchParams: () => new URLSearchParams() }));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));

const council: Council = {
  id: 'council-1', userId: 'owner', title: 'Council to delete', status: 'preparing', topics: [],
  createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
};
jest.mock('@/hooks/useCouncilsRead', () => ({
  useCouncilsRead: () => ({ councils: [council], loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useCouncilDataDocument', () => ({
  useCouncilDataDocument: () => ({
    council, loading: false, readOnly: false, error: null, status: null, confirmed: null, remote: null,
    refresh: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(),
    updateCouncil: jest.fn().mockResolvedValue(undefined), deleteCouncil: mockDeleteCouncil,
    carryTopicToNext: jest.fn(), listRecoverable: jest.fn().mockResolvedValue([]), recover: jest.fn(),
    recovery: { choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn() },
  }),
}));

function confirmDelete() {
  render(<CouncilDetailPage />);
  fireEvent.click(screen.getByRole('button', { name: 'council.detail.delete' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click([...dialog.querySelectorAll('button')].find(button => /delete/i.test(button.textContent ?? '')) as HTMLElement);
}

describe('deleting a council from its page', () => {
  beforeEach(() => { jest.clearAllMocks(); settle = null; });

  it('waits for the delete, then leaves with replace and reports nothing', async () => {
    confirmDelete();
    expect(mockDeleteCouncil).toHaveBeenCalledWith('council-1');
    // Still on the page while the delete is on the way: leaving now would close its editor.
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();

    await act(async () => { settle!.resolve(); });
    expect(mockReplace).toHaveBeenCalledWith('/care/council');
    expect(mockPush).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('stays on the council and says so when the delete is refused', async () => {
    confirmDelete();
    await act(async () => { settle!.reject(Object.assign(new Error('refused'), { code: 'permission-denied' })); });
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
