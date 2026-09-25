import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERVICE_ORDER_META_AGGREGATE, hydrateServiceOrder } from '@/services/serviceOrders.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { buildSeedOrders, SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';
import { needsRenumber, rankForAppend, rankForMove, renumber, sortByRank } from '@/utils/serviceOrderRank';

import type { DocumentData } from '@/data-engine/types';
import type { ServiceOrdersApi } from '@/hooks/useServiceOrders';
import type { ServiceOrder, ServiceOrderCatalogKey, ServiceOrderStep } from '@/models/models';

const resource = (id: string) => ({ collection: 'serviceOrders', id });
const now = () => new Date().toISOString();
const notFound = () => new Error('Service order not found');
const baselineKey = (id: string, session: string) => `${id}\u0000${session}`;
const asOrder = (value: DocumentData, id: string) => hydrateServiceOrder(value as unknown as Omit<ServiceOrder, 'id'>, id);
const rowsOf = (documents: readonly { resource: { id: string }; value: DocumentData | null }[] | undefined) =>
  sortByRank((documents ?? []).flatMap(row => row.value ? [asOrder(row.value, row.resource.id)] : []));

/**
 * ORDERS OF SERVICE ON THE ENGINE — the same interface as the legacy hook (useServiceOrders), so
 * the list, the rite's own page and the breadcrumb do not change.
 *
 * What the legacy hook had to build by hand the engine already gives: the rows are the server's
 * copy plus this device's own submitted work, so there is no write fence against a read landing
 * on top of a write, and every change is laid over the CURRENT document and merged on the server
 * (steps by their id), so a step written on the phone survives a step written on the laptop.
 *
 * Kept from the legacy hook, because the engine cannot know it: a title changed elsewhere since
 * the person started editing refuses the rename with the other title, so the screen can offer it.
 *
 * Offline, creating a rite and rearranging now work: each is a durable command that is delivered
 * on reconnect. Seeding still needs the server, because only a fresh list says which rites of the
 * standard set are missing.
 */
