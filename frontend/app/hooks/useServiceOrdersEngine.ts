import { useCallback, useMemo, useRef, useState } from 'react';

import { isLiveCollectionDocument, useDataCollection, useDocumentActions } from '@/data-engine/react.client';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { StaleWriteError } from '@/services/conflictSafeUpdate.client';
import { SERVICE_ORDER_META_AGGREGATE, hydrateServiceOrder } from '@/services/serviceOrders.client';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { buildSeedOrders, SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';
import { needsRenumber, rankForAppend, rankForMove, renumber, sortByRank } from '@/utils/serviceOrderRank';
import { nextServiceOrderSeedId } from '@/utils/serviceOrderSeedIdentity';
import { useTranslation } from '@locales/useTranslation';

import type { ActionTime } from '@/data-engine/actionClock';
import type { CollectionState } from '@/data-engine/collections';
import type { ServiceOrderTitleSeen } from '@/data-engine/documentFieldAction';
import type { DocumentData, EditorCommitAction, ResourceSnapshot } from '@/data-engine/types';
import type { ServiceOrder, ServiceOrderCatalogKey, ServiceOrderStep } from '@/models/models';

const resource = (id: string) => ({ collection: 'serviceOrders', id });
const now = () => new Date().toISOString();
const notFound = () => new Error('Service order not found');
const baselineKey = (id: string, session: string) => `${id}\u0000${session}`;
const asOrder = (value: DocumentData, id: string) => hydrateServiceOrder(value as unknown as Omit<ServiceOrder, 'id'>, id);
const rowsOf = (documents: readonly { resource: { id: string }; value: DocumentData | null }[] | undefined) =>
  sortByRank((documents ?? []).flatMap(row => row.value ? [asOrder(row.value, row.resource.id)] : []));

type TitleBaseline = { title: string; revision: number; seen?: ServiceOrderTitleSeen };

function confirmedOrderRows(state: CollectionState | null | undefined, id: string): ResourceSnapshot[] {
  const acknowledged = state?.documents?.find(row => row.resource.id === id)?.acknowledged;
  return [acknowledged, state?.snapshots?.find(snapshot => snapshot.resource.id === id)]
    .filter((snapshot): snapshot is ResourceSnapshot => Boolean(snapshot?.value && snapshot.metadata && !snapshot.metadata.deleted));
}

function confirmedTitle(state: CollectionState | null | undefined, id: string, shown?: TitleBaseline): ServiceOrderTitleSeen | undefined {
  const match = confirmedOrderRows(state, id).find(row => typeof row.value?.title === 'string'
    && (!shown || (row.value.title === shown.title
      && (asOrder(row.value, id).rev?.meta ?? 0) === shown.revision)));
  return match && { title: match.value!.title as string, generation: match.metadata!.generation, revision: match.metadata!.revision };
}

function shownTitle(state: CollectionState | null | undefined, id: string, shown: TitleBaseline): ServiceOrderTitleSeen | undefined {
  const row = state?.documents?.find(document => document.resource.id === id);
  const submitted = row?.submittedTitle;
  return submitted?.title === shown.title && row?.value?.title === shown.title
    ? submitted : confirmedTitle(state, id, shown);
}

/**
 * ORDERS OF SERVICE ON THE ENGINE — the interface the list, the rite's own page and the breadcrumb
 * use (useServiceOrders).
 *
 * What the legacy hook had to build by hand the engine already gives: the rows are the server's
 * copy plus this device's own submitted work, so there is no write fence against a read landing
 * on top of a write, and every change is laid over the CURRENT document and merged on the server
 * (steps by their id), so a step written on the phone survives a step written on the laptop.
 *
 * A title Save carries the copy shown when editing began. An action with no calibrated
 * time keeps the existing stale-write check before it can change that copy.
 *
 * Offline, creating a rite and rearranging now work: each is a durable command that is delivered
 * on reconnect. Seeding still needs the server, because only a fresh list says which rites of the
 * standard set are missing.
 */
export type ServiceOrderTitleHistorySession = {
  owner: string;
  orderId: string;
  generation: string;
  restore: (title: string) => Promise<void>;
};

export function useServiceOrdersEngine(userId: string | null | undefined, enabled: boolean) {
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();
  const collection = useDataCollection(enabled && userId ? 'serviceOrders' : null);
  const actions = useDocumentActions();
  const activeOwner = useRef(userId);
  activeOwner.current = userId;
  const [seeding, setSeeding] = useState(false);
  const seedPending = useRef<{ owner: string; promise: Promise<ServiceOrder[]> } | null>(null);
  const [savingSteps, setSavingSteps] = useState(0);
  const [moving, setMoving] = useState(false);
  const movePending = useRef(false);
  const baselines = useRef(new Map<string, TitleBaseline>());
  const collectionState = useRef(collection.state);
  collectionState.current = collection.state;
  const queues = useRef(new Map<string, Promise<unknown>>());

  const orders = useMemo(() => rowsOf(collection.state?.documents?.filter(isLiveCollectionDocument)), [collection.state?.documents]);

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

  /**
   * Asked always (owner's rule 3), believed only from the server: "absent" is said when THIS refresh
   * reached the server. Without a connection the engine answers from what the device holds, and a
   * rite created on the laptop is simply not there yet — that is "unreachable", never "deleted".
   */
  // Stable on purpose, like the legacy hook's: the page waits on it inside an effect, and a new
  // function every render restarted that effect and dropped the answer it was waiting for.
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const recheck = useCallback(async (id: string): Promise<'found' | 'absent' | 'unreachable' | 'overlapped'> => {
    try {
      const presence = await collectionRef.current.refreshPresence(id);
      if (presence.kind === 'present' || presence.kind === 'creating') return 'found';
      return presence.kind === 'absent' ? 'absent' : 'unreachable';
    } catch {
      return 'unreachable';
    }
  }, []);

  /** Complete server absence chooses one target; the server transaction ensures its catalog key once. */
  const seedStandardSet = (): Promise<ServiceOrder[]> => {
    if (!userId) return Promise.reject(new Error('No user'));
    if (seedPending.current?.owner === userId) return seedPending.current.promise;
    if (!isOnline) return Promise.reject(new Error('OFFLINE_SEED'));
    const work = { owner: userId, promise: Promise.resolve<ServiceOrder[]>([]) };
    seedPending.current = work;
    setSeeding(true);
    work.promise = (async () => {
      try {
        const state = await collection.refresh() as CollectionState;
        if (state.error) throw new Error(state.error);
        if (!state.complete || state.freshness !== 'server') throw new Error('OFFLINE_SEED');
        const fresh = rowsOf(state.documents);
        const present = new Set(fresh.map(order => order.catalogKey).filter(Boolean));
        const drafts = buildSeedOrders(userId, t as unknown as (key: string, options?: Record<string, unknown>) => unknown,
          SERVICE_ORDER_CATALOG.filter(key => !present.has(key)), rankForAppend(fresh));
        const created: ServiceOrder[] = [];
        for (const draft of drafts) {
          const id = nextServiceOrderSeedId(userId, draft.catalogKey!, state.snapshots);
          await actions.create(resource(id), deepCleanUndefined(draft) as unknown as DocumentData);
          created.push({ ...draft, id });
        }
        return sortByRank([...fresh, ...created]);
      } finally {
        if (seedPending.current === work) { seedPending.current = null; setSeeding(false); }
      }
    })();
    return work.promise;
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
        // Assigned inside the commit callback, so the type is stated: TypeScript would narrow it to null.
        return committed as ServiceOrderStep[] | null;
      } finally {
        setSavingSteps(count => count - 1);
      }
    });

  const renameOrder = (id: string, title: string, session: string, time?: ActionTime) =>
    queued(id, async () => {
      const key = baselineKey(id, session);
      const held = baselines.current.get(key);
      if (title === held?.title) return held.revision;
      let refusal: StaleWriteError | null = null;
      let revision: number | null = null;
      const seen = held && (held.seen ?? shownTitle(collectionState.current, id, held));
      const action: EditorCommitAction | undefined = seen && time ? { kind: 'service-order-title', title: { seen, time } } : undefined;
      const update = (current: DocumentData | null) => {
        refusal = null;
        if (!current) throw notFound();
        const stored = (current.rev as Record<string, number> | undefined)?.[SERVICE_ORDER_META_AGGREGATE] ?? 0;
        if (!action && held && current.title !== held.title && current.title !== title) {
          refusal = new StaleWriteError(SERVICE_ORDER_META_AGGREGATE, held.revision, stored, { title: current.title });
          return current;
        }
        revision = stored + Number(current.title !== title);
        return { ...current, title, updatedAt: now() };
      };
      const receipt = seen ? await actions.submit(resource(id), { kind: 'update', update }, action ? { action } : undefined) : null;
      if (!seen) await actions.commit(resource(id), update);
      const refused = refusal as StaleWriteError | null;
      if (refused) {
        const serverTitle = refused.serverValues?.title;
        if (typeof serverTitle === 'string') baselines.current.set(key, { title: serverTitle, revision: refused.actualRevision });
        throw refused;
      }
      if (held && revision !== null) {
        const shown = { title, revision };
        const nextSeen = confirmedTitle(collectionState.current, id, shown)
          ?? (seen && receipt?.requestId ? { ...seen, title, requestId: receipt.requestId } : undefined);
        baselines.current.set(key, { ...shown, ...(nextSeen && { seen: nextSeen }) });
      }
      return revision;
    });

  const titleHistory = (id: string): ServiceOrderTitleHistorySession | undefined => {
    const seen = confirmedTitle(collection.state, id);
    if (!userId || !seen) return undefined;
    return {
      owner: userId, orderId: id, generation: seen.generation,
      restore: async title => {
        if (activeOwner.current !== userId) throw new Error('The service order owner changed');
        const current = confirmedTitle(collectionState.current, id);
        if (!current || current.generation !== seen.generation) throw notFound();
        if (current.title === title) return;
        const time = actions.captureActionTime();
        const action: EditorCommitAction | undefined = time ? { kind: 'service-order-title', title: { seen: current, time } } : undefined;
        await actions.commit(resource(id), value => {
          if (!value) throw notFound();
          if (value.title !== current.title) throw Object.assign(new Error('The service order title changed'), { code: 'stale-write' });
          return { ...value, title, updatedAt: now() };
        }, action);
      },
    };
  };

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
    orderPresence: collection.presence,
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
      if (!baselines.current.has(key)) {
        const seen = shownTitle(collectionState.current, id, opening);
        baselines.current.set(key, { ...opening, ...(seen && { seen }) });
      }
    },
    closedEditing: (id: string, session: string) => queued(id, async () => { baselines.current.delete(baselineKey(id, session)); }),
    renameOrder,
    captureTitleTime: actions.captureActionTime,
    titleHistory,
    savingSteps: savingSteps > 0,
    moveOrder,
    moving,
  };
}

