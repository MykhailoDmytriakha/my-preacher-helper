import { useDataDocument, useDataEngine, useDataForm } from '@/data-engine/react.client';

import type { ManualTextBinding } from '@/components/common/manualTextBinding';
import type { DocumentData, Json } from '@/data-engine/types';
import type { Preparation, Sermon } from '@/models/models';

export type SermonCorePatch = Partial<Pick<Sermon, 'title' | 'verse' | 'date' | 'church' | 'isPreached' | 'sourceNoteIds'>>;
export interface QueuedCoreDelivery { delivery: 'queued' }
const coreFields = new Set(['title', 'verse', 'date', 'church', 'isPreached', 'sourceNoteIds']);

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
  const titleForm = useDataForm(sermonId ? { collection: 'sermons', id: sermonId } : null, 'title', [['title']]);
  const verseForm = useDataForm(sermonId ? { collection: 'sermons', id: sermonId } : null, 'verse', [['verse']]);
  const textBinding = (form: typeof titleForm, field: 'title' | 'verse'): ManualTextBinding => ({
    active: form.active, busy: form.busy, value: typeof form.data?.[field] === 'string' ? form.data[field] : '',
    begin: form.begin, cancel: form.cancel,
    update: value => form.update(current => ({ ...current, [field]: value })),
    save: value => form.save(current => ({ ...current, [field]: value })),
  });
  const isReadOnly = !owner || !document.data || document.data.userId !== owner
    || Boolean(document.confirmed?.metadata?.deleted || (document.confirmed && document.confirmed.value === null)
      || (document.remote && document.remote.value === null) || document.remote?.metadata?.deleted);
  const commit = async (update: (current: DocumentData) => DocumentData): Promise<QueuedCoreDelivery> => {
    if (isReadOnly) throw new Error('The sermon is not available for editing');
    await document.commit(current => {
      if (!current || current.userId !== owner) throw new Error('The sermon is not available for editing');
      return update(current);
    });
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
  return {
    ...document,
    titleForm, verseForm,
    titleBinding: textBinding(titleForm, 'title'), verseBinding: textBinding(verseForm, 'verse'),
    coreValues: {
      title: typeof document.data?.title === 'string' ? document.data.title : '',
      verse: typeof document.data?.verse === 'string' ? document.data.verse : '',
    },
    preparation: (document.data?.preparation ?? {}) as Preparation,
    isReadOnly,
    patchCore,
    patchPreparation,
  };
}