export function useServiceOrdersEngine(userId: string | null | undefined, enabled: boolean): ServiceOrdersApi {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const collection = useDataCollection(enabled && userId ? 'serviceOrders' : null);
  const actions = useDocumentActions();
  const [seeding, setSeeding] = useState(false);
  const [savingSteps, setSavingSteps] = useState(0);
  const [moving, setMoving] = useState(false);
  const movePending = useRef(false);
  const baselines = useRef(new Map<string, { title: string; revision: number }>());
  const queues = useRef(new Map<string, Promise<unknown>>());

  const orders = useMemo(() => rowsOf(collection.state?.documents), [collection.state?.documents]);

  /** One rite's writes run in the order they were made, exactly as in the legacy hook. */
  const queued = useCallback(<T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.current.get(id) ?? Promise.resolve()).catch(() => undefined).then(run);
    queues.current.set(id, next.catch(() => undefined));
    return next;
  }, []);

  const missingCatalogKeys = useMemo<ServiceOrderCatalogKey[]>(() => {
    const present = new Set(orders.map(order => order.catalogKey).filter(Boolean));
    return SERVICE_ORDER_CATALOG.filter(key => !present.has(key));
  }, [orders]);

  const refresh = async () => { await collection.refresh(); };

  const recheck = async (id: string): Promise<'found' | 'absent' | 'unreachable' | 'overlapped'> => {
    if (!isOnline) return 'unreachable';
    try {
      const state = await collection.refresh() as { documents?: { resource: { id: string }; value: DocumentData | null }[] };
      return state.documents?.some(row => row.resource.id === id && row.value) ? 'found' : 'absent';
    } catch {
      return 'unreachable';
    }
  };

  /**
   * THE STANDARD SET, ONCE. The missing rites are taken from a list just read from the server,
   * not from the screen, and each is created under its own new id: a rite of the set that was
   * deleted before stays deleted under its old id (the engine never revives a tombstone), and a
   * fresh one takes its place.
   */
  const seedStandardSet = async (): Promise<ServiceOrder[]> => {
    if (!userId) throw new Error('No user');
    if (!isOnline) throw new Error('OFFLINE_SEED');
    setSeeding(true);
    try {
      const fresh = rowsOf((await collection.refresh() as { documents?: { resource: { id: string }; value: DocumentData | null }[] }).documents);
      const present = new Set(fresh.map(order => order.catalogKey).filter(Boolean));
      const drafts = buildSeedOrders(userId, t as unknown as (key: string, options?: Record<string, unknown>) => unknown,
        SERVICE_ORDER_CATALOG.filter(key => !present.has(key)), rankForAppend(fresh));
      const created: ServiceOrder[] = [];
      for (const draft of drafts) {
        const id = newClientId();
        await actions.create(resource(id), deepCleanUndefined(draft) as unknown as DocumentData);
        created.push({ ...draft, id });
      }
      return sortByRank([...fresh, ...created]);
    } finally {
      setSeeding(false);
    }
  };

  const createCustomOrder = async (title: string): Promise<ServiceOrder> => {
    if (!userId) throw new Error('No user');
    const at = now();
    const order: Omit<ServiceOrder, 'id'> = { userId, title: title.trim(), steps: [], rank: rankForAppend(orders), createdAt: at, updatedAt: at };
    const id = newClientId();
    await actions.create(resource(id), order as unknown as DocumentData);
    return { ...order, id };
  };

  /** The deletion carries what this device last saw, so a rite edited elsewhere meanwhile is not taken. */
  const deleteOrder = (id: string) => queued(id, () => actions.remove(resource(id)));

  const updateSteps = (id: string, mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null) =>
    queued(id, async () => {
      setSavingSteps(count => count + 1);
      let committed: ServiceOrderStep[] | null = null;
      try {
        await actions.commit(resource(id), current => {
          committed = null;
          if (!current) throw notFound();
          const steps = mutate(asOrder(current, id).steps);
          if (!steps) return current;
          committed = steps;
          return { ...current, steps: deepCleanUndefined(steps) as unknown as DocumentData[], updatedAt: now() };
        });
        return committed;
      } finally {
        setSavingSteps(count => count - 1);
      }
    });

  const renameOrder = (id: string, title: string, session: string) =>
    queued(id, async () => {
      const key = baselineKey(id, session);
      const held = baselines.current.get(key);
      if (title === held?.title) return held.revision;
      let refusal: StaleWriteError | null = null;
      let revision: number | null = null;
      await actions.commit(resource(id), current => {
        refusal = null;
        if (!current) throw notFound();
        const stored = (current.rev as Record<string, number> | undefined)?.[SERVICE_ORDER_META_AGGREGATE] ?? 0;
        if (held && current.title !== held.title && current.title !== title) {
          refusal = new StaleWriteError(SERVICE_ORDER_META_AGGREGATE, held.revision, stored, { title: current.title });
          return current;
        }
        // The engine moves the stored counter itself; this is the value it will reach.
        revision = stored + 1;
        return { ...current, title, updatedAt: now() };
      });
      const refused = refusal as StaleWriteError | null;
      if (refused) {
        const serverTitle = refused.serverValues?.title;
        if (typeof serverTitle === 'string') baselines.current.set(key, { title: serverTitle, revision: refused.actualRevision });
        throw refused;
      }
      if (held && revision !== null) baselines.current.set(key, { title, revision });
      return revision;
    });

  /**
   * One command per rite whose place changes. Each carries an absolute rank and is durable on its
   * own, so a spread interrupted by a lost connection finishes on reconnect instead of staying
   * half-applied; the list shows the new order at once from this device's submitted work.
   */
  const moveOrder = async (id: string, toIndex: number): Promise<void> => {
    if (movePending.current) return;
    movePending.current = true;
    setMoving(true);
    try {
      const rank = rankForMove(orders, id, toIndex);
      let writes: { id: string; rank: number }[];
      if (rank !== null && !needsRenumber(orders)) writes = [{ id, rank }];
      else {
        const spread = new Map(renumber(orders).map(entry => [entry.id, entry.rank]));
        const evened = orders.map(order => ({ ...order, rank: spread.get(order.id) ?? order.rank }));
        const settled = rankForMove(evened, id, toIndex);
        if (settled !== null) spread.set(id, settled);
        writes = [...spread].map(([documentId, value]) => ({ id: documentId, rank: value }));
      }
      for (const entry of writes) {
        await queued(entry.id, () => actions.commit(resource(entry.id), current => {
          if (!current) throw notFound();
          return current.rank === entry.rank ? current : { ...current, rank: entry.rank, updatedAt: now() };
        }));
      }
    } finally {
      movePending.current = false;
      setMoving(false);
    }
  };

  return {
    orders,
    loading: Boolean(userId) && enabled && collection.loading,
    error: collection.error ? new Error(collection.error) : null,
    isOnline,
    recheck,
    refresh,
    canSeed: missingCatalogKeys.length > 0,
    seeding,
    seedStandardSet,
    createCustomOrder,
    deleteOrder,
    updateSteps,
    openedWith: (id: string, opening: { title: string; revision: number }, session: string) => {
      const key = baselineKey(id, session);
      if (!baselines.current.has(key)) baselines.current.set(key, opening);
    },
    closedEditing: (id: string, session: string) => queued(id, async () => { baselines.current.delete(baselineKey(id, session)); }),
    renameOrder,
    savingSteps: savingSteps > 0,
    moveOrder,
    moving,
  };
}

