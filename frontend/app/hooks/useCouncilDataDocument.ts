'use client';

import { useCallback, useMemo } from 'react';

import { useDataDocument } from '@/data-engine/react.client';
import { hydrateCouncil } from '@/services/councils.client';

import type { DocumentData } from '@/data-engine/types';
import type { Council, CouncilTopic } from '@/models/models';

const missing = () => new Error('The council is not available for editing');

/**
 * ONE COUNCIL, THROUGH THE SHARED EDITOR.
 *
 * The same four operations the screens already call, with the protocol underneath instead of the
 * domain's own queue: the draft, its baseline and the delivery belong to the engine, and a
 * refused write keeps the typed text rather than replacing it with the server's copy.
 *
 * Carrying a section is one write, not two. The screen marks the section; the engine finds the
 * destination, reads its generation and lands the copy in the same commit — so a source can never
 * claim "carried to…" for a section that arrived nowhere.
 */
export function useCouncilDataDocument(councilId: string) {
  const document = useDataDocument({ collection: 'councils', id: councilId }, { slot: 'council' });
  const data = document.data;
  const council = useMemo<Council | null>(
    () => (data ? hydrateCouncil(data as Record<string, unknown>, councilId) : null),
    [data, councilId]
  );

  const write = useCallback(async (mutate: (current: Council) => Council) => {
    await document.update(current => {
      if (!current) throw missing();
      // The id addresses the document; it never travels inside the stored fields.
      const { id: _id, ...next } = mutate(hydrateCouncil(current as Record<string, unknown>, councilId));
      return { ...next, updatedAt: new Date().toISOString() } as unknown as DocumentData;
    });
  }, [document, councilId]);

  const updateCouncil = useCallback(async (_id: string, updater: (current: Council) => Council) => {
    if (!council) throw missing();
    await write(updater);
  }, [council, write]);

  const carryTopicToNext = useCallback(async (_id: string, topic: CouncilTopic, targetCouncilId: string) => {
    if (!council) throw missing();
    const existing = council.topics.find(item => item.id === topic.id);
    if (!existing) throw new Error('The section is no longer in this council');
    // Carrying twice would claim two destinations for one section; the second claim is refused
    // here rather than sent, so the person is told instead of watching a write fail.
    if (existing.carriedToCouncilId) throw new Error('The section was already carried to another council');
    await write(current => ({
      ...current,
      topics: current.topics.map(item => (item.id === topic.id ? { ...item, carriedToCouncilId: targetCouncilId } : item)),
    }));
  }, [council, write]);

  const deleteCouncil = useCallback(async (_id: string) => {
    // The editor owns deletion: emptying the document would look like an edit and leave no tombstone.
    await document.remove();
  }, [document]);

  return {
    council,
    loading: document.loading,
    error: document.error,
    status: document.status,
    confirmed: document.confirmed,
    remote: document.remote,
    refresh: document.retry,
    acceptRemote: document.acceptRemote,
    keepLocal: document.keepLocal,
    updateCouncil,
    deleteCouncil,
    carryTopicToNext,
  };
}
