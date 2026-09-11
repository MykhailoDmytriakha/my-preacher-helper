import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';

import { getClientDb } from '@/config/firebaseClientDb';
import { atomicUpdate } from '@/services/atomicUpdate.client';
import {
  conflictSafeUpdate,
  revisionBump,
  revisionedBatch,
  revisionedUpdate,
} from '@/services/conflictSafeUpdate.client';
import { readOwnerList, readOwnerListFromServer } from '@/services/ownerListRead.client';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { sortByRank } from '@/utils/serviceOrderRank';

import type { ServiceOrder, ServiceOrderStep } from '@/models/models';

export const SERVICE_ORDERS_COLLECTION = 'serviceOrders';
const SERVICE_ORDER_NOT_FOUND = 'Service order not found';

/**
 * Independently edited parts of an order. Kept apart so renaming it, rewriting one step and
 * dragging it up the list never collide: a false conflict teaches a person to click through
 * the dialog, which is worse than having no dialog at all.
 */
export const SERVICE_ORDER_META_AGGREGATE = 'meta';
export const SERVICE_ORDER_STEPS_AGGREGATE = 'steps';
export const SERVICE_ORDER_PLACEMENT_AGGREGATE = 'placement';

/**
 * What a document is allowed to be missing and still be usable. A rite written before a field
 * existed, a partial write, a value typed into the console: none of it should reach a screen a
 * pastor opens at a graveside as a crash.
 */
export function hydrateServiceOrder(data: Omit<ServiceOrder, 'id'>, id: string): ServiceOrder {
  const steps = Array.isArray(data.steps) ? data.steps : [];
  return {
    ...data,
    id,
    title: typeof data.title === 'string' ? data.title : '',
    steps: steps
      .filter((step): step is ServiceOrderStep => Boolean(step) && typeof step.id === 'string')
      .map((step) => ({
        ...step,
        title: typeof step.title === 'string' ? step.title : '',
        scriptureRefs: Array.isArray(step.scriptureRefs) ? step.scriptureRefs : [],
      })),
    rank: typeof data.rank === 'number' && Number.isFinite(data.rank) ? data.rank : Number.MAX_SAFE_INTEGER,
  };
}

/** The same shaping for both roads: the browser's own read and the server's answer. */
const shapeServiceOrders = (documents: Record<string, unknown>[]): ServiceOrder[] =>
  sortByRank(
    documents.map((data) =>
      hydrateServiceOrder(data as unknown as Omit<ServiceOrder, 'id'>, String(data.id ?? ''))
    )
  );

async function readServiceOrdersViaSdk(userId: string): Promise<ServiceOrder[]> {
  const db = getClientDb();
  const snap = await getDocs(
    query(collection(db, SERVICE_ORDERS_COLLECTION), where('userId', '==', userId))
  );
  return shapeServiceOrders(snap.docs.map((d) => ({ ...(d.data() as object), id: d.id })));
}

/**
 * TWO ROADS TO THE SAME DATABASE, through the one helper every owner list uses.
 *
 * This section was the first to meet the silent transport — on the owner's iPad the browser's
 * Firestore answers nothing at all, and a list read with one road and no deadline waited for
 * ever under its heading. The rule that came out of it is not local to rites: it is written once
 * in `ownerListRead.client.ts` and every list in the app now reads through it.
 */
export async function getAllServiceOrdersViaClient(userId: string): Promise<ServiceOrder[]> {
  return readOwnerList(
    SERVICE_ORDERS_COLLECTION,
    userId,
    readServiceOrdersViaSdk(userId),
    shapeServiceOrders
  );
}

/**
 * THE SAME LIST, BUT IT IS NOT ALLOWED TO ANSWER FROM THE CACHE.
 *
 * Silence from a cache is indistinguishable from silence from the server, and that is fine for
 * filling a screen and useless for the one question worth asking: is this rite really gone? So
 * this asks the app's own server and nothing else — which on the silent device is the only road
 * that answers at all, and which cannot answer from anything local by construction.
 */
export async function getAllServiceOrdersFromServerViaClient(userId: string): Promise<ServiceOrder[]> {
  return readOwnerListFromServer(SERVICE_ORDERS_COLLECTION, userId, shapeServiceOrders);
}

/**
 * Creates a new order and lets Firestore name it.
 *
 * An earlier draft gave a seeded rite a NAME derived from itself (`<uid>_funeral`) and called
 * the result idempotent. It is not: a write to an id that already exists REPLACES what is
 * there, so a seed queued on one device could hand back the blank starting sequence over words written
 * on another. Which rite this is belongs in a FIELD (`catalogKey`), where a second copy is a
 * duplicate rather than a silent overwrite — and the caller only ever creates the rites the
 * loaded list does not have.
 */
export async function createServiceOrderViaClient(
  order: Omit<ServiceOrder, 'id'>
): Promise<ServiceOrder> {
  const db = getClientDb();
  const created = await addDoc(
    collection(db, SERVICE_ORDERS_COLLECTION),
    deepCleanUndefined(order)
  );
  return { ...order, id: created.id };
}

/** Title, summary — the fields the order names itself by. */
/**
 * Returns the revision the write COMMITTED at, and the caller is expected to keep it.
 *
 * Dropping it is a quiet trap: the guard compares against what the editor believes, so after one
 * successful rename the browser still believes the old number while the server has moved on, and
 * the next perfectly ordinary rename is refused as a conflict that never happened.
 */
