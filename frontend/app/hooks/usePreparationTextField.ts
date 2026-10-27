import { useEffect } from 'react';

import { manualFormDecision } from '@/components/common/manualTextBinding';
import { useDataDocument, useDataEngine, useDataForm, useRecoveryDiscovery } from '@/data-engine/react.client';
import { useTranslation } from '@locales/useTranslation';

import type { PreparationFieldBinding, PreparationTextBinding } from '@/components/common/manualTextBinding';
import type { DocumentData, Json, ResourceRef } from '@/data-engine/types';
import type { PreparationValue } from '@/utils/preparationFieldValues';

function valueAt(document: DocumentData | null, path: readonly string[]): Json | undefined {
  let value: Json | undefined = document ?? undefined;
  for (const key of path) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
    value = value[key];
  }
  return value;
}
function withValue(document: DocumentData, path: readonly string[], value: Json | undefined): DocumentData {
  const [key, ...rest] = path;
  if (!rest.length) {
    const next = { ...document };
    if (value === undefined) delete next[key]; else next[key] = value;
    return next;
  }
  const previous = document[key];
  const nested = previous !== null && typeof previous === 'object' && !Array.isArray(previous) ? previous : {};
  return { ...document, [key]: withValue(nested, rest, value) };
}

const textValue: PreparationValue<string> = {
  read: value => typeof value === 'string' ? value : '', save: value => value, describe: value => value,
};

export function usePreparationTextField(resource: ResourceRef | null, path: readonly string[], captionKey?: string,
  valid?: (value: string) => boolean): PreparationTextBinding {
  return usePreparationField(resource, path, captionKey, valid ? { ...textValue, valid } : textValue);
}

/** The manual scope owns the raw stage and ancestry; normalization happens only at an explicit choice. */
export function usePreparationField<T>(resource: ResourceRef | null, path: readonly string[], captionKey: string | undefined,
  codec: PreparationValue<T>): PreparationFieldBinding<T> & { edit(updater: (current: T) => T): Promise<void> } {
  const { owner } = useDataEngine();
  const { t } = useTranslation();
  const document = useDataDocument(resource, { autoSave: false });
  const form = useDataForm(resource, `prep-${path.slice(1).join('-')}`, [[...path]]);
  const value = valueAt(form.data, path);
  const stored = valueAt(document.data, path);
  const stalePristine = form.active && !form.dirty && !form.capturing && JSON.stringify(value) !== JSON.stringify(stored);
  const { loading, active, busy, error, readOnly, data, follow } = form;
  useEffect(() => {
    if (loading || busy || error || readOnly || !data) return;
    if (active && stalePristine) void follow().catch(() => undefined);
    // Each failure stays with the form; unchanged input is not repeatedly submitted.
  }, [loading, active, busy, error, readOnly, data, follow, stalePristine]);
  const recovery = useRecoveryDiscovery({ identity: form.recoveryIdentity, enabled: !form.loading && form.active,
    version: String(form.active),
    list: async () => (await form.listRecoverable()).map(({ scopeId, record }) => ({ id: scopeId,
      title: String(record.baseline.value?.title ?? resource?.id ?? ''),
      preview: record.stage[0]?.exists ? codec.describe(codec.read(record.stage[0].value)) : '' })),
    recover: form.recover });
  const comparison = form.comparison ? { identity: form.comparison.identity, mine: codec.describe(codec.read(valueAt(form.comparison.mine, path))),
    stored: codec.describe(codec.read(valueAt(form.comparison.stored.value, path))), title: captionKey ? t(captionKey) : undefined } : undefined;
  const selected = codec.read(value);
  const canSave = !codec.valid || codec.valid(selected);
  const decision = manualFormDecision(form, comparison);
  if (decision) decision.keepLocal = () => form.keepLocal(current => withValue(current, path, codec.save(codec.read(valueAt(current, path)))));
  if (decision?.status && !canSave) decision.status = { ...decision.status, canKeepLocal: false };
  const edit = (updater: (current: T) => T) => form.update(current => {
    const next = updater(codec.read(valueAt(current, path)));
    const opening = valueAt(form.initialData, path);
    const stage = JSON.stringify(next) === JSON.stringify(codec.read(opening)) ? opening : next as Json;
    return withValue(current, path, stage);
  });
  return {
    canSave, canBegin: !loading && !busy && !error && !readOnly && Boolean(data),
    subject: JSON.stringify([owner, resource, path]),
    ready: form.active && !form.loading && !form.readOnly && !stalePristine,
    active: form.active, value: selected, busy: form.busy, dirty: form.dirty,
    error: form.localError ?? null,
    decision,
    comparison,
    begin: form.begin, cancel: form.cancel, retry: form.retry, recovery,
    edit, update: next => edit(() => next),
    save: next => codec.valid && !codec.valid(next) ? Promise.reject(new Error('The field value is not valid for saving')) : form.save(current => withValue(current, path, codec.save(next))),
  };
}
