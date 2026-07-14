import {
  aiFunctionIds,
  getFunctionDefault,
  isFunctionCatalogTarget,
} from '@/api/clients/ai/functionCatalog';
import { providerIds } from '@/api/clients/ai/providerId';
import { adminDb } from '@/config/firebaseAdminConfig';

import type {
  AiFunctionId,
  FunctionModelTarget,
} from '@/api/clients/ai/functionCatalog';
import type { ProviderId } from '@/api/clients/ai/providerId';

export type AiModelDefaults = Record<AiFunctionId, FunctionModelTarget>;
export type StoredAiModelDefaults = Partial<AiModelDefaults>;

export interface AiModelDefaultsState {
  stored: StoredAiModelDefaults;
  effective: AiModelDefaults;
}

const CONFIG_COLLECTION = 'config';
const AI_MODEL_DEFAULTS_DOCUMENT = 'aiModelDefaults';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isProviderId = (value: unknown): value is ProviderId =>
  typeof value === 'string' && providerIds.includes(value as ProviderId);

const readStoredTarget = (
  fn: AiFunctionId,
  value: unknown
): FunctionModelTarget | undefined => {
  if (!isRecord(value) || !isProviderId(value.providerId) || typeof value.modelId !== 'string') {
    return undefined;
  }

  const target = { providerId: value.providerId, modelId: value.modelId };
  return isFunctionCatalogTarget(fn, target) ? target : undefined;
};

export function normalizeAiModelDefaults(data: unknown): AiModelDefaultsState {
  const documentData = isRecord(data) ? data : {};
  const stored: StoredAiModelDefaults = {};

  for (const fn of aiFunctionIds) {
    const target = readStoredTarget(fn, documentData[fn]);
    if (target) stored[fn] = target;
  }

  const effective = Object.fromEntries(aiFunctionIds.map((fn) => {
    const fallback = getFunctionDefault(fn);
    return [fn, stored[fn] ?? { providerId: fallback.providerId, modelId: fallback.modelId }];
  })) as AiModelDefaults;

  return { stored, effective };
}

/** Reads the single server-managed config document and resolves catalog fallbacks per function. */
export async function getAiModelDefaultsState(): Promise<AiModelDefaultsState> {
  const snapshot = await adminDb
    .collection(CONFIG_COLLECTION)
    .doc(AI_MODEL_DEFAULTS_DOCUMENT)
    .get();

  return normalizeAiModelDefaults(snapshot.exists ? snapshot.data() : undefined);
}

export async function getAiModelDefaults(): Promise<AiModelDefaults> {
  return (await getAiModelDefaultsState()).effective;
}
