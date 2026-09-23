import { act, renderHook } from '@testing-library/react';

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
  return renderHook(() => usePrayerRequestsEngine('u', true));
}

describe('prayers on the engine', () => {
  beforeEach(() => { jest.clearAllMocks(); current = stored; });

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

  it('adds an update, answers the prayer and creates a new one through engine actions', async () => {
    const { result } = render();
    await act(async () => { await result.current.addUpdate('p1', 'Doctor visit went well').persistence; });
    expect(current.updates).toEqual([expect.objectContaining({ text: 'Doctor visit went well' })]);
    await act(async () => { await result.current.setStatus('p1', 'answered', 'Healed').persistence; });
    expect(current).toEqual(expect.objectContaining({ status: 'answered', answerText: 'Healed', answeredAt: expect.any(String) }));
    let created!: { prayerId: string };
    await act(async () => { created = result.current.createPrayer({ userId: 'u', title: 'New request' }); await (created as never as { persistence: Promise<void> }).persistence; });
    expect(actions.create).toHaveBeenCalledWith({ collection: 'prayerRequests', id: created.prayerId },
      expect.objectContaining({ userId: 'u', title: 'New request', status: 'active', updates: [] }));
  });
});
