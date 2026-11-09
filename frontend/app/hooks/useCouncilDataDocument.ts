'use client';

import { useCallback, useMemo } from 'react';

import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { councilTopicReviewCode, useDataDocument, useDocumentActions, useRecoveryDiscovery } from '@/data-engine/react.client';
import { hydrateCouncil } from '@/services/councils.client';
import { applyOutcome, holdCouncil, reopenCouncil, setTopicKind, type TopicOutcome } from '@/utils/council';
import { hasRecordedCouncilTopicOutcome } from '@/utils/councilTopicOutcome';

import type { CouncilTimedField } from '@/data-engine/councilFieldAction';
import type { CouncilOutcome } from '@/data-engine/councilOutcomeAction';
import type { DocumentData } from '@/data-engine/types';
import type { Council, CouncilTopic } from '@/models/models';

export type CouncilFinishUndo = () => Promise<void>;

const COUNCIL_LIFECYCLE_ACTION = 'council-lifecycle';
const missing = () => new Error('The council is not available for editing');

/**
 * ONE COUNCIL, THROUGH THE SHARED EDITOR.
 *
 * The operations the screens already call, with the protocol underneath instead of the
 * domain's own queue: the draft, its baseline and the delivery belong to the engine, and a
 * refused write keeps the typed text rather than replacing it with the server's copy.
 *
 * Carrying a section is one action over two owned participants. The public document facade
 * captures the source mark and destination copy together, whether the destination already
 * exists or is created by this invocation. Screens never write either participant separately.
 */
