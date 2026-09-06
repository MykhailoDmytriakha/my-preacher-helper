import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import { PlanModeSwitch } from '@/(pages)/(private)/sermons/[id]/plan/PlanModeSwitch';
import { savePlanModeViaClient } from '@/services/sermons.client';
import '@testing-library/jest-dom';

import type { Sermon } from '@/models/models';

/**
 * WHICH EDITOR THIS PLAN IS KEPT IN — BUG-20260816-manual-plan-opens-in-ai-editor.
 *
 * Both plan screens write the same text, so nothing in the data told them apart and every
 * shortcut opened the paired AI screen. For a plan written by hand that is worse than a
 * detour: that screen used to show one cell per outline point, so text under sub-points was
 * not shown at all and the preacher met his own plan looking half empty.
 */

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/services/sermons.client', () => ({ savePlanModeViaClient: jest.fn() }));
jest.mock('@/utils/debugMode', () => ({ debugLog: jest.fn() }));

const mockToastError = jest.fn();
jest.mock('sonner', () => ({ toast: { error: (...a: unknown[]) => mockToastError(...a) } }));

const sermon = { id: 's1', title: 'Град Божий' } as unknown as Sermon;
const mockSave = savePlanModeViaClient as jest.MockedFunction<typeof savePlanModeViaClient>;

beforeEach(() => {
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
});

describe('the plan editor switch', () => {
  it('allows repeated note/manual round trips when navigation reuses the mounted switch', async () => {
    const linked = { ...sermon, sourceNoteIds: ['n'] };
    const view = render(<PlanModeSwitch sermon={linked} current="note" />);

    for (const mode of ['manual', 'note', 'manual', 'note'] as const) {
      const label = mode === 'manual' ? 'plan.modeManual' : 'plan.fromNote.mode';
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() => expect(mockSave).toHaveBeenLastCalledWith('s1', mode));
      await waitFor(() => expect(mockPush).toHaveBeenLastCalledWith(
        mode === 'note' ? '/sermons/s1/plan/manual?source=note' : '/sermons/s1/plan/manual'
      ));
      // Saving has finished, but navigation has not committed the new current prop yet.
      expect(screen.getByRole('button', { name: label })).toBeDisabled();
      view.rerender(<PlanModeSwitch sermon={{ ...linked, planMode: mode }} current={mode} />);
      await waitFor(() => expect(screen.getByRole('button', { name: label })).toBeEnabled());
    }
    expect(mockSave).toHaveBeenCalledTimes(4);
  });

  it('offers the note mode only with a source and guards unsaved text before switching', async () => {
    const guard = jest.fn().mockResolvedValue(false);
    const view = render(<PlanModeSwitch sermon={{ ...sermon, sourceNoteIds: ['n'] }} current="manual" beforeSwitch={guard} />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.mode' }));
    await waitFor(() => expect(guard).toHaveBeenCalled());
    expect(mockSave).not.toHaveBeenCalled();
    guard.mockResolvedValue(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'plan.fromNote.mode' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'plan.fromNote.mode' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/s1/plan/manual?source=note'));
    expect(mockSave).toHaveBeenCalledWith('s1', 'note');
    view.rerender(<PlanModeSwitch sermon={sermon} current="manual" />);
    expect(screen.queryByRole('button', { name: 'plan.fromNote.mode' })).not.toBeInTheDocument();
  });
  it('shows which editor this plan is kept in', () => {
    render(<PlanModeSwitch sermon={sermon} current="manual" />);

    expect(screen.getByRole('button', { name: 'plan.modeManual' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'plan.modeFromThoughts' })).toHaveAttribute('aria-pressed', 'false');
  });

  /**
   * RECORD FIRST, TRAVEL SECOND. Navigating first would leave the other screen deciding what
   * it is from a sermon that still says the old thing — and on a slow connection the person
   * would arrive, look at the toggle, and see it pointing back where they came from.
   */
  it('records the choice before opening the other editor', async () => {
    const order: string[] = [];
    mockSave.mockImplementation(async () => { order.push('saved'); });
    mockPush.mockImplementation(() => { order.push('navigated'); });

    render(<PlanModeSwitch sermon={sermon} current="manual" />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.modeFromThoughts' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/s1/plan'));
    expect(mockSave).toHaveBeenCalledWith('s1', 'ai');
    expect(order).toEqual(['saved', 'navigated']);
  });

  it('opens the hand-written editor when that is chosen', async () => {
    render(<PlanModeSwitch sermon={sermon} current="ai" />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.modeManual' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/sermons/s1/plan/manual'));
    expect(mockSave).toHaveBeenCalledWith('s1', 'manual');
  });

  it('does nothing when the editor already open is chosen again', () => {
    render(<PlanModeSwitch sermon={sermon} current="manual" />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.modeManual' }));

    expect(mockSave).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  /**
   * A FAILED SWITCH MUST NOT TRAVEL. Arriving on the other screen while the sermon still says
   * the old thing is how the toggle starts lying about where the plan lives.
   */
  it('stays put and says so when the choice could not be recorded', async () => {
    mockSave.mockRejectedValue(new Error('offline'));

    render(<PlanModeSwitch sermon={sermon} current="manual" />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.modeFromThoughts' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('plan.modeSwitchFailed'));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('tells the screen the new mode, so it need not wait for a refetch', async () => {
    const onSwitched = jest.fn();

    render(<PlanModeSwitch sermon={sermon} current="manual" onSwitched={onSwitched} />);
    fireEvent.click(screen.getByRole('button', { name: 'plan.modeFromThoughts' }));

    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith('ai'));
  });
});
