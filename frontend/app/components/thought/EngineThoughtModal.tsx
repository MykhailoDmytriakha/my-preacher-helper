'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useTextDictation } from '@/hooks/useTextDictation';
import { useConnection } from '@/providers/ConnectionProvider';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { addSermonThought, patchSermonThought } from '@/utils/sermonThoughtEdits';
import { normalizeStructureTag } from '@/utils/tagUtils';

import FormDialog, { FormActions } from '../ui/FormDialog';
import { RichMarkdownEditor } from '../ui/RichMarkdownEditor';

import { ThoughtOutlineField } from './ThoughtOutlineField';
import { ThoughtTagsField } from './ThoughtTagsField';
import { ThoughtTextHeader } from './ThoughtTextHeader';

import type { DocumentData, Json } from '@/data-engine/types';
import type { Sermon, Thought } from '@/models/models';
import type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';

const json = (value: Sermon) => deepCleanUndefined(value) as unknown as DocumentData;
const placement = [['structure'], ['thoughtsBySection']] as const;
interface Props {
  sermonId: string;
  thoughtId?: string;
  allowedTags: { name: string; color: string; translationKey?: string }[];
  onClose: () => void;
}

function recoveryPreview(value: Json | undefined, initialThoughts: Json | undefined): string {
  if (!value || typeof value !== 'object') return '';
  if (!Array.isArray(value)) return typeof value.text === 'string' ? value.text.slice(0, 500) : '';
  const original = Array.isArray(initialThoughts) ? initialThoughts : [];
  return value.flatMap(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.text === 'string'
    && !original.some(before => before && typeof before === 'object' && !Array.isArray(before) && before.id === item.id)
    ? [item.text] : []).join('\n').slice(0, 500);
}

/** Typing changes only a durable manual stage; Save captures its opening ancestor. */
export function EngineThoughtModal({ sermonId, thoughtId, allowedTags, onClose }: Props) {
  const { t } = useTranslation();
  const { isMagicAvailable } = useConnection();
  const [newThought] = useState<Thought>(() => ({ id: newClientId(), text: '', tags: [], date: new Date().toISOString() }));
  // Each creation opening is independent, including while earlier creations are offline.
  // Creation selects the array and explicitly shares recovery across unique creation slots,
  // so discovery can restore the original embedded ID. Existing thought selection differs.
  // Existing thoughts select their stable child identity, never a display index.
  const form = useDataForm({ collection: 'sermons', id: sermonId }, thoughtId ? `thought:${thoughtId}` : `thought-create:${newThought.id}`,
    thoughtId ? [['thoughts', { id: thoughtId }], ...placement] : [['thoughts'], ...placement],
    thoughtId ? 'same-slot' : 'same-selection');
  const { loading, begin } = form;
  useEffect(() => { if (!loading) void begin().catch(() => undefined); }, [loading, begin]);
  useScrollLock(true);
  const sermon = form.data as unknown as Sermon | null;
  const initial = form.openingData as unknown as Sermon | null;
  const thought = thoughtId ? sermon?.thoughts.find(item => item.id === thoughtId)
    : initial ? sermon?.thoughts.find(item => !initial.thoughts.some(original => original.id === item.id)) : undefined;
  const shown = thought ?? newThought;
  const missingOpening = !thoughtId && form.active && !initial;
  const readOnly = missingOpening || loading || !form.active || form.busy || form.status?.phase === 'deleted' || Boolean(thoughtId && !thought);
  const change = (patch: ThoughtFieldPatch) => {
    if (readOnly) return;
    void form.update(current => {
      const value = current as unknown as Sermon;
      const existing = value.thoughts.find(item => item.id === shown.id);
      if (thoughtId && !existing) throw new Error('The thought was deleted');
      return json(existing ? patchSermonThought(value, existing.id, patch)
        : addSermonThought(value, { ...newThought, ...patch }));
    }).catch(() => undefined);
  };
  const dictation = useTextDictation({
    onText: text => {
      if (readOnly) return;
      void form.update(current => {
        const value = current as unknown as Sermon;
        const existing = value.thoughts.find(item => item.id === shown.id);
        const patch = { text: `${existing?.text ?? ''}${existing?.text ? '\n\n' : ''}${text}` };
        return json(existing ? patchSermonThought(value, existing.id, patch) : addSermonThought(value, { ...newThought, ...patch }));
      }).catch(() => undefined);
    },
    onEmpty: () => toast.error(t('errors.audioProcessing')), onError: message => toast.error(message),
  });
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading, version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? sermonId), preview: recoveryPreview(record.stage[0].value, record.openingSelection?.[0]?.value ?? record.baseline.value?.thoughts) })),
    recover: form.recover });
  const save = async () => {
    if (readOnly || !form.durable || !form.dirty || !form.status?.canSave || !shown.text.trim()) return;
    try { await form.save(current => json(patchSermonThought(current as unknown as Sermon, shown.id, { text: shown.text.trim() }))); onClose(); }
    catch { /* The shared form retains the draft and exposes the failure. */ }
  };
  const cancel = async () => { await form.cancel(); onClose(); };
  const resolve = async (choice: 'local' | 'remote') => {
    if (choice === 'local') await form.keepLocal(); else await form.acceptRemote();
    if (!thoughtId) onClose();
  };
  const availableTags = allowedTags.filter(allowed => !shown.tags.some(tag => tag === allowed.name
    || (normalizeStructureTag(tag) !== null && normalizeStructureTag(tag) === normalizeStructureTag(allowed.name))));
  return <FormDialog title={t(thoughtId ? 'editThought.editTitle' : 'createThought.title')}
    eyebrow={t('thought.editorLabel')} onClose={onClose} dismissOnBackdrop>
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-5 pt-5">
      <DataSyncStatus status={form.status} error={form.error ?? (missingOpening ? t('dataSync.missingOpeningVersion') : null)} onRetry={form.retry}
        onKeepLocal={() => resolve('local')} onAcceptRemote={() => resolve('remote')}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onListRecovery={recovery.refresh} onRecover={recovery.recover} />
      <ThoughtOutlineField sermonOutline={sermon?.outline} outlinePointId={shown.outlinePointId} subPointId={shown.subPointId}
        disabled={readOnly} onSelect={(outlinePointId, subPointId) => change({ outlinePointId, subPointId })} />
      <ThoughtTagsField tags={shown.tags} allowedTags={allowedTags} availableTags={availableTags} disabled={readOnly}
        onAddTag={tag => change({ tags: [...shown.tags, tag] })} onRemoveTag={index => change({ tags: shown.tags.filter((_, i) => i !== index) })} />
      <div className="space-y-3">
        <ThoughtTextHeader dictation={dictation} available={isMagicAvailable} saving={form.busy} readOnly={readOnly} />
        {readOnly ? <pre className="whitespace-pre-wrap font-sans">{shown.text}</pre>
          : <RichMarkdownEditor value={shown.text} onChange={text => change({ text })} placeholder={t('manualThought.placeholder')} />}
      </div>
      <FormActions onCancel={() => { void cancel().catch(() => undefined); }} cancelLabel={t('buttons.cancel')}
        submitLabel={t('buttons.save')} savingLabel={t('buttons.saving')} saving={form.busy} cancelDisabled={form.busy}
        submitDisabled={readOnly || !form.durable || !form.dirty || !form.status?.canSave || !shown.text.trim()} />
    </form>
  </FormDialog>;
}
