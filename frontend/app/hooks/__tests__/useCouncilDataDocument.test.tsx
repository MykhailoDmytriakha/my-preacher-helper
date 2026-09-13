import { act, renderHook, waitFor } from '@testing-library/react';

import { useDataDocument } from '@/data-engine/react.client';
import { useCouncilDataDocument } from '@/hooks/useCouncilDataDocument';

import type { DocumentData } from '@/data-engine/types';
import type { Council, CouncilTopic } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({ useDataDocument: jest.fn() }));

const topic = (id: string, extra: Partial<CouncilTopic> = {}): CouncilTopic =>
  ({ id, title: `Topic ${id}`, questions: [], options: [], ...extra });
const stored = (topics: CouncilTopic[] = [topic('t1')]): DocumentData => ({
  userId: 'owner', title: 'Council', status: 'preparing', topics, createdAt: 'then', updatedAt: 'then',
} as unknown as DocumentData);

function setup(value: DocumentData | null = stored(), overrides: Record<string, unknown> = {}) {
  const update = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useDataDocument).mockReturnValue({
    data: value, confirmed: null, remote: null, status: null, loading: false, error: null,
    update, remove, retry: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(), ...overrides,
  } as unknown as ReturnType<typeof useDataDocument>);
  return { ...renderHook(() => useCouncilDataDocument('council-1')), update, remove };
}

const applied = (update: jest.Mock, current: DocumentData | null): DocumentData | null =>
  (update.mock.calls[0][0] as (value: DocumentData | null) => DocumentData | null)(current);

beforeEach(() => jest.clearAllMocks());

describe('useCouncilDataDocument', () => {
  it('gives the screen the council it already understands, with its own id', () => {
    const { result } = setup();
    expect(result.current.council).toMatchObject({ id: 'council-1', title: 'Council', topics: [{ id: 't1' }] });
    expect(result.current.loading).toBe(false);
  });

  it('applies the screen updater to the live draft and stamps the change time', async () => {
    const { result, update } = setup();
    await act(async () => { await result.current.updateCouncil('council-1', current => ({ ...current, title: 'Renamed' })); });

    const next = applied(update, stored());
    expect(next).toMatchObject({ title: 'Renamed' });
    expect(next!.updatedAt).not.toBe('then');
    // The id lives in the address, never inside the stored fields.
    expect(next).not.toHaveProperty('id');
  });

  it('carries a section by marking it, leaving the destination to the engine', async () => {
    const { result, update } = setup();
    await act(async () => { await result.current.carryTopicToNext('council-1', topic('t1'), 'target'); });

    const next = applied(update, stored()) as unknown as Council;
    expect(next.topics[0]).toMatchObject({ id: 't1', carriedToCouncilId: 'target' });
    // Exactly one write leaves the screen: the destination copy is not the screen's business.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('refuses to carry a section that was already carried', async () => {
    const { result } = setup(stored([topic('t1', { carriedToCouncilId: 'elsewhere' })]));
    await expect(result.current.carryTopicToNext('council-1', topic('t1'), 'target')).rejects.toThrow();
  });

  it('deletes through the editor rather than by emptying the document', async () => {
    const { result, remove, update } = setup();
    await act(async () => { await result.current.deleteCouncil('council-1'); });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });

  it('reports a missing council as absent instead of pretending it is empty', async () => {
    const { result } = setup(null);
    expect(result.current.council).toBeNull();
    await expect(result.current.updateCouncil('council-1', current => current)).rejects.toThrow();
  });

  it('opens the document for this council and forwards status, error and retry', async () => {
    const retry = jest.fn();
    const { result } = setup(stored(), { error: 'engine offline', retry });
    expect(jest.mocked(useDataDocument)).toHaveBeenCalledWith({ collection: 'councils', id: 'council-1' }, expect.anything());
    expect(result.current.error).toBe('engine offline');
    await act(async () => { await result.current.refresh(); });
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  });
});
