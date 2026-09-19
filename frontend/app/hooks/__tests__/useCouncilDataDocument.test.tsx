import { act, renderHook, waitFor } from '@testing-library/react';

import { useDataDocument } from '@/data-engine/react.client';
import { useCouncilDataDocument } from '@/hooks/useCouncilDataDocument';

import type { DocumentData } from '@/data-engine/types';
import type { Council, CouncilTopic } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'), useDataDocument: jest.fn(),
}));

const topic = (id: string, extra: Partial<CouncilTopic> = {}): CouncilTopic =>
  ({ id, title: `Topic ${id}`, questions: [], options: [], ...extra });
const stored = (topics: CouncilTopic[] = [topic('t1')]): DocumentData => ({
  userId: 'owner', title: 'Council', status: 'preparing', topics, createdAt: 'then', updatedAt: 'then',
} as unknown as DocumentData);

function setup(value: DocumentData | null = stored(), overrides: Record<string, unknown> = {}) {
  const update = jest.fn().mockResolvedValue(undefined);
  const commit = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);
  jest.mocked(useDataDocument).mockReturnValue({
    data: value, confirmed: null, remote: null, status: null, loading: false, error: null,
    update, commit, remove, retry: jest.fn(), acceptRemote: jest.fn(), keepLocal: jest.fn(), ...overrides,
  } as unknown as ReturnType<typeof useDataDocument>);
  return { ...renderHook(() => useCouncilDataDocument('council-1')), update, commit, remove };
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
    const { result, update, commit } = setup();
    await act(async () => { await result.current.carryTopicToNext('council-1', topic('t1'), 'target'); });

    const next = applied(commit, stored()) as unknown as Council;
    expect(next.topics[0]).toMatchObject({ id: 't1', carriedToCouncilId: 'target' });
    // Exactly one write leaves the screen: the destination copy is not the screen's business.
    expect(commit).toHaveBeenCalledTimes(1);
    // A carry is an ACT, saved at once as its own request. Left to the shared autosave, two
    // carries inside its 750 ms window land in one draft, and the policy refuses a save that
    // moves two sections — each carry must reach the engine alone.
    expect(update).not.toHaveBeenCalled();
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

  // A page load gives the editor a new identity, so an unfinished edit from the previous load
  // stays on disk unclaimed. The engine offers it deliberately instead of applying it silently;
  // the screen has to be able to show that offer, with enough text to recognise it by.
  it('offers unfinished work with a preview a person can recognise', async () => {
    const listRecoverable = jest.fn().mockResolvedValue([
      { id: 'left-behind', record: { checkpoint: {
        draft: { title: 'Council', topics: [{ id: 't1', title: 'Section nobody saved' }] },
        confirmed: { value: { title: 'Council', topics: [] } },
      } } },
    ]);
    const recover = jest.fn().mockResolvedValue(undefined);
    const { result } = setup(stored(), { listRecoverable, recover });

    const choices = await result.current.listRecoverable();
    expect(choices).toEqual([{ id: 'left-behind', title: 'Council', preview: 'Section nobody saved' }]);

    await act(async () => { await result.current.recover('left-behind'); });
    expect(recover).toHaveBeenCalledWith('left-behind');
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
