import { act, fireEvent, render as renderComponent, renderHook, screen, within } from '@testing-library/react';
import React from 'react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { usePrayerRequestsEngine } from '@/hooks/usePrayerRequestsEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));

const stored = { userId: 'u', title: 'Healing', description: 'Phone text', status: 'active', updates: [], createdAt: 'c', updatedAt: 'u', rev: { core: 2 } };
let current: Record<string, unknown> = stored;
const actions = {
  ready: true, create: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined),
  commit: jest.fn(async (_resource: unknown, updater: (value: Record<string, unknown>) => Record<string, unknown>) => { current = updater(current); }),
};

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockReturnValue({ state: { snapshots: [], documents: [{ resource: { collection: 'prayerRequests', id: 'p1' }, value: stored }],
    complete: true, freshness: 'server', checking: false, version: 1, error: null }, loading: false, error: null, refresh: jest.fn() } as never);
  return renderHook(() => usePrayerRequestsEngine('u', 'p1', true));
}

describe('prayers on the engine', () => {
  beforeEach(() => { jest.clearAllMocks(); current = stored; window.localStorage.clear(); });

  it('refuses an edit of a field rewritten elsewhere, keeps the document, and keeping mine overwrites on purpose', async () => {
    const { result } = render();
    let error: unknown;
    await act(async () => { error = await result.current.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).persistence.catch(e => e); });
    expect(isStaleWriteError(error)).toBe(true);
    expect(current.description).toBe('Phone text');
    expect(result.current.saveConflict).toEqual(expect.objectContaining({ payload: { id: 'p1', updates: { description: 'Laptop text' } } }));
    await act(async () => { await result.current.keepMineOnConflict(); });
    expect(current.description).toBe('Laptop text');
    expect(result.current.saveConflict).toBeNull();
  });

  it('keeps the refused text across leaving the screen, and retires it only when the resend lands', async () => {
    const first = render();
    await act(async () => { await first.result.current.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).persistence.catch(() => undefined); });
    first.unmount();
    const second = render();
    expect(second.result.current.saveConflict).toEqual(expect.objectContaining({ payload: { id: 'p1', updates: { description: 'Laptop text' } } }));
    await act(async () => { await second.result.current.keepMineOnConflict(); });
    expect(current.description).toBe('Laptop text');
    second.unmount();
    expect(render().result.current.saveConflict).toBeNull();
  });

  it('asks before discarding a refused prayer edit, and cancel keeps its durable conflict', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer() {
      latest = usePrayerRequestsEngine('u', 'p1', true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnConflict()}>take core</button></>;
    }
    renderComponent(<Consumer />);
    await act(async () => {
      await latest.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).persistence.catch(() => undefined);
    });
    const pending = latest.saveConflict;

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take core' })); });
    const dialog = await screen.findByRole('dialog');
    expect(latest.saveConflict).toBe(pending);
    await act(async () => { fireEvent.click(within(dialog).getAllByRole('button')[1]); });
    expect(latest.saveConflict).toBe(pending);
    expect(window.localStorage.length).toBeGreaterThan(0);
  });

  it('asks before discarding a refused prayer answer and confirms only that answer conflict', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer() {
      latest = usePrayerRequestsEngine('u', 'p1', true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnStatusConflict()}>take answer</button></>;
    }
    renderComponent(<Consumer />);
    await act(async () => {
      await latest.setStatus('p1', 'answered', 'Laptop answer', undefined, { answerText: 'Old answer' }).persistence.catch(() => undefined);
    });
    const pending = latest.statusConflict;

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take answer' })); });
    const dialog = await screen.findByRole('dialog');
    expect(latest.statusConflict).toBe(pending);
    await act(async () => { fireEvent.click(within(dialog).getAllByRole('button')[0]); });
    expect(latest.statusConflict).toBeNull();
    expect(latest.saveConflict).toBeNull();
    expect(current.answerText).toBeUndefined();
  });

  it('withdraws an open Take Theirs question when its prayer scope changes', async () => {
    let latest!: ReturnType<typeof usePrayerRequestsEngine>;
    function Consumer({ docId }: { docId: string }) {
      latest = usePrayerRequestsEngine('u', docId, true);
      return <>{latest.discardDialog}<button onClick={() => void latest.takeTheirsOnConflict()}>take core</button></>;
    }
    const view = renderComponent(<Consumer docId="p1" />);
    await act(async () => {
      await latest.updatePrayer('p1', { description: 'Laptop text' }, 1, { description: 'Old text' }).persistence.catch(() => undefined);
    });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'take core' })); });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    view.rerender(<Consumer docId="p2" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(window.localStorage.length).toBeGreaterThan(0);
    expect(latest.saveConflict).toBeNull();
  });

  it('adds an update, answers the prayer and creates a new one through engine actions', async () => {
    const { result } = render();
    await act(async () => { await result.current.addUpdate('p1', 'Doctor visit went well').persistence; });
    expect(current.updates).toEqual([expect.objectContaining({ text: 'Doctor visit went well' })]);
    await act(async () => { await result.current.setStatus('p1', 'answered', 'Healed').persistence; });
    expect(current).toEqual(expect.objectContaining({ status: 'answered', answerText: 'Healed', answeredAt: expect.any(String) }));
    let created!: ReturnType<typeof result.current.createPrayer>;
    await act(async () => { created = result.current.createPrayer({ userId: 'u', title: 'New request' }); await created; });
    expect(actions.create).toHaveBeenCalledWith({ collection: 'prayerRequests', id: created.prayerId },
      expect.objectContaining({ userId: 'u', title: 'New request', status: 'active', updates: [] }));
  });
});
