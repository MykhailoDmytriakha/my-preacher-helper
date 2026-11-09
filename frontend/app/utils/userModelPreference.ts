import { providerIds, type ProviderId } from '@/api/clients/ai/providerId';

import type { AiFunctionId } from '@/api/clients/ai/functionCatalog';

export type ModelPreference = { providerId: ProviderId; modelId: string };
export const MODEL_PREFERENCE_FIELDS = ['preferredText', 'preferredTranscription', 'preferredTts'] as const;
export type ModelPreferenceField = typeof MODEL_PREFERENCE_FIELDS[number];
export const modelPreferenceField: Record<AiFunctionId, ModelPreferenceField> = {
  text: 'preferredText',
  transcription: 'preferredTranscription',
  tts: 'preferredTts',
};

export function isModelPreferenceField(field: string): field is ModelPreferenceField {
  return MODEL_PREFERENCE_FIELDS.some(value => value === field);
}

export function isModelPreference(value: unknown): value is ModelPreference {
  if (!value || typeof value !== 'object' || !('providerId' in value) || !('modelId' in value)) return false;
  const { providerId, modelId } = value;
  return providerIds.some(id => id === providerId) && typeof modelId === 'string' && modelId.length > 0;
}

export function sameModelPreference(left: ModelPreference | null | undefined, right: ModelPreference): boolean {
  return left?.providerId === right.providerId && left.modelId === right.modelId;
}
