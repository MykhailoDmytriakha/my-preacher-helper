'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useServerFirstQuery } from '@/hooks/useServerFirstQuery';
import { useAuth } from '@/providers/AuthProvider';
import { getAllCouncilsViaClient } from '@/services/councils.client';
import { clearLocalCouncils, readLocalCouncils } from '@/services/councils.local';
import { createCouncil as createOnRoad, deleteCouncil as deleteOnRoad, saveCouncil, type CouncilSaveResult } from '@/services/councils.service';
import { councilQueue, existingCouncilQueue } from '@/services/councilWriteQueue.client';
import { newClientId } from '@/utils/clientId';
import { copyTopicForNext, mergeUnsentCouncils, nextPreparingCouncil } from '@/utils/council';
import { DebouncedDocWriter } from '@/utils/debouncedDocWriter';
import { councilListKey } from '@/utils/queryKeys';

import type { Council, CouncilTopic } from '@/models/models';
import '@locales/i18n';

type CouncilUpdater = (council: Council) => Council;

/**
 * Accounts whose browser copy has already been carried over in this page's life. Module-level,
 * not per hook: the hub, the list and the breadcrumbs each hold an instance of this hook, and a
 * flag inside one of them let the other two start the same carry-over a second time.
 */
const migrationStarted = new Set<string>();

/** Sections whose carry-over is being written right now, so a second press cannot double it. */
const carriesInFlight = new Set<string>();

/**
 * THE ONE READER AND THE ONE WRITER OF COUNCILS.
 *
 * Screens never touch storage or transport: they ask this hook, change a council through it,
 * and see the change at once — the cache is updated first, the database a moment later. Reading
 * takes two roads (`ownerListRead.client.ts`); writing takes the road that answers on the
 * device at hand (`councils.service.ts`); the moment between a keystroke and the write is
 * `DebouncedDocWriter`, one whole document at a time.
 */
