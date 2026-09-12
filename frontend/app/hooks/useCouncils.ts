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
import { newClientId } from '@/utils/clientId';
import { copyTopicForNext, nextPreparingCouncil } from '@/utils/council';
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

  const query = useServerFirstQuery({
    queryKey: key,
    queryFn: () => getAllCouncilsViaClient(userId as string),
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

  /** What the server said about a write, folded back into the cache and, when needed, said aloud. */
  const settle = useCallback(
    (id: string, result: CouncilSaveResult) => {
      if (result.kind === 'saved') {
        // Only the revision is taken: the cache may already hold newer keystrokes than this write carried.
        writeCache((current) => current.map((council) => (council.id === id ? { ...council, rev: result.council.rev } : council)));
        return;
      }
      if (result.kind === 'conflict') {
        writeCache((current) => current.map((council) => (council.id === id ? result.current : council)));
        toast.warning(t('council.save.conflict'));
        return;
      }
      if (result.kind === 'refused') {
        console.error('council write refused', result.error);
        toast.error(t('council.save.refused'));
        return;
      }
      if (result.kind === 'unknown') toast.warning(t('council.save.unknown'));
    },
    [t, writeCache]
  );

  const writerRef = useRef<DebouncedDocWriter<Council> | null>(null);
  if (!writerRef.current) {
    writerRef.current = new DebouncedDocWriter<Council>(
      async (id, council) => settle(id, await saveCouncil(council)),
      700,
      (id, error) => console.error(`council ${id} write failed`, error)
    );
  }
  const writer = writerRef.current;

  /**
   * THE LAST SAVE ON THE WAY OUT. A person edits a section, closes the tab: whatever the 700 ms
   * had not sent yet goes now, with `keepalive` so the browser lets it finish after the page is gone.
   */
  useEffect(() => {
    const onHide = () => {
      if (!writer.isPending()) return;
      void writer.flush();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
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
    migrationStarted.add(userId);
    const local = readLocalCouncils(userId);
    if (local.length === 0) return;
    const known = new Set(readCache().map((council) => council.id));
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
  }, [query.isSuccess, readCache, t, userId, writeCache]);

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
      if (updated) writer.schedule(id, updated);
    },
    [writeCache, writer]
  );

  const deleteCouncil = useCallback(
    (id: string) => {
      writer.forget(id);
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
      const source = current.find((council) => council.id === sourceCouncilId);
      writeCache((list) => (existing ? list.map((council) => (council.id === target.id ? target : markSource(council))) : [target, ...list.map(markSource)]));
      if (existing) writer.schedule(target.id, target);
      else void createOnRoad(target).then((result) => settle(target.id, result));
      if (source) writer.schedule(sourceCouncilId, markSource(source));
      return target;
    },
    [readCache, settle, userId, writeCache, writer]
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
