'use client';

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import OutlineBoard from '@/components/plan-editor/OutlineBoard';
import FormDialog, { FormActions } from '@/components/ui/FormDialog';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useScrollLock } from '@/hooks/useScrollLock';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { replaceSermonOutline } from '@/utils/sermonThoughtEdits';

import type { DocumentData } from '@/data-engine/types';
import type { Sermon, SermonOutline } from '@/models/models';

const fields = [['outline'], ['thoughts'], ['structure'], ['thoughtsBySection']] as const;
const empty: SermonOutline = { introduction: [], main: [], conclusion: [] };
const sections = ['introduction', 'main', 'conclusion'] as const;

/** One durable stage owns the outline and every dependent thought assignment. */
export function EngineOutlineModal({ sermonId, onClose }: { sermonId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const form = useDataForm({ collection: 'sermons', id: sermonId }, 'outline', fields);
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  useScrollLock(true);
  const sermon = form.data as unknown as Sermon | null;
  const outline = sermon?.outline ?? empty;
  const readOnly = loading || !form.active || form.busy || !sermon || form.status?.phase === 'deleted';
  const valid = sections.every(section => (outline[section] ?? []).every(point => point.text.trim()
    && (point.subPoints ?? []).every(sub => sub.text.trim())));
  const change = (next: SermonOutline) => {
    if (readOnly) return;
    void form.update(current => deepCleanUndefined(replaceSermonOutline(current as unknown as Sermon, next)) as unknown as DocumentData)
      .catch(() => undefined);
  };
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? sermonId),
      preview: sections.flatMap(section => {
        const recovered = record.stage[0]?.value as unknown as SermonOutline | undefined;
        return (recovered?.[section] ?? []).map(point => point.text);
      }).join('\n').slice(0, 500) })), recover: form.recover });
  const save = async () => {
    if (readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave) return;
    try { await form.save(); onClose(); } catch { /* The shared form retains and reports the failure. */ }
  };
  return <FormDialog title={t('planEditor.title')} size="wide" onClose={onClose} dismissOnBackdrop>
    <div className="space-y-4 pt-4">
      <DataSyncStatus status={form.status} error={form.error} onRetry={form.retry}
        onKeepLocal={valid ? form.keepLocal : undefined} onAcceptRemote={form.acceptRemote}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onListRecovery={recovery.refresh} onRecover={recovery.recover} />
      <OutlineBoard value={outline} onChange={change} directText showNotes isReadOnly={readOnly}
        getPointThoughtCount={id => sermon?.thoughts.filter(thought => thought.outlinePointId === id).length ?? 0}
        getSubPointThoughtCount={id => sermon?.thoughts.filter(thought => thought.subPointId === id).length ?? 0} />
      <form onSubmit={event => { event.preventDefault(); void save(); }}><FormActions onCancel={() => { void form.cancel().then(onClose).catch(() => undefined); }} cancelLabel={t('buttons.cancel')}
        submitLabel={t('buttons.save')} savingLabel={t('buttons.saving')} saving={form.busy} cancelDisabled={form.busy}
        submitDisabled={readOnly || !valid || !form.dirty || !form.durable || !form.status?.canSave} /></form>
    </div>
  </FormDialog>;
}
