import { manualFormDecision } from '@/components/common/manualTextBinding';
import { usePublishShellTitle } from '@/components/navigation/shellTitles';
import { useDataDocument, useDataEngine, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';

import { useSermonPreparationFields } from './useSermonPreparationFields';

import type { ManualTextBinding } from '@/components/common/manualTextBinding';
import type { DocumentData, Json } from '@/data-engine/types';
import type { Preparation, Sermon } from '@/models/models';

export type SermonCorePatch = Partial<Pick<Sermon, 'title' | 'verse' | 'date' | 'church' | 'isPreached' | 'sourceNoteIds'>>;
export interface QueuedCoreDelivery { delivery: 'queued' }
const coreFields = new Set(['title', 'verse', 'date', 'church', 'isPreached', 'sourceNoteIds']);
const NOT_EDITABLE = 'The sermon is not available for editing';

/** Apply only supplied fields; undefined explicitly removes an optional field. */
function patchFields(current: DocumentData, patch: Record<string, unknown>, nested = false): DocumentData {
  const next = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else if (nested && value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const previous = next[key];
      next[key] = patchFields(previous !== null && typeof previous === 'object' && !Array.isArray(previous) ? previous : {}, value as Record<string, unknown>, true);
    } else next[key] = value as Json;
  }
  return next;
}

