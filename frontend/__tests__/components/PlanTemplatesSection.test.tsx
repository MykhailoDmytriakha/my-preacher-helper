import { act, render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import React from 'react';

import '@testing-library/jest-dom';

import type { User } from 'firebase/auth';
import type { PlanTemplate } from '@/models/models';
import { persistedWrite, queuedWrite } from '@/utils/recoverableWrite';

const mockCreate = jest.fn((_payload: unknown) => persistedWrite(Promise.resolve(undefined)));
const mockUpdate = jest.fn(() => persistedWrite(Promise.resolve(undefined)));
const mockDelete = jest.fn(() => persistedWrite(Promise.resolve(undefined)));
const mockRefresh = jest.fn().mockResolvedValue({ isError: false });
let mockTemplates: PlanTemplate[] = [];

jest.mock('@/hooks/usePlanTemplates', () => ({
  usePlanTemplates: () => ({
    templates: mockTemplates,
    loading: false,
    createTemplate: mockCreate,
    updateTemplate: mockUpdate,
    deleteTemplate: mockDelete,
    refresh: mockRefresh,
  }),
}));

jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

// headless-ui Dialog/Transition is awkward in jsdom; stub the confirm dialog to a
// minimal passthrough so we test OUR wiring (open -> confirm -> delete), not the lib.
jest.mock('@/components/ui/ConfirmModal', () => {
  const React = require('react');
  return {
    __esModule: true,
    default: ({ isOpen, onConfirm, onClose, title, confirmText }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; title: string; confirmText?: string }) =>
      isOpen
        ? React.createElement(
            'div',
            { role: 'dialog' },
            React.createElement('span', null, title),
            React.createElement('button', { onClick: onConfirm }, confirmText),
            React.createElement('button', { onClick: onClose }, 'cancel-mock')
          )
        : null,
  };
});

import PlanTemplatesSection from '@/components/settings/PlanTemplatesSection';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';

const user = { uid: 'u1' } as unknown as User;

const tpl = (id: string, name: string, points = 0): PlanTemplate => ({
  id,
  userId: 'u1',
  name,
  structure: {
    introduction: Array.from({ length: points }, (_, i) => ({ id: `${id}-i${i}`, text: `p${i}` })),
    main: [],
    conclusion: [],
  },
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
});

beforeEach(() => {
  jest.clearAllMocks();
  mockTemplates = [];
});
afterEach(cleanup);

describe('PlanTemplatesSection', () => {
  it('creates a template with a client id, the user id and an empty structure', async () => {
    render(<PlanTemplatesSection user={user} />);

    const input = screen.getByPlaceholderText('planTemplates.createPlaceholder');
    fireEvent.change(input, { target: { value: 'Parable analysis' } });
    fireEvent.click(screen.getByText('planTemplates.create'));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    const payload = mockCreate.mock.calls[0]?.[0] as PlanTemplate;
    expect(payload).toEqual(
      expect.objectContaining({ userId: 'u1', name: 'Parable analysis' })
    );
    expect(payload.id).toBeTruthy();
    expect(payload.structure).toEqual({ introduction: [], main: [], conclusion: [] });
  });

  it('lists existing templates with their point counts', () => {
    mockTemplates = [tpl('t1', 'Alpha', 3), tpl('t2', 'Beta', 1)];
    render(<PlanTemplatesSection user={user} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/^3 /)).toBeInTheDocument();
  });

  it('deletes a template after confirming in the dialog', async () => {
    mockTemplates = [tpl('t1', 'Alpha', 2)];
    render(<PlanTemplatesSection user={user} />);

    fireEvent.click(screen.getByLabelText('common.delete')); // opens the ConfirmModal
    const confirmBtn = await screen.findByText('common.delete'); // dialog confirm button (text)
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('t1'));
  });

  it('renames a template', async () => {
    mockTemplates = [tpl('t1', 'Alpha', 0)];
    render(<PlanTemplatesSection user={user} />);

    fireEvent.click(screen.getByLabelText('common.edit'));
    const input = screen.getByDisplayValue('Alpha');
    fireEvent.change(input, { target: { value: 'Alpha renamed' } });
    fireEvent.click(screen.getByLabelText('common.save'));

    // Third argument = the revision this edit was built from, so a rename from a
    // tab that never saw another device's change is refused, not applied.
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('t1', { name: 'Alpha renamed' }, 0));
  });

  it('shows a newly added point immediately, before any refetch', () => {
    // The hook mock never feeds back the saved structure, so if the board read
    // straight from the cache the point would never render. The local draft
    // buffer must show it on Enter — regression guard for the ~1s "it vanished".
    mockTemplates = [tpl('t1', 'Alpha', 0)];
    render(<PlanTemplatesSection user={user} />);

    fireEvent.click(screen.getByLabelText('common.expand'));
    fireEvent.click(screen.getAllByText('structure.addPointButton')[0]); // Introduction column

    const pointInput = screen.getByPlaceholderText('structure.addPointPlaceholder');
    fireEvent.change(pointInput, { target: { value: 'New point' } });
    fireEvent.keyDown(pointInput, { key: 'Enter' });

    // Visible right away — no waitFor, no updateTemplate round-trip needed.
    expect(screen.getByText('New point')).toBeInTheDocument();
  });
});

/**
 * A refused rename must not evaporate.
 *
 * `renamingId` is cleared before the request, so by the time the refusal arrives
 * the input is gone. A bare toast therefore announced a loss instead of
 * preventing one — adversarial review's P1.
 */
