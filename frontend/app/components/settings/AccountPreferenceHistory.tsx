'use client';

import { DocumentMetadataHistory } from '@/components/ui/DocumentMetadataHistory';
import { accountPreferenceValues, writeAccountPreference } from '@/data-engine/react.client';
import { useSettingsEngine } from '@/hooks/userSettingsEngineContext';
import { isModelPreference, isModelPreferenceField, sameModelPreference, type ModelPreference, type ModelPreferenceField } from '@/utils/userModelPreference';
import { DEFAULT_LANGUAGE } from '@locales/constants';
import { useTranslation } from '@locales/useTranslation';

import { accountPreferenceLabels, accountPreferenceWords } from './accountPreferenceWords';

import type { AccountPreferenceField, PreferenceValue } from '@/data-engine/accountPreference';

type ModelAvailability = (field: ModelPreferenceField, value: ModelPreference | null) => boolean;

export function AccountPreferenceHistory({ modelAvailable }: { modelAvailable?: ModelAvailability }) {
  const source = useSettingsEngine();
  const { t } = useTranslation();
  const generation = source?.document.confirmed?.metadata?.generation;
  if (!source || !generation) return null;
  const { document, owner } = source;
  const disabled = document.readOnly || !document.state || document.state.preparing || document.state.durable === false
    || document.state.checkpoint.conflicts.length > 0;
  const labels = Object.fromEntries(Object.entries(accountPreferenceLabels)
    .filter(([field]) => isModelPreferenceField(field) === Boolean(modelAvailable)));
  const unavailable = (field: AccountPreferenceField, value: PreferenceValue | null) =>
    isModelPreferenceField(field) && (!modelAvailable || (value !== null && !isModelPreference(value)) || !modelAvailable(field, value));
  return <DocumentMetadataHistory<AccountPreferenceField, PreferenceValue | null>
    key={JSON.stringify([owner, generation])} owner={owner} collection="users" id={owner} generation={generation}
    current={accountPreferenceValues(document.data)} disabled={(field, value) => disabled || unavailable(field, value)} labels={labels} prefix="settings.preferenceHistory"
    nullable={Object.keys(accountPreferenceLabels) as AccountPreferenceField[]}
    isCurrentValue={(current, value) => isModelPreference(current) && isModelPreference(value) ? sameModelPreference(current, value) : current === value}
    describeValue={(field, value) => accountPreferenceWords(field, value, t)}
    onRestore={async (field, value) => {
      if (unavailable(field, value)) throw new Error('The model is no longer available');
      await document.commit(current => {
        if (!current) throw new Error('The settings document is unavailable');
        return writeAccountPreference(current, field, field === 'language' && value === null ? DEFAULT_LANGUAGE : value);
      }, { kind: 'account-preference', fields: [field] });
    }} />;
}
