import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useResolvedUid } from '@/hooks/useResolvedUid';
import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import {
  createServiceOrder,
  deleteServiceOrder,
  getAllServiceOrders,
  getAllServiceOrdersFromServer,
  setServiceOrderRank,
  setServiceOrderRanks,
  updateServiceOrderMeta,
  updateServiceOrderSteps,
} from '@/services/serviceOrders.service';
import { seedServiceOrdersOnServer } from '@/services/serviceOrdersReadFallback.client';
import { serviceOrderListKey } from '@/utils/queryKeys';
import { buildSeedOrders, SERVICE_ORDER_CATALOG } from '@/utils/serviceOrderCatalog';
import {
  needsRenumber,
  rankForAppend,
  rankForMove,
  renumber,
  sortByRank,
} from '@/utils/serviceOrderRank';
import {
  moveWriteFence,
  readOverlappedAWrite,
  readWriteFence,
} from '@/utils/serviceOrderWriteFence';

import type { ServiceOrder, ServiceOrderCatalogKey, ServiceOrderStep } from '@/models/models';

/**
 * The pastor's orders of service — a reference book, one document per rite.
 *
 * SOME WRITES HERE REFUSE TO RUN OFFLINE, ON PURPOSE.
 *
 * Creating and seeding do not resolve until the server has the document, so offline they would
 * simply never answer: a button spinning for ever and a page that never opens the rite it
 * promised. Deleting is worse than that — a deletion queued on a phone with no signal arrives
 * whenever the signal returns and takes with it whatever another device wrote in between, and
 * there is no baseline it could be refused against.
 *
 * Everything a person TYPES stays available offline — that is the whole point of the app —
 * and lives on the order's own screen, not here.
 */