export async function updateServiceOrderMetaViaClient(
  id: string,
  updates: Partial<Pick<ServiceOrder, 'title' | 'summary'>>,
  expectedRevision: number | null = null,
  /** The values the form OPENED with — never a fresh read, which compares the server to itself. */
  expectedBaseline: Record<string, unknown> | null = null,
  userId?: string
): Promise<number | null> {
  const db = getClientDb();
  const ref = doc(db, SERVICE_ORDERS_COLLECTION, id);
  const patch = deepCleanUndefined({ ...updates, updatedAt: new Date().toISOString() });

  if (expectedRevision !== null) {
    return conflictSafeUpdate(ref, patch, SERVICE_ORDER_NOT_FOUND, {
      aggregate: SERVICE_ORDER_META_AGGREGATE,
      expectedRevision,
      expectedBaseline,
      outboxRoute: userId
        ? { uid: userId, collection: SERVICE_ORDERS_COLLECTION, docId: id, savedAt: Date.now() }
        : undefined,
    });
  }
  // Deliberately unguarded, but never bare: `revisionedUpdate` still advances the counter, or
  // the guard would lie to the next writer and hand a stale save permission to overwrite.
  await revisionedUpdate(ref, patch, SERVICE_ORDER_META_AGGREGATE);
  return null;
}

/**
 * Every change to the steps goes through here, because `steps` is written as a whole array:
 * the laptop rewriting step three and the phone flagging step seven would otherwise each save
 * their own copy of the list and the later one would erase the other. `atomicUpdate` rebuilds
 * the patch from the document as it IS at the moment of writing, and re-runs it if that moved.
 */
export async function updateServiceOrderStepsViaClient(
  id: string,
  /** Receives the stored steps; returns the new list, or `null` to leave the document alone. */
  mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null
): Promise<ServiceOrderStep[] | null> {
  const db = getClientDb();
  const ref = doc(db, SERVICE_ORDERS_COLLECTION, id);

  /*
   * WHAT COMES BACK IS WHAT WAS STORED, not what the caller hoped to store.
   *
   * The mutator runs inside the transaction, against the document as it IS — which is the whole
   * point of it. So the list it produced there is the only truthful answer, and the caller needs
   * exactly that: to show it, and to retire the draft it belongs to. Reporting the caller's own
   * guess instead is how a screen and a database begin to disagree without anyone noticing.
   */
  let committed: ServiceOrderStep[] | null = null;

  await atomicUpdate<Omit<ServiceOrder, 'id'>>(
    ref,
    (data) => {
      /*
       * EACH ATTEMPT DECIDES ANEW. The transaction re-runs when the document moved underneath
       * it, and the list the ABANDONED attempt produced is not what was stored — it was thrown
       * away. Leaving it here would let the page confirm, and a draft be retired, against a
       * version that never existed on the server.
       */
      committed = null;
      const current = hydrateServiceOrder(data, id);
      const steps = mutate(current.steps);
      if (!steps) return null;
      committed = steps;
      return {
        steps: deepCleanUndefined(steps),
        updatedAt: new Date().toISOString(),
        ...revisionBump(SERVICE_ORDER_STEPS_AGGREGATE),
      };
    },
    SERVICE_ORDER_NOT_FOUND
    /*
     * NO TRANSIENT REPLAY HERE, deliberately.
     *
     * `atomicUpdate` offers to queue a failed write for replay, and that is right for an
     * APPEND keyed by its own id — repeating it finds itself already stored. These writes
     * REPLACE: a title, a paragraph, a flag. A replay that wakes up after another device
     * saved newer words puts the old ones back, and nobody is told. Better to fail loudly
     * while the text is still in the field in front of the person who typed it.
     */
  );

  return committed;
}

/**
 * Where the order sits in the list. One document, one write — see `serviceOrderRank.ts`.
 *
 * Unguarded on purpose: two devices disagreeing about the order of a list is not a conflict
 * worth a dialog, and refusing the move would leave the person staring at a row that sprang
 * back. The counter still moves, so an edit to the WORDS can still be refused properly.
 */
export async function setServiceOrderRankViaClient(id: string, rank: number): Promise<void> {
  const db = getClientDb();
  await revisionedUpdate(
    doc(db, SERVICE_ORDERS_COLLECTION, id),
    { rank, updatedAt: new Date().toISOString() },
    SERVICE_ORDER_PLACEMENT_AGGREGATE
  );
}

/**
 * Spreads the whole list out again, all documents or none.
 *
 * This is the repair for a list whose numbers have run out of room between rows, and it is
 * meaningless in halves: a refusal in the middle of one-by-one writes leaves the pastor's
 * arrangement partly rewritten on the server with no way back from the browser.
 */
export async function setServiceOrderRanksViaClient(
  entries: { id: string; rank: number }[]
): Promise<void> {
  const db = getClientDb();
  const updatedAt = new Date().toISOString();
  await revisionedBatch(
    entries.map(({ id, rank }) => ({
      ref: doc(db, SERVICE_ORDERS_COLLECTION, id),
      patch: { rank, updatedAt },
      aggregate: SERVICE_ORDER_PLACEMENT_AGGREGATE,
    }))
  );
}

export async function deleteServiceOrderViaClient(id: string): Promise<void> {
  const db = getClientDb();
  await deleteDoc(doc(db, SERVICE_ORDERS_COLLECTION, id));
}
