'use client';

import { useCallback, useMemo } from 'react';

import { useDataDocument, useRecoveryDiscovery } from '@/data-engine/react.client';
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

  const apply = useCallback((mutate: (current: Council) => Council) => (current: DocumentData | null): DocumentData => {
    if (!current) throw missing();
    // The id addresses the document; it never travels inside the stored fields.
    const { id: _id, ...next } = mutate(hydrateCouncil(current as Record<string, unknown>, councilId));
    return { ...next, updatedAt: new Date().toISOString() } as unknown as DocumentData;
  }, [councilId]);

  /** Typing: persisted locally at once, delivered by the shared autosave. */
  const write = useCallback(async (mutate: (current: Council) => Council) => {
    await document.update(apply(mutate));
  }, [document, apply]);

  /**
   * An act, not typing: saved at once as its own durable request. Two carries inside the
   * autosave window would otherwise share one draft, and a save that moves two sections is one
   * the policy refuses — each carry has to reach the engine alone, chained behind the last.
   */
  const act = useCallback(async (mutate: (current: Council) => Council) => {
    await document.commit(apply(mutate));
  }, [document, apply]);

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
    await act(current => ({
      ...current,
      topics: current.topics.map(item => (item.id === topic.id ? { ...item, carriedToCouncilId: targetCouncilId } : item)),
    }));
  }, [council, act]);

  const deleteCouncil = useCallback(async (_id: string) => {
    // The editor owns deletion: emptying the document would look like an edit and leave no tombstone.
    await document.remove();
  }, [document]);

  /**
   * WORK LEFT BEHIND BY AN EARLIER PAGE LOAD.
   *
   * Every load gives the editor a new identity, so an edit the server refused — or one that never
   * left — stays on disk belonging to nobody. The engine offers it rather than applying it
   * silently, which is right: another tab's text must not appear under your cursor. The screen's
   * job is to make that offer visible, with enough of the text to recognise it by.
   */
  const listRecoverable = useCallback(async () => {
    const records = await document.listRecoverable();
    return records.map(({ id, record }) => {
      const draft = record.checkpoint.draft as unknown as Council | null;
      const title = draft?.title ?? (record.checkpoint.confirmed.value as unknown as Council | null)?.title;
      const preview = (draft?.topics ?? []).map(item => item?.title).filter(Boolean).join('\n').slice(0, 500);
      return { id, title: typeof title === 'string' && title.trim() ? title : councilId, ...(preview ? { preview } : {}) };
    });
  }, [document, councilId]);

  const recover = useCallback(async (sourceId: string) => { await document.recover(sourceId); }, [document]);
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: !document.loading && document.status !== null,
    version: JSON.stringify([document.status?.phase, document.confirmed?.metadata?.revision]),
    list: listRecoverable,
    recover,
  });

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
    listRecoverable,
    recover,
    recovery,
  };
}
