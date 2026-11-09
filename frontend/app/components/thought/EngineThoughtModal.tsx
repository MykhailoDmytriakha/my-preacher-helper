'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useDiscardQuestion } from '@/hooks/useConfirm';
import { useScrollLock } from '@/hooks/useScrollLock';
import { useTextDictation } from '@/hooks/useTextDictation';
import { sayFailure } from '@/utils/actionFailureMessage';
import { newClientId } from '@/utils/clientId';
import { deepCleanUndefined } from '@/utils/deepCleanUndefined';
import { addSermonThought, patchSermonThought } from '@/utils/sermonThoughtEdits';
import { customTagNameKey, isStructureTag, normalizeStructureTag } from '@/utils/tagUtils';
import { findThoughtSectionInStructure } from '@/utils/thoughtOrdering';
import { useTranslation } from '@locales/useTranslation';

import FormDialog, { FormActions } from '../ui/FormDialog';
import { RichMarkdownEditor } from '../ui/RichMarkdownEditor';

import { ThoughtOutlineField } from './ThoughtOutlineField';
import { ThoughtTagsField } from './ThoughtTagsField';
import { ThoughtTextHeader } from './ThoughtTextHeader';

import type { DocumentData, Json } from '@/data-engine/types';
import type { Sermon, Thought } from '@/models/models';
import type { ThoughtFieldPatch } from '@/utils/sermonThoughtEdits';
import type { VisualSectionKey } from '@/utils/sermonVisualOrder';

