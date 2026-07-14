import type { ProviderId } from './providerId';

export const aiFunctionIds = ['text', 'transcription', 'tts'] as const;
export type AiFunctionId = (typeof aiFunctionIds)[number];

export interface FunctionCatalogEntry {
  fn: AiFunctionId;
  providerId: ProviderId;
  modelId: string;
  providerLabel: 'OpenAI' | 'OpenRouter' | 'Google';
  priceLabel: string;
  quality: 1 | 2 | 3 | 4 | 5;
  cost: 1 | 2 | 3 | 4 | 5;
  isDefault: boolean;
}

/**
 * Curated models shown in Settings and enforced on the server. Keep the scores
 * literal: they are product metadata that the owner can adjust without changing
 * UI logic. Admin price labels come from
 * docs/openrouter-model-research-2026-07-13.md and provider pricing; `est.` marks
 * TTS rates normalized from token/audio billing to an approximate 1M characters.
 */
export const functionCatalog = [
  { fn: 'text', providerId: 'openrouter', modelId: 'qwen/qwen3.7-plus', providerLabel: 'OpenRouter', priceLabel: '$0.32 in / $1.28 out / 1M tok', quality: 5, cost: 3, isDefault: false },
  { fn: 'text', providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro', providerLabel: 'OpenRouter', priceLabel: '$0.435 in / $0.87 out / 1M tok', quality: 4, cost: 3, isDefault: false },
  { fn: 'text', providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview', providerLabel: 'Google', priceLabel: '$0.25 in / $1.50 out / 1M tok', quality: 3, cost: 2, isDefault: true },
  { fn: 'text', providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-flash', providerLabel: 'OpenRouter', priceLabel: '$0.09 in / $0.18 out / 1M tok', quality: 2, cost: 1, isDefault: false },
  { fn: 'transcription', providerId: 'openai', modelId: 'gpt-4o-transcribe', providerLabel: 'OpenAI', priceLabel: '$0.006 / min', quality: 5, cost: 3, isDefault: true },
  { fn: 'transcription', providerId: 'openai', modelId: 'gpt-4o-mini-transcribe', providerLabel: 'OpenAI', priceLabel: '$0.003 / min', quality: 4, cost: 2, isDefault: false },
  { fn: 'tts', providerId: 'gemini', modelId: 'gemini-3.1-flash-tts', providerLabel: 'Google', priceLabel: '~$36 est. / 1M chars', quality: 5, cost: 4, isDefault: true },
  { fn: 'tts', providerId: 'gemini', modelId: 'gemini-2.5-flash-tts', providerLabel: 'Google', priceLabel: '~$18 est. / 1M chars', quality: 4, cost: 3, isDefault: false },
  { fn: 'tts', providerId: 'openai', modelId: 'gpt-4o-mini-tts', providerLabel: 'OpenAI', priceLabel: '~$17 est. / 1M chars', quality: 4, cost: 2, isDefault: false },
] as const satisfies readonly FunctionCatalogEntry[];

export type FunctionModelTarget = Pick<FunctionCatalogEntry, 'providerId' | 'modelId'>;

const compareCatalogEntries = (left: FunctionCatalogEntry, right: FunctionCatalogEntry) =>
  right.quality - left.quality || left.cost - right.cost;

export function getFunctionCatalog(fn: AiFunctionId): FunctionCatalogEntry[] {
  return functionCatalog.filter((entry) => entry.fn === fn).sort(compareCatalogEntries);
}

export function getFunctionDefault(fn: AiFunctionId): FunctionCatalogEntry {
  const defaultEntry = functionCatalog.find((entry) => entry.fn === fn && entry.isDefault);
  if (!defaultEntry) throw new Error(`Missing default model for ${fn}`);
  return defaultEntry;
}

export function isFunctionCatalogTarget(
  fn: AiFunctionId,
  target: FunctionModelTarget
): boolean {
  return functionCatalog.some((entry) =>
    entry.fn === fn
    && entry.providerId === target.providerId
    && entry.modelId === target.modelId);
}
