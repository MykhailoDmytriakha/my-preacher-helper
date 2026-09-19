'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { applyOutcome, type TopicOutcome } from '@/utils/council';

import { CouncilOutcomePanel } from './CouncilOutcomePanel';

import type { DocumentData } from '@/data-engine/types';
import type { CouncilTopic } from '@/models/models';

const topics = (value: DocumentData | null) => (value?.topics ?? []) as unknown as CouncilTopic[];

/** Manual changes stay in the engine's pinned stage until Save is chosen. */
export function CouncilOutcomeForm({ councilId, topicId, onClose }: {
  councilId: string; topicId: string; onClose: () => void;
}) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'councils', id: councilId }, `outcome:${topicId}`,
    ['decision', 'acceptedOptionId', 'resolution', 'discussed', 'changes'].map(field => ['topics', { id: topicId }, field]));
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  const topic = topics(form.data).find(item => item.id === topicId);
  const initial = topics(form.initialData).find(item => item.id === topicId);
  const recovery = useRecoveryDiscovery({
    identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => {
      const selected = record.stage[0];
      const saved = topics(record.baseline.value).find(item => item.id === topicId);
      return { id: scopeId, title: saved?.title ?? t('council.topic.decision'), preview: selected.exists && typeof selected.value === 'string' ? selected.value : '' };
    }),
    recover: form.recover,
  });
  const write = (patch: TopicOutcome) => {
    if (!initial) return;
    void form.update(current => ({ ...current, topics: topics(current).map(item => {
      if (item.id !== topicId) return item;
      const edited = applyOutcome(item, patch, { at: '', trackChanges: false });
      // One history item for the final staged decision, against the pinned ancestor.
      // Rendering and typing never append a history item for every keystroke.
      return applyOutcome(initial, {
        decision: edited.decision ?? '', acceptedOptionId: edited.acceptedOptionId ?? '',
        resolution: edited.resolution ?? null, told: edited.discussed ?? false,
      }, { at: new Date().toISOString(), trackChanges: true });
    }) } as unknown as DocumentData)).catch(() => undefined);
  };
  const close = (action: () => Promise<void>) => { void action().then(onClose).catch(() => undefined); };
  return <div className="space-y-3">
    <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
      recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
      onListRecovery={recovery.refresh} onRecover={recovery.recover} />
    {topic && form.active && <CouncilOutcomePanel topic={topic} onWrite={write} />}
    <div className="flex gap-2">
      <button type="button" className="rounded-full bg-indigo-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        disabled={loading || !form.active || form.busy || !form.status?.canSave}
        onClick={() => close(form.save)}>{t('council.topic.saveOutcome')}</button>
      <button type="button" className="rounded-full border border-gray-300 px-4 py-2 text-sm disabled:opacity-50"
        disabled={loading || form.busy} onClick={() => form.active ? close(form.cancel) : onClose()}>{t('council.cancel')}</button>
    </div>
  </div>;
}
