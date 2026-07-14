import type { ProviderId } from './providerId';

export type Workload = 'structured.default' | 'structured.speechOptimization';

export interface ModelTarget {
  providerId: ProviderId;
  modelId: string;
}

function resolveBaseProvider(): ProviderId {
  return process.env.AI_MODEL_TO_USE === 'GEMINI' ? 'gemini' : 'openai';
}

function resolveDefaultModel(providerId: ProviderId): string {
  return providerId === 'gemini'
    ? process.env.GEMINI_MODEL as string
    : process.env.OPENAI_GPT_MODEL as string;
}

function resolveSpeechOptimizationModel(providerId: ProviderId): string {
  return providerId === 'openai'
    ? process.env.OPENAI_OPTIMIZATION_MODEL || 'gpt-4o-mini'
    : resolveDefaultModel(providerId);
}

export function resolveStructuredTargets({ workload }: { workload: Workload }): ModelTarget[] {
  const providerId = resolveBaseProvider();
  const modelId = workload === 'structured.speechOptimization'
    ? resolveSpeechOptimizationModel(providerId)
    : resolveDefaultModel(providerId);

  return [{ providerId, modelId }];
}