const json = (value: Sermon) => deepCleanUndefined(value) as unknown as DocumentData;
const placement = [['structure'], ['thoughtsBySection']] as const;
interface Props {
  sermonId: string;
  thoughtId?: string;
  boardSection?: VisualSectionKey;
  initialOutlinePointId?: string;
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
export function EngineThoughtModal({ sermonId, thoughtId, boardSection, initialOutlinePointId, allowedTags, onClose }: Props) {
  const { t } = useTranslation();
  const { askBeforeDiscard, discardDialog } = useDiscardQuestion();
  const [newThought] = useState<Thought>(() => ({
    id: newClientId(), text: '', tags: [], date: new Date().toISOString(),
    ...(initialOutlinePointId ? { outlinePointId: initialOutlinePointId } : {}),
  }));
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
  const creationSection = boardSection === 'ambiguous' ? undefined : boardSection;
  // A recovered creation keeps the placement of its own draft.
  const outlineSection = boardSection && !thoughtId && thought
    ? findThoughtSectionInStructure(sermon?.structure ?? sermon?.thoughtsBySection, thought.id) ?? boardSection
    : boardSection;
  const addThought = (current: Sermon, patch: ThoughtFieldPatch) => addSermonThought(current, { ...newThought, ...patch }, creationSection);
  const missingOpening = !thoughtId && form.active && !initial;
  const readOnly = missingOpening || loading || !form.active || form.busy || form.status?.phase === 'deleted' || Boolean(thoughtId && !thought);
  const change = (patch: ThoughtFieldPatch) => {
    if (readOnly) return;
    void form.update(current => {
      const value = current as unknown as Sermon;
      const existing = value.thoughts.find(item => item.id === shown.id);
      if (thoughtId && !existing) throw new Error('The thought was deleted');
      return json(existing ? patchSermonThought(value, existing.id, patch)
        : addThought(value, patch));
    }).catch(() => undefined);
  };
  const dictation = useTextDictation({
    acceptAfterText: true,
    recordingContext: { context: 'thought', contextId: JSON.stringify([sermonId, thoughtId ?? 'new']) },
    onText: async text => {
      if (readOnly) throw new Error('The thought is not available for dictation');
      await form.update(current => {
        const value = current as unknown as Sermon;
        const existing = value.thoughts.find(item => item.id === shown.id);
        const patch = { text: `${existing?.text ?? ''}${existing?.text ? '\n\n' : ''}${text}` };
        return json(existing ? patchSermonThought(value, existing.id, patch) : addThought(value, patch));
      });
    },
    onEmpty: () => toast.error(t('errors.audioProcessing')), onError: words => toast.error(sayFailure(words, t)),
  });
  const isBusy = form.busy || dictation.isProcessing || dictation.isRecording;
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !loading && form.recoveryReady, version: form.recoveryVersion,
    list: async () => (await form.listRecoverable()).map(source => ({ id: source.scopeId,
      title: String(source.record.baseline.value?.title ?? sermonId),
      preview: recoveryPreview(source.record.stage[0].value, source.record.openingSelection?.[0]?.value ?? source.record.baseline.value?.thoughts),
      discard: () => form.discardRecovery(source) })),
    recover: form.recover });
  const save = async () => {
    if (isBusy || dictation.error || readOnly || !form.durable || !form.dirty || !form.status?.canSave || !shown.text.trim()) return;
    const original = (form.initialData as unknown as Sermon | null)?.thoughts.find(item => item.id === shown.id);
    const locationChanged = original && ((original.outlinePointId ?? null) !== (shown.outlinePointId ?? null)
      || (original.subPointId ?? null) !== (shown.subPointId ?? null));
    const placement = thoughtId && locationChanged ? form.captureDocumentMetadataAction({ thoughtPlacementId: thoughtId }) : undefined;
    try {
      const trim = (current: DocumentData) => json(patchSermonThought(current as unknown as Sermon, shown.id, { text: shown.text.trim() }));
      if (placement) await form.save(trim, placement);
      else await form.save(trim);
      await dictation.accept().catch(() => undefined);
      onClose();
    }
    catch { /* The shared form retains the draft and exposes the failure. */ }
  };
  const cancel = async () => {
    if (isBusy) return;
    const discard = async () => { await Promise.all([form.cancel(), dictation.discard()]); onClose(); };
    // The form already asks for dirty text; a failed raw take can exist without any typed edit.
    await askBeforeDiscard(Boolean(dictation.error) && !form.dirty, discard);
  };
  const resolve = async (choice: 'local' | 'remote') => {
    if (isBusy) return;
    if (choice === 'local') await form.keepLocal(); else await form.acceptRemote();
    if (!thoughtId) onClose();
  };
  const visibleTags = shown.tags.flatMap((name, index) => {
    if (boardSection === undefined) return [{ name, index }];
    if (isStructureTag(name)) return [];
    const canonical = allowedTags.find(tag => customTagNameKey(tag.name) === customTagNameKey(name));
    return [{ name: canonical?.name ?? name, index }];
  });
  const tags = visibleTags.map(tag => tag.name);
  const availableTags = allowedTags.filter(allowed => !tags.some(tag => tag === allowed.name
    || (normalizeStructureTag(tag) !== null && normalizeStructureTag(tag) === normalizeStructureTag(allowed.name))));
  const discardAndClose = async () => {
    if (isBusy) return;
    await Promise.all([form.cancel(), dictation.discard()]);
    onClose();
  };
  return <><FormDialog size="standard" title={t(thoughtId ? 'editThought.editTitle' : 'createThought.title')}
    eyebrow={t('thought.editorLabel')} onClose={() => { void discardAndClose().catch(() => undefined); }}
    unsaved={form.dirty || Boolean(dictation.error)} closeDisabled={isBusy} dismissOnBackdrop showCloseButton
    onSubmit={event => { event.preventDefault(); void save(); }}
    footer={<FormActions onCancel={() => { void cancel().catch(() => undefined); }} cancelLabel={t('buttons.cancel')}
        submitLabel={t('buttons.save')} savingLabel={t('buttons.saving')} saving={form.busy} cancelDisabled={isBusy} unsaved={form.dirty}
        submitDisabled={isBusy || Boolean(dictation.error) || readOnly || !form.durable || !form.dirty || !form.status?.canSave || !shown.text.trim()} />}>
    <div className="space-y-5">
      <DataSyncStatus subject={form.recoveryIdentity} status={form.status} error={form.error ?? (missingOpening ? t('dataSync.missingOpeningVersion') : null)} errorWords={form.error ? form.errorWords : undefined} onRetry={form.retry}
        onKeepLocal={() => resolve('local')} onAcceptRemote={() => resolve('remote')}
        recoveryChoices={recovery.choices} recoveryLoading={recovery.loading} recoveryError={recovery.error}
        onRecover={recovery.recover} onDiscardRecovery={recovery.discard} />
      <ThoughtOutlineField sermonOutline={sermon?.outline} section={outlineSection} outlinePointId={shown.outlinePointId} subPointId={shown.subPointId}
        disabled={readOnly} onSelect={(outlinePointId, subPointId) => change({ outlinePointId, subPointId })} />
      <ThoughtTagsField tags={tags} allowedTags={allowedTags} availableTags={availableTags} disabled={readOnly}
        onAddTag={tag => change({ tags: [...shown.tags, tag] })}
        onRemoveTag={index => change({ tags: shown.tags.filter((_, i) => i !== visibleTags[index]?.index) })} />
      <div className="space-y-3">
        <ThoughtTextHeader dictation={dictation} saving={form.busy} readOnly={readOnly} />
        {readOnly ? <pre className="whitespace-pre-wrap font-sans">{shown.text}</pre>
          : <RichMarkdownEditor value={shown.text} onChange={text => change({ text })} placeholder={t('manualThought.placeholder')} />}
      </div>
    </div>
  </FormDialog>{discardDialog}</>;
}
