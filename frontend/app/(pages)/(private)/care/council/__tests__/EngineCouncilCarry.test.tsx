import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { toast, type Action } from 'sonner';

import CouncilDetailPage from '../[id]/page';
import CouncilConductPage from '../[id]/conduct/page';

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
const mockUpdateCouncil = jest.fn().mockResolvedValue(undefined);
const mockPush = jest.fn();
const state: { council: Council | null; councils: Council[] } = { council: null, councils: [] };

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: 'source' }),
}));
jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn(), warning: jest.fn(), message: jest.fn() } }));
jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  isCollectionOnEngine: () => true,
  DataDocumentProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@/data-engine/DataSyncStatus', () => ({ DataSyncStatus: () => null }));
jest.mock('@/components/ui/RichMarkdownEditor', () => ({ RichMarkdownEditor: () => null }));
jest.mock('@/components/FloatingTextScaleControls', () => ({ __esModule: true, default: () => null }));
jest.mock('@/hooks/useUserSettings', () => ({ useUserSettings: () => ({ settings: { firstDayOfWeek: 'monday' } }) }));
jest.mock('@/components/council/CouncilOutcomeForm', () => ({
  CouncilOutcomeForm: ({ councilId, topicId }: { councilId: string; topicId: string }) => <div data-testid="engine-outcome-form">{councilId}/{topicId}</div>,
}));
jest.mock('@/hooks/useCouncilsRead', () => ({
  useCouncilsRead: () => ({ councils: state.councils, loading: false, error: null, refresh: jest.fn() }),
}));
jest.mock('@/hooks/useCouncilDataDocument', () => ({
  useCouncilDataDocument: () => ({
    council: state.council, loading: false, error: null, status: null, confirmed: null, remote: null,
    refresh: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(),
    updateCouncil: mockUpdateCouncil, deleteCouncil: jest.fn().mockResolvedValue(undefined),
    carryTopicToNext: mockCarry, listRecoverable: jest.fn().mockResolvedValue([]), recover: jest.fn(),
    recovery: { choices: [], loading: false, error: null, refresh: jest.fn(), recover: jest.fn() },
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
  mockUpdateCouncil.mockResolvedValue(undefined);
  state.council = council('source', 'held', [topic]);
});

describe('carrying a section from a held council through the engine', () => {
  it('routes held-outcome editing through the pinned engine form', () => {
    state.councils = [state.council!];
    render(<CouncilDetailPage />);
    fireEvent.click(screen.getByRole('button', { name: 'council.topic.editOutcome' }));
    expect(screen.getByTestId('engine-outcome-form')).toHaveTextContent('source/topic-1');
  });
  it('asks where when two councils are being prepared, and carries on the second press', async () => {
    state.councils = [state.council!, council('target-a', 'preparing'), council('target-b', 'preparing')];
    render(<CouncilDetailPage />);

    // The measurement the defect report misread: "false" means a closed chooser, not "no targets".
    expect(carryButton()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(carryButton());
    expect(carryButton()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('council-carry-chooser')).toBeInTheDocument();
    // "A new council" needs a create and a carry in one act, which the engine has no command for:
    // offered here it could only fail, so it is not offered.
    expect(screen.queryByText('council.topic.carryNew')).not.toBeInTheDocument();
    expect(mockCarry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Council target-b'));
    expect(mockCarry).toHaveBeenCalledTimes(1);
    expect(mockCarry).toHaveBeenCalledWith('source', topic, 'target-b');
    await waitFor(() => expect(toast.message).toHaveBeenCalled());
  });

  it('carries in one press when exactly one council is being prepared', () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    render(<CouncilDetailPage />);

    expect(carryButton()).not.toHaveAttribute('aria-expanded');
    fireEvent.click(carryButton());
    expect(mockCarry).toHaveBeenCalledWith('source', topic, 'only-target');
    expect(screen.queryByTestId('council-carry-chooser')).not.toBeInTheDocument();
  });

  it('offers the newly prepared council after the carry is saved locally', async () => {
    state.councils = [state.council!];
    const created = council('created-target', 'preparing', [{ ...topic, id: 'carried-topic' }]);
    mockCarry.mockResolvedValue(created);
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    await waitFor(() => expect(toast.message).toHaveBeenCalledWith('council.topic.carryPrepared', {
      action: { label: created.title, onClick: expect.any(Function) },
    }));
    expect(toast.error).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    const notice = jest.mocked(toast.message).mock.calls[0][1];
    render(<button onClick={(notice?.action as Action).onClick}>Open prepared council</button>);
    fireEvent.click(screen.getByRole('button', { name: 'Open prepared council' }));
    expect(mockPush).toHaveBeenCalledWith('/care/council/created-target');
  });

  it('waits for durable capture before announcing the destination', async () => {
    const target = council('only-target', 'preparing');
    state.councils = [state.council!, target];
    let finish!: (value: Council) => void;
    mockCarry.mockReturnValue(new Promise<Council>(resolve => { finish = resolve; }));
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    await act(async () => { finish(target); });
    expect(toast.message).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps a failed carry from announcing success', async () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    mockCarry.mockRejectedValue(new Error('Device storage refused the action'));
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.message).not.toHaveBeenCalled();
    expect(carryButton()).toBeInTheDocument();
  });

  it('does not capture the same carry twice while its first capture is pending', async () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    mockCarry.mockReturnValue(new Promise(() => undefined));
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    fireEvent.click(carryButton());
    expect(mockCarry).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says so when the engine refuses the carry instead of leaving a silent button', async () => {
    state.councils = [state.council!, council('only-target', 'preparing')];
    mockCarry.mockRejectedValue(Object.assign(new Error('The destination council was deleted'), { code: 'referenced-document-deleted' }));
    render(<CouncilDetailPage />);

    fireEvent.click(carryButton());
    expect(await screen.findByTestId('council-topic-carry-topic-1')).toBeInTheDocument();
    await Promise.resolve();
    // The person is told in the interface language which council is gone, not the engine's own sentence.
    expect(toast.error).toHaveBeenCalledWith('council.topic.carryTargetDeleted');
  });
});


describe('council action notices do not claim server acceptance', () => {
  it.each([false, true])('describes only the prepared carry when a new destination is %s', async (createNew) => {
    const target = council('target', 'preparing');
    state.councils = createNew ? [state.council!] : [state.council!, target];
    mockCarry.mockResolvedValue(createNew ? target : undefined);
    render(<CouncilDetailPage />);
    await act(async () => { fireEvent.click(carryButton()); });
    expect(mockCarry).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith('council.topic.carryPrepared', { action: { label: target.title, onClick: expect.any(Function) } });
  });

  it.each([
    ['detail', CouncilDetailPage, 'council-finish-here'],
    ['conduct', CouncilConductPage, 'council-finish'],
  ] as const)('keeps an immediate neutral undo on the %s screen while delivery is pending', (_name, Page, button) => {
    state.council = council('source', 'preparing', [{ ...topic, discussed: true }]);
    state.councils = [state.council];
    render(<Page />);
    fireEvent.click(screen.getByTestId(button));
    expect(mockUpdateCouncil).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith('council.detail.finishUndoAvailable', { duration: 8000, action: { label: 'council.detail.undo', onClick: expect.any(Function) } });
    const options = jest.mocked(toast.message).mock.calls[0][1];
    render(<button onClick={(options?.action as Action).onClick}>Undo council finish</button>);
    fireEvent.click(screen.getByRole('button', { name: 'Undo council finish' }));
    expect(mockUpdateCouncil).toHaveBeenCalledTimes(2);
    const held = mockUpdateCouncil.mock.calls[0][1](state.council);
    expect(mockUpdateCouncil.mock.calls[1][1](held)).toMatchObject({ status: 'preparing', topics: state.council.topics });
  });
});