export function useCouncilDataDocument(councilId: string) {
  // Both council screens render read-only when handed a copy (BUG-20260927-engine-open-hangs-on-silent-device-storage).
  const document = useDataDocument({ collection: 'councils', id: councilId }, { slot: 'council', readOnlyCopy: true });
  const actions = useDocumentActions();
  // The retained copy is readable while the same-device deletion is waiting or needs a decision.
  const presence = document.presence;
  const deleting = presence?.kind === 'deleting';
  const data = deleting ? document.remote?.value ?? presence.snapshot?.value : document.data;
  const council = useMemo<Council | null>(
    () => (data ? hydrateCouncil(data as Record<string, unknown>, councilId) : null),
    [data, councilId]
  );
  usePublishShellTitle('councils', councilId, council);

  const apply = useCallback((mutate: (current: Council) => Council, at?: string) => (current: DocumentData | null): DocumentData => {
    if (!current) throw missing();
    // The id addresses the document; it never travels inside the stored fields.
    const { id: _id, rev: _rev, ...next } = mutate(hydrateCouncil(current as Record<string, unknown>, councilId));
    /*
     * The revision is the server's: it travels exactly as stored, or not at all. The 0 the reader
     * fills in for a council written before it had one became a change to a field no editor may
     * write, and every edit of such a council was refused on this device
     * (BUG-20261004-council-without-rev-refuses-title). The server gives it a counter on its first write.
     */
    const kept = 'rev' in current ? { rev: current.rev } : {};
    return { ...next, ...kept, updatedAt: at ?? new Date().toISOString() } as unknown as DocumentData;
  }, [councilId]);

  /** Typing: persisted locally at once, delivered by the shared autosave. */
  const updateCouncil = useCallback(async (_id: string, updater: (current: Council) => Council, field?: CouncilTimedField) => {
    if (!council) throw missing();
    const change = apply(updater);
    if (field) await document.update(change, { action: field === 'title' ? 'council-title' : 'council-date' });
    else await document.update(change);
  }, [council, document, apply]);

  const recordTopicOutcome = useCallback(async (topicId: string, outcome: TopicOutcome, trackChanges: boolean, expectedKind?: 'decision' | 'info') => {
    const at = new Date().toISOString();
    await document.update(apply(current => {
      const topic = current.topics.find(item => item.id === topicId);
      if (!topic) throw Object.assign(new Error('The section no longer exists'), { code: 'topic-gone' });
      if ((expectedKind && (topic.kind ?? 'decision') !== expectedKind)
        || (outcome.acceptedOptionId && !topic.options.some(option => option.id === outcome.acceptedOptionId))) throw missing();
      return { ...current, topics: current.topics.map(topic =>
        topic.id === topicId ? applyOutcome(topic, outcome, { at, trackChanges }) : topic) };
    }, at), { action: { kind: 'council-topic-outcome', rowId: topicId } });
  }, [apply, document]);

  const restoreTopicOutcome = useCallback((topic: CouncilTopic, outcome: CouncilOutcome) =>
    recordTopicOutcome(topic.id, { told: outcome.discussed, acceptedOptionId: outcome.acceptedOptionId ?? '',
      decision: outcome.decision ?? '', resolution: outcome.resolution }, council?.status === 'held', topic.kind ?? 'decision'),
  [council?.status, recordTopicOutcome]);

  const renameTopic = useCallback(async (topicId: string, title: string) => {
    if (!council) throw missing();
    await document.update(apply(current => {
      if (!current.topics.some(topic => topic.id === topicId)) throw Object.assign(new Error('The section no longer exists'), { code: 'topic-gone' });
      return { ...current, topics: current.topics.map(topic => topic.id === topicId ? { ...topic, title } : topic) };
    }), { action: { kind: 'council-topic-title', rowId: topicId } });
  }, [council, document, apply]);

  const setAssembly = useCallback(async (topic: CouncilTopic, selected: boolean) => {
    if (!council) throw missing();
    const before = Boolean(topic.forAssembly);
    if (before === selected) return;
    const metadata = document.confirmed?.metadata;
    const updater = apply(current => {
      if (!current.topics.some(item => item.id === topic.id)) throw Object.assign(new Error('The section no longer exists'), { code: 'topic-gone' });
      return { ...current, topics: current.topics.map(item => item.id === topic.id ? { ...item, forAssembly: selected } : item) };
    });
    const flag = metadata && { rowId: topic.id, before, after: selected, generation: metadata.generation,
      observedRevision: metadata.revision, time: actions.captureActionTime() ?? null };
    await document.commit(updater, flag ? { kind: 'council-assembly', flag } : undefined);
  }, [actions, apply, council, document]);

  const changeTopicKind = useCallback(async (shown: CouncilTopic, kind: 'decision' | 'info') => {
    if (!council) throw missing();
    const before = shown.kind ?? 'decision';
    if (before === kind) return;
    const metadata = document.confirmed?.metadata;
    const topicKind = metadata && { rowId: shown.id, before, after: kind, generation: metadata.generation,
      observedRevision: metadata.revision, time: actions.captureActionTime() ?? null };
    // Capture an explicit outcome clear separately. An already open section has no clear to flush.
    const pending = Object.values(document.state?.checkpoint.pending ?? {}).reduce<NonNullable<typeof document.state>['checkpoint']['pending'][string] | undefined>(
      (latest, item) => !latest || item.generation > latest.generation ? item : latest, undefined);
    const saved = pending ? pending.value : document.confirmed?.value;
    const savedTopic = saved && hydrateCouncil(saved, councilId).topics.find(item => item.id === shown.id);
    if (savedTopic && hasRecordedCouncilTopicOutcome(savedTopic)) await document.save();
    await document.commit(apply(current => {
      const topic = current.topics.find(item => item.id === shown.id);
      if (!topic) throw Object.assign(new Error('The section no longer exists'), { code: 'topic-gone' });
      if (hasRecordedCouncilTopicOutcome(topic)) throw Object.assign(new Error('Clear the recorded outcome before changing type'), { code: 'council-topic-outcome-first' });
      return { ...current, topics: current.topics.map(item => item.id === shown.id ? setTopicKind(item, kind) : item) };
    }), topicKind ? { kind: 'council-topic-kind', topicKind } : undefined);
  }, [actions, apply, council, councilId, document]);

  /** Capture before leaving; Undo belongs to the entity, never to the departed screen editor. */
  const finishCouncil = useCallback(async (): Promise<CouncilFinishUndo> => {
    if (!council) throw missing();
    const at = new Date().toISOString();
    // A failed local capture already left this intent in the draft. Retry its capture unchanged.
    if (council.status === 'held') await document.save();
    else await document.commit(apply(current => holdCouncil(current, at), at), COUNCIL_LIFECYCLE_ACTION);
    return async () => {
      const undoneAt = new Date().toISOString();
      await actions.commit({ collection: 'councils', id: councilId }, apply(current => reopenCouncil(current, undoneAt), undoneAt),
        { kind: COUNCIL_LIFECYCLE_ACTION, time: actions.captureActionTime() ?? null });
    };
  }, [council, document, apply, actions, councilId]);

  const restoreCouncilLifecycle = useCallback(async (heldAt: string | null) => {
    const at = new Date().toISOString();
    await document.commit(apply(current => heldAt ? holdCouncil(current, heldAt) : reopenCouncil(current, at), at), COUNCIL_LIFECYCLE_ACTION);
  }, [document, apply]);

  const carryTopicToNext = useCallback(async (_id: string, topic: CouncilTopic, targetCouncilId?: string, fallbackTitle?: string) => {
    if (!council) throw missing();
    const existing = council.topics.find(item => item.id === topic.id);
    if (!existing) throw Object.assign(new Error('The section is no longer in this council'), { code: 'topic-gone' });
    // Carrying twice would claim two destinations for one section; the second claim is refused
    // here rather than sent, so the person is told instead of watching a write fail.
    if (existing.carriedToCouncilId) throw Object.assign(new Error('The section was already carried to another council'), { code: 'topic-already-carried' });
    if (!targetCouncilId) {
      const created = await document.carryCouncilTopicToNew(topic.id, fallbackTitle ?? '');
      return hydrateCouncil(created.value as Record<string, unknown>, created.resource.id);
    }
    await document.carryCouncilTopicToExisting(topic.id, targetCouncilId);
  }, [council, document]);

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
    return records.map(source => {
      const { id, record } = source;
      const draft = record.checkpoint.draft as unknown as Council | null;
      const title = draft?.title ?? (record.checkpoint.confirmed.value as unknown as Council | null)?.title;
      const preview = (draft?.topics ?? []).map(item => item?.title).filter(Boolean).join('\n').slice(0, 500);
      return { id, title: typeof title === 'string' && title.trim() ? title : councilId, ...(preview ? { preview } : {}),
        discard: () => document.discardRecovery(source) };
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

  const result = document.state?.result;
  const conflicts = document.state?.checkpoint.conflicts ?? [];
  const topicReview = result || conflicts.length ? councilTopicReviewCode(result, conflicts) : undefined;
  const topicReviewWords = topicReview === 'council-option-gone' ? 'council.topic.optionGone'
    : topicReview === 'council-topic-outcome-first' ? 'council.topic.clearOutcomeFirst' : 'council.topic.kindChanged';
  return {
    council,
    loading: document.loading,
    /** A copy for reading while device storage is silent; every change is refused with a reason. */
    readOnly: document.readOnly || deleting,
    error: document.error,
    errorWords: topicReview
      ? { key: topicReviewWords }
      : document.errorWords,
    status: document.status,
    /** What the sync block speaks about (DataSyncStatus `subject`). */
    recoveryIdentity: document.recoveryIdentity,
    confirmed: document.confirmed,
    checkpoint: document.state?.checkpoint,
    remote: document.remote,
    refresh: document.retry,
    acceptRemote: document.acceptRemote,
    keepLocal: document.keepLocal,
    updateCouncil,
    recordTopicOutcome,
    restoreTopicOutcome,
    renameTopic,
    setAssembly,
    changeTopicKind,
    finishCouncil,
    restoreCouncilLifecycle,
    deleteCouncil,
    carryTopicToNext,
    actions: document.actions,
    discardAction: document.discardAction,
    listRecoverable,
    recover,
    recovery,
  };
}
