import { act, renderHook } from '@testing-library/react';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useServiceOrdersEngine } from '@/hooks/useServiceOrdersEngine';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';

import type { ServiceOrderStep } from '@/models/models';

jest.mock('@/data-engine/react.client', () => ({
  ...jest.requireActual('@/data-engine/react.client'),
  useDataCollection: jest.fn(),
  useDocumentActions: jest.fn(),
}));

let online = true;
jest.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { returnObjects?: boolean }) => (options?.returnObjects ? ['Opening prayer'] : key) }),
}));

type Row = Record<string, unknown>;
/** A store that keeps what the writes put in it; the collection is read from it on every render. */
let store: Map<string, Row>;
const step = (id: string, title: string): ServiceOrderStep => ({ id, title, body: '', scriptureRefs: [] });
const order = (id: string, extra: Row = {}): Row => ({
  userId: 'u', title: id, steps: [], rank: 1000, createdAt: 'c', updatedAt: 'u', ...extra,
});
const documents = () => [...store].map(([id, value]) => ({ resource: { collection: 'serviceOrders', id }, value }));
const actions = {
  ready: true,
  create: jest.fn(async (resource: { id: string }, value: Row) => { store.set(resource.id, value); }),
  remove: jest.fn(async (resource: { id: string }) => { store.delete(resource.id); }),
  commit: jest.fn(async (resource: { id: string }, updater: (value: Row | null) => Row | null) => {
    const next = updater(store.get(resource.id) ?? null);
    if (next) store.set(resource.id, next);
  }),
};

function render() {
  jest.mocked(useDocumentActions).mockReturnValue(actions as never);
  jest.mocked(useDataCollection).mockImplementation(() => ({
    state: { snapshots: [], documents: documents(), complete: true, freshness: 'server', checking: false, version: 1, error: null },
    loading: false, error: null, refresh: jest.fn(async () => ({ documents: documents() })),
  }) as never);
  return renderHook(() => useServiceOrdersEngine('u', true));
}

describe('orders of service on the engine', () => {
  beforeEach(() => { jest.clearAllMocks(); online = true; store = new Map(); });

  it('lays a step change over the current rite, so a step added on another device survives', async () => {
    store.set('o1', order('o1', { steps: [step('s1', 'Welcome')] }));
    const { result } = render();
    // The phone added a step after this screen read the rite.
    store.set('o1', order('o1', { steps: [step('s1', 'Welcome'), step('s2', 'Added on the phone')] }));
    let committed: ServiceOrderStep[] | null = null;
    await act(async () => {
      committed = await result.current.updateSteps('o1', steps => steps.map(item => item.id === 's1' ? { ...item, title: 'Greeting' } : item));
    });
    expect((store.get('o1')!.steps as ServiceOrderStep[]).map(item => item.title)).toEqual(['Greeting', 'Added on the phone']);
    expect(committed).toEqual(store.get('o1')!.steps);
    let untouched: ServiceOrderStep[] | null | undefined;
    const before = store.get('o1');
    await act(async () => { untouched = await result.current.updateSteps('o1', () => null); });
    expect(untouched).toBeNull();
    expect(store.get('o1')).toBe(before);
  });

  it('refuses a rename when the title changed elsewhere since editing began, then accepts it against the title now shown', async () => {
    store.set('o1', order('o1', { title: 'Funeral', rev: { meta: 3 } }));
    const { result } = render();
    act(() => { result.current.openedWith('o1', { title: 'Funeral', revision: 3 }, 'sitting'); });
    store.set('o1', order('o1', { title: 'Burial service', rev: { meta: 4 } }));
    let error: unknown;
    await act(async () => { error = await result.current.renameOrder('o1', 'Funeral service', 'sitting').catch(e => e); });
    expect(isStaleWriteError(error)).toBe(true);
    expect((error as { serverValues?: Row }).serverValues).toEqual({ title: 'Burial service' });
    expect(store.get('o1')!.title).toBe('Burial service');
    let revision: number | null = null;
    await act(async () => { revision = await result.current.renameOrder('o1', 'Funeral service', 'sitting'); });
    expect(store.get('o1')!.title).toBe('Funeral service');
    // The stored counter belongs to the engine: the draft does not touch it.
    expect(store.get('o1')!.rev).toEqual({ meta: 4 });
    expect(revision).toBe(5);
  });

  it('seeds only the rites missing from a fresh list, each under a new id and after the existing ones', async () => {
    store.set('mine', order('mine', { catalogKey: 'funeral', rank: 5000 }));
    const { result } = render();
    await act(async () => { await result.current.seedStandardSet(); });
    const created = actions.create.mock.calls.map(([resource, value]) => ({ id: resource.id, ...value }) as Row & { id: string });
    expect(created.map(entry => entry.catalogKey)).toEqual(SERVICE_ORDER_CATALOG.filter(key => key !== 'funeral'));
    expect(created.every(entry => !String(entry.id).includes('__'))).toBe(true);
    expect(Math.min(...created.map(entry => entry.rank as number))).toBe(6000);
    online = false;
    const offline = render();
    await act(async () => {
      await expect(offline.result.current.seedStandardSet()).rejects.toThrow('OFFLINE_SEED');
    });
  });

  it('moves one rite with one write, and spreads a crowded list over every rite even offline', async () => {
    ['a', 'b', 'c'].forEach((id, index) => store.set(id, order(id, { rank: (index + 1) * 1000 })));
    const { result, rerender } = render();
    await act(async () => { await result.current.moveOrder('c', 0); });
    expect(actions.commit).toHaveBeenCalledTimes(1);
    expect(store.get('c')!.rank).toBeLessThan(1000);

    actions.commit.mockClear();
    ['a', 'b', 'c'].forEach(id => store.set(id, order(id, { rank: 1 })));
    online = false;
    rerender();
    await act(async () => { await result.current.moveOrder('a', 2); });
    expect(actions.commit).toHaveBeenCalledTimes(3);
    const placed = ['a', 'b', 'c'].map(id => ({ id, rank: store.get(id)!.rank as number })).sort((x, y) => x.rank - y.rank);
    expect(placed.map(entry => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('creates a custom rite at the end of the list and deletes through the engine', async () => {
    store.set('a', order('a', { rank: 2000 }));
    const { result } = render();
    let created!: { id: string; rank: number };
    await act(async () => { created = await result.current.createCustomOrder('  Blessing of a home  '); });
    expect(store.get(created.id)).toEqual(expect.objectContaining({ title: 'Blessing of a home', steps: [], rank: 3000, userId: 'u' }));
    await act(async () => { await result.current.deleteOrder('a'); });
    expect(actions.remove).toHaveBeenCalledWith({ collection: 'serviceOrders', id: 'a' });
  });
});