/** Core and preparation operations share the same durable document contract as scratch. */
export function useSermonCoreDataDocument(sermonId: string | null) {
  const { owner } = useDataEngine();
  const document = useDataDocument(sermonId ? { collection: 'sermons', id: sermonId } : null, { slot: 'core' });
  usePublishShellTitle('sermons', sermonId, document.data);
  const titleForm = useDataForm(sermonId ? { collection: 'sermons', id: sermonId } : null, 'title', [['title']]);
  const verseForm = useDataForm(sermonId ? { collection: 'sermons', id: sermonId } : null, 'verse', [['verse']]);
  const prepResource = sermonId ? { collection: 'sermons', id: sermonId } : null;
  const preparationFields = useSermonPreparationFields(prepResource);
  const textBinding = (form: typeof titleForm, field: 'title' | 'verse'): ManualTextBinding => ({
    active: form.active, busy: form.busy, value: typeof form.data?.[field] === 'string' ? form.data[field] : '',
    begin: form.begin, cancel: form.cancel,
    update: value => form.update(current => ({ ...current, [field]: value })),
    save: value => form.save(current => ({ ...current, [field]: value })),
  });
  // A copy shown while device storage is silent is for reading: the page disables every editor,
  // the recorder first — a dictated thought must never meet a refusal after the fact
  // (BUG-20260927-engine-open-hangs-on-silent-device-storage).
  const isReadOnly = document.readOnly || !owner || !document.data || document.data.userId !== owner
    || Boolean(document.confirmed?.metadata?.deleted || (document.confirmed && document.confirmed.value === null && document.presence?.kind !== 'creating')
      || (document.remote && document.remote.value === null) || document.remote?.metadata?.deleted);
  const owned = (update: (current: DocumentData) => DocumentData) => (current: DocumentData | null) => {
    if (!current || current.userId !== owner) throw new Error(NOT_EDITABLE);
    return update(current);
  };
  const commit = async (update: (current: DocumentData) => DocumentData): Promise<QueuedCoreDelivery> => {
    if (isReadOnly) throw new Error(NOT_EDITABLE);
    await document.commit(owned(update));
    return { delivery: 'queued' };
  };
  const patchCore = (patch: SermonCorePatch) => commit(current => {
    if (Object.keys(patch).some(key => !coreFields.has(key))) throw new Error('Unsupported sermon core field');
    return patchFields(current, patch);
  });
  const patchPreparation = (patch: Partial<Preparation>) => commit(current => ({
    ...current,
    preparation: patchFields((current.preparation ?? {}) as DocumentData, patch, true),
  }));
  /**
   * Typing: the change goes into the open document's draft, applied to its newest preparation; the
   * document saves it after a short pause, when the page is hidden and when it is left.
   */
  const editPreparation = (edit: (current: Preparation) => Preparation, delivery: 'draft' | 'commit' = 'draft') => {
    if (isReadOnly) return Promise.reject(new Error(NOT_EDITABLE));
    const update = owned(current => ({
      ...current,
      preparation: edit((current.preparation ?? {}) as Preparation) as DocumentData,
    }));
    return delivery === 'commit' ? document.commit(update) : document.update(update);
  };
  const headerForms = { title: titleForm, verse: verseForm };
  const borrowed = [...(titleForm.borrowedRecoveryIds ?? []), ...(verseForm.borrowedRecoveryIds ?? [])];
  const recoveringHeader = borrowed.length > 0 && document.state?.savedIntentReplaceable === false
    && !titleForm.exactChoice && !verseForm.exactChoice;
  const recoveryReady = titleForm.recoveryReady && verseForm.recoveryReady;
  const recovery = useRecoveryDiscovery({
    identity: document.recoveryIdentity,
    enabled: recoveryReady,
    version: JSON.stringify([borrowed, recoveringHeader, document.status?.phase, document.confirmed?.metadata?.revision]),
    list: async () => {
      const preserved = document.listRecoverable({ manualChoiceCopies: 'only' });
      const forms = recoveringHeader ? Object.values(headerForms).map(async form => {
        if (!form.borrowedRecoveryIds?.length) return [];
        return (await form.listRecoverable()).filter(source => form.borrowedRecoveryIds.includes(source.scopeId)).map(source => ({
          id: source.scopeId,
          title: String(source.record.baseline.value?.title ?? sermonId ?? ''),
          preview: source.record.stage[0]?.exists ? String(source.record.stage[0].value ?? '') : '',
        }));
      }) : [];
      const [copies, ...records] = await Promise.all([preserved, ...forms]);
      return [...records.flat(), ...copies.map(source => {
        const { id, record: { checkpoint } } = source;
        return { id, title: String(checkpoint.draft?.title ?? checkpoint.confirmed.value?.title ?? sermonId ?? ''),
          preview: checkpoint.draft?.verse !== checkpoint.confirmed.value?.verse ? String(checkpoint.draft?.verse ?? '') : '',
          discard: () => document.discardRecovery(source) };
      })];
    },
    recover: id => {
      const form = Object.values(headerForms).find(candidate => candidate.borrowedRecoveryIds?.includes(id));
      return form ? form.recover(id) : document.recover(id);
    },
  });
  const recoveredDecision = (slot: 'title' | 'verse') => {
    const form = headerForms[slot];
    const comparison = form.active || form.exactChoice ? form.comparison : undefined;
    return manualFormDecision(form, comparison ? { identity: comparison.identity,
      mine: String(comparison.mine[slot] ?? ''), stored: String(comparison.stored.value?.[slot] ?? '') } : undefined);
  };
  const fieldDecision = recoveredDecision('title') ?? recoveredDecision('verse') ?? preparationFields.decision;
  return {
    ...document,
    ...(fieldDecision ? { syncSubject: fieldDecision.subject, status: fieldDecision.status, error: fieldDecision.error,
      errorWords: undefined, keepLocal: fieldDecision.keepLocal, acceptRemote: fieldDecision.acceptRemote, retry: fieldDecision.retry } : {}),
    syncComparison: fieldDecision?.comparison,
    headerRecovery: recoveryReady ? { recoveryChoices: recovery.choices, recoveryLoading: recovery.loading,
      recoveryError: recovery.error, onRecover: recovery.recover, onDiscardRecovery: recovery.discard } : undefined,
    titleForm, verseForm,
    ...preparationFields,
    titleBinding: textBinding(titleForm, 'title'), verseBinding: textBinding(verseForm, 'verse'),
    coreValues: {
      title: typeof document.data?.title === 'string' ? document.data.title : '',
      verse: typeof document.data?.verse === 'string' ? document.data.verse : '',
    },
    preparation: (document.data?.preparation ?? {}) as Preparation,
    isReadOnly,
    patchCore,
    patchPreparation,
    editPreparation,
  };
}
