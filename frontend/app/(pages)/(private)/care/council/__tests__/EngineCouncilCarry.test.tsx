import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { toast } from 'sonner';

import CouncilDetailPage from '../[id]/page';

import type { Council, CouncilTopic } from '@/models/models';
import '@testing-library/jest-dom';

/**
 * THE CARRY BUTTON ON A HELD COUNCIL, WITH THE ENGINE ON.
 *
 * Written to settle BUG-20260913-engine-carry-button-sees-no-targets. That entry read
 * `aria-expanded="false"` on the button as "the screen sees fewer than two destinations". The
 * attribute says the opposite: the page renders it only when there ARE two or more, and then the
 * first press opens a chooser — the carry itself is the second press. These tests pin all three
 * shapes of the button so the next reader does not have to infer them from an attribute.
 */

const mockCarry = jest.fn();
const mockPush = jest.fn();
const state: { council: Council | null; councils: Council[] } = { council: null, councils: [] };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: 'source' }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn() } }));
jest.mock('@/data-engine/react.client', () => ({ isCollectionOnEngine: () => true }));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/hooks/useCouncils', () => ({ useCouncil: jest.fn() }));
jest.mock('@/hooks/useCouncilsRead', () => ({
  useCouncilsRead: () => ({ councils: state.councils, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useCouncilDataDocument', () => ({
  useCouncilDataDocument: () => ({
    council: state.council, loading: false, error: null, status: null, confirmed: null, remote: null,
    refresh: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(),
    updateCouncil: jest.fn().mockResolvedValue(undefined), deleteCouncil: jest.fn().mockResolvedValue(undefined),
    carryTopicToNext: mockCarry, listRecoverable: jest.fn().mockResolvedValue([]), recover: jest.fn(),
  }),
}));

const topic: CouncilTopic = { id: 'topic-1', title: 'Porch repair', questions: [], options: [] };
const council = (id: string, status: Council['status'], topics: CouncilTopic[] = []): Council => ({
  id, userId: 'owner', title: `Council ${id}`, status, topics, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z',
  ...(status === 'held' ? { heldAt: '2026-09-10T10:00:00.000Z' } : {}),
});
const carryButton = () => screen.getByTestId('council-topic-carry-topic-1');

beforeEach(() => {
  jest.clearAllMocks();
  mockCarry.mockResolvedValue(undefined);
  state.council = council('source', 'held', [topic]);
});

describe('carrying a section from a held council through the engine', () => {
  it('asks where when two councils are being prepared, and carries on the second press', () => {
    state.councils = [state.council!, council('target-a', 'preparing'), council('target-b', 'preparing')];
    render(<CouncilDetailPage />);

    // The measurement the defect report misread: "false" means a closed chooser, not "no targets".
    expect(carryButton()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(carryButton());
    expect(carryButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('council-carry-chooser')).toBeInTheDocument();
    expect(mockCarry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Council target-b'));
    expect(mockCarry).toHaveBeenCalledTimes(1);
    expect(mockCarry).toHaveBeenCalledWith('source', topic, 'target-b');
    expect(toast.success).toHaveBeenCalled();
  });

  it('carries in one press when exactly one council is being prepared', () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    render(<CouncilDetailPage />);

    expect(carryButton()).not.toHaveAttribute('aria-expanded');
    fireEvent.click(carryButton());
    expect(mockCarry).toHaveBeenCalledWith('source', topic, 'only-target');
    expect(screen.queryByTestId('council-carry-chooser')).not.toBeInTheDocument();
  });

  it('tells the person to prepare a council first when there is nowhere to carry to', () => {
    state.councils = [state.council!];
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    expect(mockCarry).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('council.topic.carryNeedsTarget');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says so when the engine refuses the carry instead of leaving a silent button', async () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    mockCarry.mockRejectedValue(new Error('The destination council was deleted'));
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    expect(await screen.findByTestId('council-topic-carry-topic-1')).toBeInTheDocument();
    await Promise.resolve();
    expect(toast.error).toHaveBeenCalledWith('The destination council was deleted');
  });
});