export function useServiceOrders(
  userId?: string | null,
  /**
   * `false` keeps the hook silent. The breadcrumb needs an order's TITLE only while standing
   * on one, and a list query that runs on every page in the app to satisfy that would be a
   * network read for nothing on all of them.
   */
  options?: { enabled?: boolean }
) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const isOnline = useOnlineStatus();
  const { uid: resolvedUid } = useResolvedUid();
  const effectiveUserId = userId ?? resolvedUid ?? null;
  const listKey = serviceOrderListKey(effectiveUserId ?? undefined);

  /**
   * A READ THAT IS ALREADY IN THE AIR MUST NOT LAND ON TOP OF A WRITE.
   *
   * `getDocs` started a moment before a successful mutation resolves a moment after it, with the
   * list as it was BEFORE — and replaces everything the mutation just patched. The reorder path
   * learned this first; every other writer here has the same hole, so they all go through the
   * same door now.
   */
  const beforeWriting = useCallback(
    () => queryClient.cancelQueries({ queryKey: listKey }),
    [queryClient, listKey]
  );

  /**
   * A CANCELLED READ WAS STILL A LEGITIMATE READ.
   *
   * Cancelling protects the patch this write just made, but the answer it threw away may have
   * carried another device's change to a different service entirely. Marking the list stale —
   * without fetching now, which would cost a read per keystroke — means the next natural moment
   * brings it in: opening the page, reconnecting, or coming back to the tab. That last one is
   * not free by default; the query asks for it above, because otherwise a tab left open all
   * evening never learns anything and this sentence would be a promise the page cannot keep.
   */
  const afterWriting = useCallback(
    () => queryClient.invalidateQueries({ queryKey: listKey, refetchType: 'none' }),
    [queryClient, listKey]
  );

  /**
   * A READ THAT OVERLAPPED A WRITE DOES NOT GET TO PUBLISH.
   *
   * Cancelling covers the reads already in the air when a write starts; this covers the other
   * side of the same second. A tab regaining focus in the middle of a step transaction issues a
   * read that can see the document as it was BEFORE the commit and land after it — putting the
   * old paragraph back on screen. That is not merely a stale screen: with nothing unsaved, the
   * editor's fields follow the document, so the pastor types on top of the old words and saves
   * them for real.
   *
   * TWO EARLIER SHAPES WERE WRONG, and both ways are worth remembering. Reconciling the server
   * list against the cache document by document — the way `readFreshness` does — keeps a local
   * copy the server does not have, so a rite deleted on the laptop would stay on the phone for
   * ever: a stale screen that never heals instead of one that does. Making the read WAIT for
   * the write was worse in two ways at once: the gate lived in a hook instance while the cache
   * it guards is shared by every screen holding the list, so the breadcrumb's copy of this hook
   * read straight through the editor's write; and a write stalled on a dying connection parked
   * the read for ever.
   *
   * So: a count, kept in the cache it protects, moved at the start and the end of every write.
   * A read that finds the count changed, or finds a write already under way when it began,
   * keeps what the cache has and asks again at the next natural moment. Nothing waits on
   * anything.
   */
  const fenceOwner = effectiveUserId ?? '';

  const readFence = useCallback(
    () => readWriteFence(queryClient, fenceOwner),
    [queryClient, fenceOwner]
  );

  const beginWrite = useCallback(
    () => moveWriteFence(queryClient, fenceOwner, 1),
    [queryClient, fenceOwner]
  );

  const endWrite = useCallback(
    () => moveWriteFence(queryClient, fenceOwner, -1),
    [queryClient, fenceOwner]
  );

  const {
    data: orders,
    isLoading: loading,
    error,
  } = useServerFirstQuery<ServiceOrder[]>({
    queryKey: listKey,
    queryFn: async () => {
      if (!effectiveUserId) return [];
      const before = readFence();
      const server = await getAllServiceOrders(effectiveUserId);
      const after = readFence();
      const kept = queryClient.getQueryData<ServiceOrder[]>(listKey);
      if (readOverlappedAWrite(before, after) && kept) {
        /*
         * Keeping the cache would leave this query looking freshly answered, so the list is
         * marked stale again — otherwise the read being discarded here would be the last one
         * for as long as the tab stayed open.
         *
         * A task, not a microtask: publishing a success CLEARS the invalidated mark, and the
         * publication happens after this function returns. Marked any sooner, the mark would be
         * wiped by the very result it was meant to qualify.
         */
        setTimeout(() => void afterWriting(), 0);
        return kept;
      }
      return server;
    },
    enabled: !!effectiveUserId && options?.enabled !== false,
    /*
     * COMING BACK TO THE TAB IS A MOMENT TO CHECK, and this list is cheap enough to mean it.
     * A write cancels whatever read is in the air and marks the list stale without fetching —
     * a read per keystroke would be absurd — so something changed on another device can sit
     * unseen in a tab that is never remounted. Ten documents on a focus is a fair price for a
     * reference book that is right when he looks at it.
     */
    refetchOnWindowFocus: true,
  });

  const list = useMemo(() => sortByRank(orders ?? []), [orders]);

  /**
   * Writes through the CURRENT cache, never through the list this render happened to see.
   * A late rollback or a slow success that rebuilt the whole list from a stale snapshot would
   * quietly undo a change the person made in between.
   */
  /**
   * BOTH HALVES OF THE BOUNDARY IN ONE ACT.
   *
   * They used to be two lines each writer had to remember, and the round that introduced the
   * second half showed exactly how that ends: it reached four mutations and missed two, so
   * creating a service and dragging one still cancelled a read and never asked for it back.
   * A boundary that CAN be half-applied eventually is. Wrapping the write instead of
   * decorating it leaves no version of this that runs one half without the other.
   */
  const writing = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      // Armed BEFORE the cancel, so a read starting in the gap between the two waits rather
      // than slipping past both.
      beginWrite();
      await beforeWriting();
      try {
        return await run();
      } finally {
        endWrite();
        await afterWriting();
      }
    },
    [beforeWriting, afterWriting, beginWrite, endWrite]
  );

  /**
   * ASK THE WHOLE LIST AGAIN. The page needs this when a read failed or is simply taking too
   * long: a screen with nothing on it and no way to try again is a screen that looks broken.
   */
  const refresh = useCallback(
    () => queryClient.refetchQueries({ queryKey: listKey }),
    [queryClient, listKey]
  );

  const write = useCallback(
    (update: (current: ServiceOrder[]) => ServiceOrder[]) =>
      queryClient.setQueryData<ServiceOrder[]>(listKey, (current) =>
        sortByRank(update(current ?? []))
      ),
    [queryClient, listKey]
  );

  /**
   * ASK THE SERVER ITSELF ABOUT ONE RITE, AND SAY WHETHER IT ANSWERED.
   *
   * A cached list is proof of what this device has seen, never proof that a rite does not
   * exist: opened from a link, or created on another device a minute ago, a perfectly real
   * service is simply absent from it. And an ordinary read is no better — it falls back to the
   * cache when Firestore cannot be reached, so its silence is indistinguishable from the
   * server's. Three answers, because the page owes three different sentences: it is here, the
   * server says it is gone, or nobody could be asked.
   *
   * Only the one document is merged into the list. Replacing the whole list from here would
   * make this read a writer, able to undo a change another page made while it was in the air.
   *
   * Stable on purpose — the page waits on it inside an effect, and a new function every render
   * would make that effect an endless one.
   */
  const recheck = useCallback(
    async (id: string): Promise<'found' | 'absent' | 'unreachable' | 'overlapped'> => {
      /*
       * The owner's whole list, not this one document, and deliberately so: the rules let a
       * person read a document that is HIS, and a document that no longer exists has no owner
       * to compare against — so asking for it by id answers "permission denied", which cannot
       * be told apart from a genuine refusal. The owner query answers "it is not among yours",
       * which is the sentence this function exists to obtain. Ten small documents, once, and
       * only when a rite appears to be missing.
       */
      if (!effectiveUserId) return 'unreachable';
      const before = readFence();
      let fromServer: ServiceOrder[];
      try {
        fromServer = await getAllServiceOrdersFromServer(effectiveUserId);
      } catch {
        return 'unreachable';
      }
      /*
       * FENCED LIKE ANY OTHER READ. A deletion can commit between this snapshot and the line
       * below, and merging a rite the snapshot still had would put back the very document the
       * delete just removed — on the screen of the person who deleted it.
       *
       * Said as its own answer rather than folded into "nobody could be asked": the caller can
       * simply ask again, and a rite that really is gone still gets to be reported as gone.
       */
      if (readOverlappedAWrite(before, readFence())) return 'overlapped';
      const found = fromServer.find((entry) => entry.id === id);
      if (!found) return 'absent';
      write((current) =>
        current.some((entry) => entry.id === id)
          ? current.map((entry) => (entry.id === id ? found : entry))
          : [...current, found]
      );
      return 'found';
    },
    [effectiveUserId, readFence, write]
  );

  /** Which rites of the standard set this person does not have yet. */
  const missingCatalogKeys = useMemo<ServiceOrderCatalogKey[]>(() => {
    const present = new Set(list.map((order) => order.catalogKey).filter(Boolean));
    return SERVICE_ORDER_CATALOG.filter((key) => !present.has(key));
  }, [list]);

  const seedMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveUserId) throw new Error('No user');
      if (!isOnline) throw new Error('OFFLINE_SEED');
      return writing(async () => {
        /*
         * THE WHOLE SET IS OFFERED AND THE SERVER DECIDES WHAT IS MISSING.
         *
         * Two reasons, and the second is why this moved. Deciding here needed a fresh read and
         * ten separate writes, and on a device where the browser's Firestore is silent both of
         * those hang — the pastor pressed the button and nothing at all happened. And deciding
         * here could only ever be a guess about the other device: two browsers that cannot see
         * each other both concluded "nothing is there" and left twenty rites behind. The server
         * sees the stored list once, creates only the rites whose key is not in it, and that
         * race is gone rather than narrowed.
         *
         * The WORDS are still built here: they are his language and live in the locale files.
         */
        const drafts = buildSeedOrders(
          effectiveUserId,
          t as unknown as (key: string, options?: Record<string, unknown>) => unknown,
          SERVICE_ORDER_CATALOG,
          rankForAppend(list)
        );
        const stored = await seedServiceOrdersOnServer(drafts);
        write(() => stored);
        return stored;
      });
    },
    // Even a seed that stopped half-way created documents. Without this the cache keeps
    // saying the list is empty, and the next press looks like the first one.
    onSettled: () => queryClient.invalidateQueries({ queryKey: listKey }),
  });

  const createCustomMutation = useMutation({
    mutationFn: async (title: string) => {
      if (!effectiveUserId) throw new Error('No user');
      /*
       * ONLINE ONLY, AND ENFORCED HERE — not merely announced by a disabled button.
       * `addDoc` does not resolve until the server has the document, so offline this call
       * simply never returns: the button would spin for ever and the page would never
       * navigate to the service it promised to create.
       */
      if (!isOnline) throw new Error('OFFLINE_CREATE');
      return writing(async () => {
        const now = new Date().toISOString();
        const order: Omit<ServiceOrder, 'id'> = {
          userId: effectiveUserId,
          title: title.trim(),
          steps: [],
          rank: rankForAppend(list),
          createdAt: now,
          updatedAt: now,
        };
        const created = await createServiceOrder(order);
        write((current) => [...current, created]);
        return created;
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      /*
       * ONLINE ONLY, ENFORCED. A deletion queued on a phone with no signal arrives whenever
       * the signal returns and takes the document with it — including the words another
       * device wrote in between, which this write has no way to notice.
       */
      if (!isOnline) throw new Error('OFFLINE_DELETE');
      return writing(async () => {
        await deleteServiceOrder(id);
        write((current) => current.filter((order) => order.id !== id));
      });
    },
  });

  /** The words themselves. Every step write rebuilds from the stored list — see the service. */
  /**
   * ONE WRITE AT A TIME PER SERVICE.
   *
   * Every step write rebuilds the whole array from the stored document, and two of them in
   * flight together can finish in the other order: the older transaction re-runs after the
   * newer one and puts the old text back. The pastor types "B", the document ends up with
   * "A", and nothing anywhere says so. Chaining per document costs nothing at this size and
   * removes the race entirely.
   */
  const queues = useRef(new Map<string, Promise<unknown>>());

  const queued = useCallback(<T,>(id: string, run: () => Promise<T>): Promise<T> => {
    const previous = queues.current.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    queues.current.set(id, next.catch(() => undefined));
    return next;
  }, []);

  /**
   * THE BASELINE OF A GUARDED RENAME BELONGS WHERE THE WRITES ARE SERIALISED, not where the
   * words are typed.
   *
   * The editor used to hold it, and that was wrong twice over. Two ordinary saves in a row both
   * captured the SAME opening number — the second was still waiting in the queue while the first
   * moved the server past it — and the pastor was told another device had changed his title when
   * the only device that touched it was his own. And because the editor cleared the baseline
   * after a success, every rename after the first carried none at all: the guard that exists to
   * refuse a stale save waved it through unchecked. Read at the moment the write actually runs
   * and moved to what the server committed, the baseline is true for every rename, not the first.
   */
  const baselines = useRef(new Map<string, { title: string; revision: number }>());

  /**
   * One record per SITTING, not per rite. A rename waits in the queue with the sitting that
   * typed it, and while it waits the pastor may have left and come back: one record per rite
   * meant that queued rename woke up holding the NEW sitting's baseline — a number the server
   * had just confirmed — so a title another device had changed in between was overwritten
   * without anything being refused.
   */
  const baselineKey = (id: string, session: string) => `${id}\u0000${session}`;

  /**
   * The editing session is over — the baseline goes with it, BEHIND WHATEVER IS STILL IN THE
   * QUEUE. Kept, it would outlive its own truth: another device renames the rite in the evening,
   * the pastor opens it again in the morning and his first ordinary save is refused as a
   * conflict with a title nobody has seen for hours. Dropped any earlier than the tail of the
   * queue, it would take the baseline out from under a save still waiting to run.
   *
   * Stable on purpose: the editor releases it from an effect cleanup, and a new function every
   * render would make that cleanup fire in the middle of the session it is meant to end.
   */
  const closedEditing = useCallback(
    (id: string, session: string) =>
      // Behind the tail of the queue, so a rename still waiting keeps the baseline it was
      // written against, and only this sitting's record is retired.
      queued(id, async () => {
        baselines.current.delete(baselineKey(id, session));
      }),
    [queued]
  );

  const stepsMutation = useMutation({
    mutationFn: async ({
      id,
      mutate,
    }: {
      id: string;
      mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null;
    }) =>
      writing(async () => {
        const committed = await updateServiceOrderSteps(id, mutate);
        /*
         * The cache takes what the TRANSACTION stored, not a second run of the mutator against
         * whatever this browser happened to be holding. Those two differ exactly when another
         * device has touched the document — the moment the screen must not invent its own answer.
         *
         * Patched HERE, inside the write, rather than in the mutation's success callback. The
         * page hands the screen back to the document the instant this promise answers — it
         * drops its local copy and renders the cache — so the cache must already hold the
         * committed words by then. Leaving that to a callback makes it true only as long as the
         * library keeps running callbacks before it resolves, which is an assumption about
         * someone else's internals rather than something this code decides.
         */
        write((current) =>
          current.map((order) =>
            order.id === id && committed ? { ...order, steps: committed } : order
          )
        );
        return { id, committed };
      }),
  });

  const renameMutation = useMutation({
    mutationFn: async ({
      id,
      title,
      opening,
    }: {
      id: string;
      title: string;
      /** Title and revision as the editor OPENED them — the guard's baseline, never a fresh read. */
      opening?: { title: string; revision: number };
    }) =>
      writing(async () => {
        const committedRevision = await updateServiceOrderMeta(
          id,
          { title },
          opening ? opening.revision : null,
          opening ? { title: opening.title } : null,
          effectiveUserId ?? undefined
        );
        // Published before this answers, for the same reason as the steps above.
        write((current) =>
          current.map((order) =>
            order.id === id
              ? {
                  ...order,
                  title,
                  rev:
                    committedRevision === null
                      ? order.rev
                      : { ...(order.rev ?? {}), meta: committedRevision },
                }
              : order
          )
        );
        return { id, title, committedRevision };
      }),
  });

  /**
   * Moving one rite writes one document, and the LIST MOVES FIRST.
   *
   * It used to wait for the server: the card was released, dnd-kit dropped its transform, and
   * the row fell back into the place it came from — then jumped to the new one when the write
   * answered. The hand said "here" and the screen said "no" for half a second. So the list is
   * rearranged the moment it is dropped and the write follows; if the write is refused, the
   * list goes back to exactly what it was and the page says so.
   *
   * When the gap between the new neighbours has been halved away there is nothing valid to
   * write, so the whole list is spread out again — many documents, and therefore online only:
   * half of those arriving is worse than none.
   */
  const moveMutation = useMutation({
    mutationFn: async ({ writes }: { writes: { id: string; rank: number }[] }) => {
      // One document — one write. Several — one batch: a spread that lands in halves leaves the
      // pastor's arrangement partly rewritten with nothing able to put it back.
      if (writes.length === 1) {
        await setServiceOrderRank(writes[0].id, writes[0].rank);
        return;
      }
      await setServiceOrderRanks(writes);
    },
  });

  /**
   * ONE MOVE AT A TIME, DECIDED SYNCHRONOUSLY.
   *
   * The arrows are disabled while a move is in flight, but that flag only turns on once React has
   * rendered the pending mutation — and two clicks inside one tick both got through, each
   * computing its new rank from the SAME old list. The second one was then written over the
   * first, and the arrangement the pastor made with two presses ended up as one. A ref decides it
   * before the first await, where there is nothing to race with.
   */
  const movePending = useRef(false);

  const moveOrder = async (id: string, toIndex: number) => {
    if (movePending.current) return;
    movePending.current = true;
    try {
      return await placeOrder(id, toIndex);
    } finally {
      movePending.current = false;
    }
  };

  const placeOrder = async (id: string, toIndex: number) => {
    const previous = list;
    const rank = rankForMove(list, id, toIndex);

    let next: ServiceOrder[];
    let writes: { id: string; rank: number }[];

    if (rank !== null && !needsRenumber(list)) {
      next = list.map((order) => (order.id === id ? { ...order, rank } : order));
      writes = [{ id, rank }];
    } else {
      /*
       * Needs a line, and asks for one BEFORE trying rather than after.
       *
       * Honest about the limit: `isOnline` can be a moment out of date, and a batch that slips
       * through on a dying connection is not refused by Firestore — it is stored locally and its
       * promise simply waits for the server. The screen keeps the new order meanwhile, which is
       * the right outcome for placement, and the batch still lands whole when the signal
       * returns. The check exists to keep the common offline case out, not to make it
       * impossible.
       */
      if (!isOnline) throw new Error('OFFLINE_RENUMBER');
      const spread = renumber(list);
      const byId = new Map(spread.map((entry) => [entry.id, entry.rank]));
      const evened = list.map((order) => ({ ...order, rank: byId.get(order.id) ?? order.rank }));
      const settled = rankForMove(evened, id, toIndex);
      next = settled === null
        ? evened
        : evened.map((order) => (order.id === id ? { ...order, rank: settled } : order));
      // One entry per document: the spread already names every row, and the moved one is then
      // placed again. Sending it twice works but says the batch was assembled without looking.
      const byDocument = new Map(spread.map((entry) => [entry.id, entry.rank]));
      if (settled !== null) byDocument.set(id, settled);
      writes = [...byDocument].map(([documentId, rank]) => ({ id: documentId, rank }));
    }

    /*
     * THE ONE WRITER THAT HOLDS THE BOUNDARY ITSELF, because the optimistic rearrangement has
     * to sit BETWEEN the halves: cancelled on the way in, the list moved, then marked stale on
     * the way out. Without the first half the list snapped back — a refetch issued before the
     * move resolved with the OLD order a moment after the card was dropped, and it returned to
     * where it came from with nothing to explain it. Without the second, another device's move
     * of a different rite stayed invisible for as long as the tab was open.
     */
    beginWrite();
    await beforeWriting();
    // ONLY the documents this move writes. Built from `previous`/`next` wholesale, a late
    // rollback also reverted a rank another move had changed meanwhile — on screen only, so
    // the list and the server quietly disagreed.
    const touched = new Set(writes.map((entry) => entry.id));
    const ranksBefore = new Map(
      previous.filter((order) => touched.has(order.id)).map((order) => [order.id, order.rank])
    );
    const ranksAfter = new Map(
      next.filter((order) => touched.has(order.id)).map((order) => [order.id, order.rank])
    );
    write((current) =>
      current.map((order) => ({ ...order, rank: ranksAfter.get(order.id) ?? order.rank }))
    );
    try {
      await moveMutation.mutateAsync({ writes });
    } catch (error) {
      /*
       * PUTS BACK ONLY WHAT IS STILL WHAT THIS MOVE LEFT.
       *
       * Both paths are all-or-nothing on the server — one write, or one batch — so an exact
       * rollback is possible. But a spread touches every row, and while its batch was in the
       * air a second drag may have finished successfully; restoring every rank unconditionally
       * would wipe that newer arrangement off the screen while the server kept it. So each rank
       * goes back only if it is still the one this move set.
       */
      write((current) =>
        current.map((order) => {
          const restored = ranksBefore.get(order.id);
          const placed = ranksAfter.get(order.id);
          if (restored === undefined || placed === undefined) return order;
          return order.rank === placed ? { ...order, rank: restored } : order;
        })
      );
      throw error;
    } finally {
      endWrite();
      await afterWriting();
    }
  };

  return {
    orders: list,
    loading,
    error,
    isOnline,
    recheck,
    /** Ask the list again, by hand — the way out of a read that failed or is taking too long. */
    refresh,
    /** True while the standard set is worth offering: something of it is still missing. */
    canSeed: missingCatalogKeys.length > 0,
    seeding: seedMutation.isPending,
    seedStandardSet: () => seedMutation.mutateAsync(),
    createCustomOrder: (title: string) => createCustomMutation.mutateAsync(title),
    /*
     * Through the SAME per-document queue as the step writes, so the words flushed a moment
     * before the deletion actually reach Firestore first. Without it the deletion could overtake
     * them, and a refused deletion would hand back a document missing the sentence just typed.
     */
    deleteOrder: (id: string) => queued(id, () => deleteMutation.mutateAsync(id)),
    /** Resolves with the steps as committed, so the caller can trust what it then shows. */
    updateSteps: (id: string, mutate: (steps: ServiceOrderStep[]) => ServiceOrderStep[] | null) =>
      queued(id, async () => (await stepsMutation.mutateAsync({ id, mutate })).committed),
    /**
     * What the editor OPENED the title as. Taken once per document — the second call while a
     * baseline is already held is the pastor returning to the field he is in the middle of
     * changing, and his own unsaved word is not a baseline anyone can be judged against.
     */
    openedWith: (id: string, opening: { title: string; revision: number }, session: string) => {
      // The first focus of a sitting wins: returning to a field he is in the middle of changing
      // must not make his own unsaved word the thing he is judged against.
      const key = baselineKey(id, session);
      if (!baselines.current.has(key)) baselines.current.set(key, opening);
    },
    closedEditing,
    renameOrder: (id: string, title: string, session: string) =>
      queued(id, async () => {
        const key = baselineKey(id, session);
        /*
         * "THE NAME DID NOT CHANGE" IS DECIDED HERE, not before the queue.
         *
         * The page used to decide it against the cached title, which is the version from
         * before whatever save is still in flight. Rename A to B and change your mind back to
         * A while B is still travelling: the second save looked like a no-op, was dropped, and
         * B landed — the rite ended up called what the pastor had already rejected. The
         * baseline moves with each commit, so by the time this runs it is the current name.
         */
        const held = baselines.current.get(key);
        if (title === held?.title) return;
        try {
          const { committedRevision } = await renameMutation.mutateAsync({
            id,
            title,
            opening: held,
          });
          // The baseline moves with the commit, inside the sitting that opened it.
          if (committedRevision !== null && held) {
            baselines.current.set(key, { title, revision: committedRevision });
          }
        } catch (error) {
          /*
           * A REFUSAL CARRIES THE WAY OUT, so take it. The transaction that refused this write
           * is the only thing here that saw the server, and it reports what is actually stored.
           * Adopting that is what makes a second, deliberate save mean "mine wins"; merely
           * forgetting the old number rebuilt it from the same unrefreshed cache and conflicted
           * again, so "save again" was a promise the page could not keep.
           */
          if (isStaleWriteError(error)) {
            const serverTitle = error.serverValues?.title;
            if (typeof serverTitle === 'string') {
              baselines.current.set(key, {
                title: serverTitle,
                revision: error.actualRevision,
              });
              /*
               * AND THE SCREEN LEARNS IT TOO.
               *
               * The refusal is the only thing here that has seen the server. Keeping what it
               * reports as a private baseline left the cache holding a name that exists nowhere:
               * the heading went back to it the moment editing stopped, so the pastor was shown
               * neither his own attempt nor what the rite is actually called.
               */
              write((current) =>
                current.map((entry) =>
                  entry.id === id
                    ? {
                        ...entry,
                        title: serverTitle,
                        rev: { ...(entry.rev ?? {}), meta: error.actualRevision },
                      }
                    : entry
                )
              );
            } else {
              /*
               * The refusal could not report a title — a document whose `title` is missing or is
               * not a string at all. Dropping the baseline here made the next attempt UNGUARDED,
               * which is the one outcome worth avoiding: a second press would then overwrite a
               * rename made on another device. The number the server reports is still true, so
               * the baseline keeps its title and moves to that revision.
               */
              if (held) {
                baselines.current.set(key, { title: held.title, revision: error.actualRevision });
              }
            }
          }
          throw error;
        }
      }),
    savingSteps: stepsMutation.isPending,
    moveOrder,
    moving: moveMutation.isPending,
  };
}