describe('PlanTemplatesSection — a refused edit offers the choice', () => {
  beforeEach(() => {
    localStorage.clear();
    mockUpdate.mockReset();
    mockRefresh.mockReset().mockResolvedValue({ isError: false });
    mockTemplates = [tpl('t1', 'Alpha')];
  });

  const renameTo = async (value: string) => {
    fireEvent.click(screen.getByLabelText('common.edit'));
    fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value } });
    fireEvent.click(screen.getByLabelText('common.save'));
  };

  it('holds the typed name and shows both choices', async () => {
    mockUpdate.mockReturnValueOnce(persistedWrite(Promise.reject(new StaleWriteError('template', 0, 5))));
    render(<PlanTemplatesSection user={user} />);

    await renameTo('Alpha renamed');

    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('Alpha renamed')).toBeInTheDocument();
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
  });

  it('offers the choice when the conflict arrives AFTER the write was accepted', async () => {
    /**
     * The production path, and the one the earlier test missed. A template write is
     * owned by the durable queue, so acceptance resolves a tick after launch and the
     * transaction's verdict lands LATE — in the late-failure callback, not in the
     * editor's catch. With that callback empty, the person got a generic refusal
     * instead of "keep mine / take theirs", and the typed name left the closed input.
     */
    // The rejection must land AFTER acceptance, or it arrives in the editor's catch and
    // the late path is never exercised — which is exactly how this defect hid.
    let rejectLater: (error: unknown) => void = () => undefined;
    const persistence = new Promise<never>((_resolve, reject) => {
      rejectLater = reject as (error: unknown) => void;
    });
    void persistence.catch(() => undefined);
    mockUpdate.mockReturnValueOnce(queuedWrite('plan-template:update:late', persistence));
    render(<PlanTemplatesSection user={user} />);

    await renameTo('Renamed on the other device');
    // Let ACCEPTANCE happen first — it yields one macrotask — so the rejection below is
    // genuinely late. Without this wait it lands in the editor's catch and the late
    // path, where the defect lived, is never exercised.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      rejectLater(new StaleWriteError('template', 0, 5));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('Renamed on the other device')).toBeInTheDocument();
    expect(screen.getByText('freshness.conflictKeepMine')).toBeInTheDocument();
  });

  it('re-sends with the server revision when "keep mine" is chosen', async () => {
    mockUpdate.mockReturnValueOnce(persistedWrite(Promise.reject(new StaleWriteError('template', 0, 5))));
    render(<PlanTemplatesSection user={user} />);
    await renameTo('Alpha renamed');
    await screen.findByText('freshness.conflictTitle');

    mockUpdate.mockReturnValueOnce(persistedWrite(Promise.resolve(undefined)));
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));

    // 5, not 0 — otherwise the resend is refused again and the button lies.
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith('t1', { name: 'Alpha renamed' }, 5)
    );
  });

  it('brings the choice back when the resend is refused LATE, not before acceptance', async () => {
    /**
     * Production hands this button a `queuedWrite`: acceptance arrives a tick later and a
     * second refusal lands AFTER it. Nobody was listening — the screen passed an empty
     * late-failure callback, and the update descriptor ignores stale errors on purpose
     * (they are a choice, not a message). The rename, or an entire plan structure, was
     * left with no banner, no message and nothing to copy.
     */
    mockUpdate.mockReturnValueOnce(persistedWrite(Promise.reject(new StaleWriteError('template', 0, 5))));
    render(<PlanTemplatesSection user={user} />);
    await renameTo('Alpha renamed');
    await screen.findByText('freshness.conflictTitle');

    // Accepted by the queue first, refused by the server afterwards.
    let refuseLate: (error: unknown) => void = () => undefined;
    const persistence = new Promise<void>((_resolve, reject) => {
      refuseLate = reject;
    });
    mockUpdate.mockReturnValueOnce(queuedWrite('outbox:plan-template:t1', persistence));

    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(2));

    await act(async () => {
      refuseLate(new StaleWriteError('template', 5, 9));
      await Promise.resolve();
    });

    // The choice is back, aimed at what the server holds NOW.
    await screen.findByText('freshness.conflictTitle');
    fireEvent.click(screen.getByText('freshness.conflictKeepMine'));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenLastCalledWith('t1', { name: 'Alpha renamed' }, 9)
    );
  });

  it('keeps two refused templates apart and finds them after a reload', async () => {
    // One shared slot meant the second refusal erased the first, and a key derived
    // from state nobody has on mount could never be found again after a reload.
    mockTemplates = [tpl('t1', 'Alpha'), tpl('t2', 'Beta')];
    // Reject the rename, but keep a default for any other save the screen makes —
    // an undefined return would blow up on `.catch` and hide the real assertion.
    mockUpdate.mockReturnValueOnce(persistedWrite(Promise.reject(new StaleWriteError('template', 0, 5))));
    mockUpdate.mockImplementation(() => persistedWrite(Promise.resolve(undefined)));

    const first = render(<PlanTemplatesSection user={user} />);
    fireEvent.click(screen.getAllByLabelText('common.edit')[0]);
    fireEvent.change(screen.getByDisplayValue('Alpha'), { target: { value: 'Alpha renamed' } });
    fireEvent.click(screen.getByLabelText('common.save'));
    await screen.findByText('freshness.conflictTitle');
    first.unmount();

    // A reload: fresh mount, nothing in memory — the refusal must still be found.
    render(<PlanTemplatesSection user={user} />);

    expect(await screen.findByText('freshness.conflictTitle')).toBeInTheDocument();
    expect(screen.getByText('Alpha renamed')).toBeInTheDocument();
  });

});