export function useCouncils() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const userId = user?.uid ?? undefined;
  const queryClient = useQueryClient();
  const key = useMemo(() => councilListKey(userId), [userId]);

  /**
   * Councils whose latest state the server has not confirmed yet: just created, changed and not
   * written yet, or refused. A read that lands while one of these is in the air must not install
   * its older copy over them — see `mergeUnsentCouncils`.
   */
  /**
   * The queue is shared by every screen holding this hook — see `councilWriteQueue.client.ts`.
   * It is created on first use and keyed by the account, so what one screen has not saved yet is
   * known to the read another screen starts.
   */
  const queue = useMemo(
    () =>
      councilQueue(
        userId ?? 'anonymous',
        () =>
          new DebouncedDocWriter<Council>(
            async (id, council, options) => {
              const mine = existingCouncilQueue(userId ?? 'anonymous');
              // The account this write belongs to is gone: there is nobody left to tell, and the
              // queue now in the map belongs to somebody else.
              if (!mine) return;
              const result = await saveCouncil(council, { ...options, knownToServer: mine.knownToServer.has(id) });
              mine.settle(id, result);
              /*
               * THE WRITER HAS TO HEAR THE REFUSAL. `saveCouncil` answers instead of throwing, so a
               * refused or timed-out write used to look delivered and its copy was dropped. Raising
               * it here keeps the copy pending, to go out on the next change or on the way out.
               */
              if (result.kind === 'refused' || result.kind === 'unknown') {
                throw result.kind === 'refused' ? result.error : new Error('council write outcome unknown');
              }
            },
            700,
            (id, error) => console.error(`council ${id} write failed`, error)
          )
      ),
    [userId]
  );
  const isUnsettled = useCallback((id: string) => queue.unsettled.has(id) || queue.writer.isPending(id), [queue]);

  /** The ids the SERVER itself returned last read — the migration may trust nothing else. */
  const serverIdsRef = useRef<Set<string> | null>(null);

  const query = useServerFirstQuery({
    queryKey: key,
    queryFn: async () => {
      const setOutAt = queue.confirmations;
      const fromServer = await getAllCouncilsViaClient(userId as string);
      serverIdsRef.current = new Set(fromServer.map((council) => council.id));
      fromServer.forEach((council) => queue.knownToServer.add(council.id));
      return mergeUnsentCouncils(fromServer, queryClient.getQueryData<Council[]>(key) ?? [], isUnsettled, {
        confirmedRev: (id) => queue.confirmedRev.get(id),
        confirmedAfterTheReadBegan: (id) => (queue.confirmedAt.get(id) ?? 0) > setOutAt,
      });
    },
    enabled: Boolean(userId),
    mode: 'cache-first',
    // A refused write is a real answer; asking again would only bring the same answer later.
    retry: false,
  });

  const councils = useMemo(() => query.data ?? [], [query.data]);

  const readCache = useCallback(() => queryClient.getQueryData<Council[]>(key) ?? [], [key, queryClient]);
  const writeCache = useCallback(
    (next: Council[] | ((current: Council[]) => Council[])) => {
      queryClient.setQueryData<Council[]>(key, (current = []) => (typeof next === 'function' ? next(current) : next));
    },
    [key, queryClient]
  );

  /**
   * What the server said about a write, folded back into the cache and, when needed, said aloud.
   * Reached through a ref because the queue outlives every screen that talks to it: the writer is
   * built once and must always call the settle of the screen that is currently mounted.
   */
  const settle = useCallback(
    (id: string, result: CouncilSaveResult) => {
      const { writer, unsettled, knownToServer, lastResult } = queue;
      lastResult.set(id, result);
      if (result.kind === 'saved') {
        knownToServer.add(id);
        // Only ever forward. A create's answer can arrive after a later write's and would
        // otherwise walk the council back to revision zero, making our own next save a conflict.
        const rev = result.council.rev ?? 0;
        if (rev >= (queue.confirmedRev.get(id) ?? -1)) {
          queue.confirmedRev.set(id, rev);
          queue.confirmations += 1;
          queue.confirmedAt.set(id, queue.confirmations);
        }
        /*
         * Settled unless something newer is already waiting. `isPending` cannot answer that here —
         * this runs while the write that is landing still counts as in flight — so the question is
         * asked of the waiting copy alone.
         */
        if (!writer.hasWaiting(id)) unsettled.delete(id);
        // Only the revision is taken: the cache may already hold newer keystrokes than this write carried.
        writeCache((current) => current.map((council) => (council.id === id ? { ...council, rev: result.council.rev } : council)));
        /*
         * And the copy still waiting is moved onto that revision. It was typed while this write
         * flew, so it is built on the document we ourselves just superseded; sent as it stands it
         * would be refused as stale against our own change, and the person would watch their last
         * sentence vanish into a conflict that never involved a second device.
         */
        writer.rebase(id, (council) => ({ ...council, rev: result.council.rev }));
        return;
      }
      if (result.kind === 'conflict') {
        knownToServer.add(id);
        unsettled.delete(id);
        // Another device moved first. Its copy becomes ours, and what was waiting is dropped
        // rather than re-sent: re-sending a copy built on a superseded base conflicts for ever.
        writer.forget(id);
        writeCache((current) => current.map((council) => (council.id === id ? result.current : council)));
        toast.warning(t('council.save.conflict'));
        return;
      }
      if (result.kind === 'gone') {
        /*
         * The council is not on the server. Keeping it on screen invites the next keystroke to
         * post it back — the resurrection this whole path exists to prevent — so it leaves the
         * cache with the person told why. It stays known: a second 404 must not read as "new".
         */
        unsettled.delete(id);
        writer.forget(id);
        writeCache((current) => current.filter((council) => council.id !== id));
        toast.warning(t('council.save.gone'));
        return;
      }
      if (result.kind === 'refused') {
        console.error('council write refused', result.error);
        toast.error(t('council.save.refused'));
        return;
      }
      if (result.kind === 'queued') {
        // The device is offline and the SDK's own replica now holds the write and will replay it.
        // Holding the council "unsettled" past that point would let the local copy shadow every
        // later answer from the server, for the rest of the session.
        unsettled.delete(id);
        return;
      }
      if (result.kind === 'unknown') toast.warning(t('council.save.unknown'));
    },
    [queue, t, writeCache]
  );

  queue.settle = settle;
  const writer = queue.writer;

  /**
   * THE LAST SAVE ON THE WAY OUT. A person edits a section, closes the tab: whatever the 700 ms
   * had not sent yet goes now, with `keepalive` so the browser lets it finish after the page is gone.
   */
  useEffect(() => {
    const onHide = () => {
      /*
       * ANNOUNCED FIRST, FLUSHED SECOND. Other handlers run on the same event — the outcome panel
       * hands over the sentence it was holding — and they may run after this one. Telling the
       * writer that the page is going, even with nothing waiting yet, is what makes those late
       * changes leave at once instead of waiting for a timer the page will not live to see.
       * `keepalive` is the rest of it: without it the browser may cancel the request as the page
       * goes, and the last edit dies on the doorstep.
       */
      writer.leaveNow();
      if (writer.isPending()) void writer.flush(undefined, { keepalive: true });
    };
    // Hidden is not always gone: a page put in the browser's back-forward cache comes back alive,
    // and from then on there is time to wait again.
    const onShow = () => writer.resumeAfterReturn();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      void writer.flush();
    };
  }, [writer]);

  /**
   * COUNCILS FROM BEFORE THE DATABASE. The section kept its data in localStorage while its shape
   * was being settled; the first successful read carries any of them the server does not have,
   * then clears the copy. Once per account per browser.
   */
  useEffect(() => {
    if (!userId || !query.isSuccess || migrationStarted.has(userId)) return;
    const local = readLocalCouncils(userId);
    if (local.length === 0) return;
    /*
     * WHAT THE SERVER ANSWERED, not what the cache holds. An optimistic entry whose create was
     * refused still sits in the cache; counting it as "already carried" would clear the browser
     * copy of a council that exists nowhere else.
     */
    const known = serverIdsRef.current;
    /*
     * Until the server itself has answered, nothing may be declared already carried over — and the
     * carry-over must not be marked as started either. A cache restored from disk reports success
     * before any read happens; claiming the work was done then meant it never happened at all.
     */
    if (!known) return;
    migrationStarted.add(userId);
    const missing = local.filter((council) => !known.has(council.id));
    void (async () => {
      let carried = 0;
      for (const council of missing) {
        const result = await createOnRoad({ ...council, userId });
        if (result.kind === 'saved' || result.kind === 'queued') {
          carried += 1;
          const stored = result.kind === 'saved' ? result.council : council;
          writeCache((current) => (current.some((item) => item.id === stored.id) ? current : [...current, stored]));
        } else {
          // Left in localStorage for the next opening; nothing is thrown away on a failed road.
          migrationStarted.delete(userId);
          return;
        }
      }
      clearLocalCouncils(userId);
      if (carried > 0) toast.success(t('council.save.migrated', { count: carried }));
    })();
  }, [query.isSuccess, t, userId, writeCache]);

  const createCouncil = useCallback(
    (input: { title: string; date?: string }): Council | undefined => {
      if (!userId) return undefined;
      const now = new Date().toISOString();
      const council: Council = {
        id: newClientId(),
        userId,
        title: input.title.trim(),
        ...(input.date ? { date: input.date } : {}),
        status: 'preparing',
        topics: [],
        createdAt: now,
        updatedAt: now,
        rev: 0,
      };
      queue.unsettled.add(council.id);
      writeCache((current) => [council, ...current]);
      void createOnRoad(council).then((result) => settle(council.id, result));
      return council;
    },
    [settle, userId, writeCache]
  );

  const updateCouncil = useCallback(
    (id: string, updater: CouncilUpdater) => {
      const now = new Date().toISOString();
      let updated: Council | undefined;
      writeCache((current) =>
        current.map((council) => {
          if (council.id !== id) return council;
          updated = { ...updater(council), updatedAt: now };
          return updated;
        })
      );
      if (updated) {
        queue.unsettled.add(id);
        writer.schedule(id, updated);
      }
    },
    [writeCache, writer]
  );

  const deleteCouncil = useCallback(
    (id: string) => {
      writer.forget(id);
      queue.unsettled.delete(id);
      writeCache((current) => current.filter((council) => council.id !== id));
      void deleteOnRoad(id).then((result) => {
        if (result.kind === 'refused') settle(id, result);
      });
    },
    [settle, writeCache, writer]
  );

  const carryTopicToNext = useCallback(
    (sourceCouncilId: string, topic: CouncilTopic, fallbackTitle: string, targetCouncilId?: string | 'new'): Council | undefined => {
      if (!userId) return undefined;
      // One press, one copy. While the destination is being written the button is still on screen,
      // and a second press would send the same section twice under two different ids.
      if (carriesInFlight.has(topic.id)) return undefined;
      carriesInFlight.add(topic.id);
      const now = new Date().toISOString();
      const current = readCache();
      const copy = copyTopicForNext(topic);
      const existing =
        targetCouncilId === 'new'
          ? undefined
          : targetCouncilId
            ? current.find((council) => council.id === targetCouncilId && council.status === 'preparing')
            : nextPreparingCouncil(current);
      const target: Council = existing
        ? { ...existing, topics: [...existing.topics, copy], updatedAt: now }
        : {
            id: newClientId(),
            userId,
            title: fallbackTitle,
            status: 'preparing',
            topics: [copy],
            createdAt: now,
            updatedAt: now,
            rev: 0,
          };
      const markSource = (council: Council): Council =>
        council.id === sourceCouncilId
          ? {
              ...council,
              updatedAt: now,
              topics: council.topics.map((item) => (item.id === topic.id ? { ...item, carriedToCouncilId: target.id } : item)),
            }
          : council;
      queue.unsettled.add(target.id);
      queue.unsettled.add(sourceCouncilId);
      /*
       * The destination appears at once — the person asked for it and it is theirs to see. The
       * SOURCE is not marked yet: "carried to…" is a claim about the other document, and claiming
       * it before that document exists is how a section ends up in neither council.
       */
      writeCache((list) => (existing ? list.map((council) => (council.id === target.id ? target : council)) : [target, ...list]));

      /*
       * THE SOURCE IS MARKED "CARRIED" ONLY ONCE THE SECTION HAS A PLACE TO LAND. The two sides
       * are two documents and two writes: if the destination is refused and the source is marked
       * anyway, the section is gone from both screens — the old council shows "carried to…" and
       * the new one never got it. So the destination goes first, and the mark is written after it
       * lands; a refusal puts the section back where it was and says so.
       */
      void (async () => {
        let landed: boolean;
        if (existing) {
          writer.schedule(target.id, target);
          await writer.flush(target.id);
          /*
           * The real answer, not a guess from the queue. A conflict or a deleted destination also
           * empties the queue, and reading emptiness as success wrote "carried to…" onto a section
           * that never arrived anywhere.
           */
          const result = queue.lastResult.get(target.id);
          /*
           * And it must be the answer about THIS copy. An older write of the same council may be
           * in the air and come back "saved" without ever carrying the section — the queue's last
           * answer alone would then bless a carry-over that never happened.
           */
          const carriedThere = result?.kind === 'saved' && result.council.topics.some((item) => item.id === copy.id);
          landed = carriedThere || result?.kind === 'queued';
        } else {
          const result = await createOnRoad(target);
          settle(target.id, result);
          landed = result.kind === 'saved' || result.kind === 'queued';
        }
        if (!landed) {
          /*
           * Nothing was carried anywhere, so nothing may be left behind: the copy is taken back out
           * of the destination and out of the queue. Otherwise pressing again — which is exactly
           * what the message invites — would add a SECOND copy of the same section beside the first.
           */
          writer.forget(target.id);
          writeCache((list) =>
            existing
              ? list.map((council) =>
                  council.id === target.id
                    ? { ...council, topics: council.topics.filter((item) => item.id !== copy.id) }
                    : council
                )
              : list.filter((council) => council.id !== target.id)
          );
          queue.unsettled.delete(sourceCouncilId);
          queue.unsettled.delete(target.id);
          carriesInFlight.delete(topic.id);
          toast.error(t('council.topic.carryFailed'));
          return;
        }
        writeCache((list) => list.map(markSource));
        const marked = readCache().find((council) => council.id === sourceCouncilId);
        if (marked) writer.schedule(sourceCouncilId, marked);
        carriesInFlight.delete(topic.id);
      })();
      return target;
    },
    [readCache, settle, t, userId, writeCache, writer]
  );

  return {
    councils,
    loading: Boolean(userId) && query.data === undefined && query.isLoading,
    error: query.error,
    refresh: query.refetch,
    createCouncil,
    updateCouncil,
    deleteCouncil,
    carryTopicToNext,
  };
}

export function useCouncil(id: string) {
  const all = useCouncils();
  return { ...all, council: all.councils.find((council) => council.id === id) };
}
