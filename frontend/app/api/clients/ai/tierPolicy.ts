import { getAiModelDefaults } from '@/services/aiModelDefaults.server';
import { resolveEffectiveTier } from '@/services/userEntitlement.server';

import { getFunctionCatalog, getFunctionDefault } from './functionCatalog';

import type { AiFunctionId } from './functionCatalog';
import type { ModelTarget } from './routing';
import type { UserEntitlement, Tier } from '@/models/models';

export type FunctionModelPreference = Partial<ModelTarget> | null | undefined;
export type TextModelPreference = FunctionModelPreference;

const toTarget = ({ providerId, modelId }: { providerId: ModelTarget['providerId']; modelId: string }): ModelTarget => ({
  providerId,
  modelId,
});

export type TierModelPolicy = Record<Tier, { default: ModelTarget; allowed: ModelTarget[] }>;

/**
 * Curated per-function model configuration. Every paid tier exposes that
 * function's full catalog; free is restricted to the configured default only.
 */
export const createTierModelPolicy = (
  configuredDefault: ModelTarget,
  fn: AiFunctionId = 'text'
): TierModelPolicy => {
  const paidModels = getFunctionCatalog(fn).map(toTarget);
  return ({
    free: {
      default: configuredDefault,
      allowed: [configuredDefault],
    },
    tier1: {
      default: configuredDefault,
      allowed: paidModels,
    },
    tier2: {
      default: configuredDefault,
      allowed: paidModels,
    },
    tier3: {
      default: configuredDefault,
      allowed: paidModels,
    },
    tier4: {
      default: configuredDefault,
      allowed: paidModels,
    },
  });
};

/** The catalog default is a production-configured provider/model fallback. */
const catalogDefault = (fn: AiFunctionId): ModelTarget => toTarget(getFunctionDefault(fn));

export async function getTierModelPolicyForFunction(fn: AiFunctionId): Promise<TierModelPolicy> {
  try {
    const defaults = await getAiModelDefaults();
    return createTierModelPolicy(defaults[fn], fn);
  } catch (error) {
    // A config-read failure must not break model resolution. This only selects
    // the catalog baseline; it does not authorize a cross-model runtime fallback.
    console.warn(`[aiModelDefaults] config read failed; using catalog ${fn} default`, error);
    return createTierModelPolicy(catalogDefault(fn), fn);
  }
}

/** Backward-compatible TEXT policy accessor. */
export async function getTierModelPolicy(): Promise<TierModelPolicy> {
  return getTierModelPolicyForFunction('text');
}

export interface TierLimits {
  aiCallsPerPeriod: number;
  transcriptionSecondsPerPeriod: number;
  audioSecondsPerPeriod: number;
}

/**
 * Admin-configurable monthly defaults. Keep the free tier positive so existing
 * users, whose normalized usage starts at zero, are never disabled by default.
 */
export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3_600, audioSecondsPerPeriod: 1_200 },
  tier1: { aiCallsPerPeriod: 500, transcriptionSecondsPerPeriod: 18_000, audioSecondsPerPeriod: 6_000 },
  tier2: { aiCallsPerPeriod: 1_000, transcriptionSecondsPerPeriod: 36_000, audioSecondsPerPeriod: 12_000 },
  tier3: { aiCallsPerPeriod: 2_500, transcriptionSecondsPerPeriod: 90_000, audioSecondsPerPeriod: 30_000 },
  tier4: { aiCallsPerPeriod: 5_000, transcriptionSecondsPerPeriod: 180_000, audioSecondsPerPeriod: 60_000 },
};

const isSameTarget = (left: ModelTarget, right: ModelTarget): boolean =>
  left.providerId === right.providerId && left.modelId === right.modelId;

const isFullTarget = (target: FunctionModelPreference): target is ModelTarget =>
  typeof target?.providerId === 'string' && typeof target.modelId === 'string';

async function resolveUserFunctionTarget(
  fn: AiFunctionId,
  entitlement: UserEntitlement | null | undefined,
  preferred: FunctionModelPreference,
  now: Date
): Promise<ModelTarget> {
  const effectiveTier = resolveEffectiveTier(entitlement, now);
  const policy = (await getTierModelPolicyForFunction(fn))[effectiveTier];
  const allowedPreference = isFullTarget(preferred)
    ? policy.allowed.find((target) => isSameTarget(target, preferred))
    : undefined;
  // Escalation guard: a stored preference is only a preference, never a privilege grant.
  return allowedPreference ?? policy.default;
}

export async function getAllowedFunctionTargets(
  fn: AiFunctionId,
  entitlement: UserEntitlement | null | undefined,
  now: Date
): Promise<ModelTarget[]> {
  const effectiveTier = resolveEffectiveTier(entitlement, now);
  return (await getTierModelPolicyForFunction(fn))[effectiveTier].allowed;
}

/** Resolves one tier-gated TRANSCRIPTION target; runtime fallback is handled by its caller. */
export function resolveUserTranscriptionTarget(
  entitlement: UserEntitlement | null | undefined,
  preferred: FunctionModelPreference,
  now: Date
): Promise<ModelTarget> {
  return resolveUserFunctionTarget('transcription', entitlement, preferred, now);
}

/** Resolves one tier-gated TTS target. TTS execution must never add a fallback target. */
export function resolveUserTtsTarget(
  entitlement: UserEntitlement | null | undefined,
  preferred: FunctionModelPreference,
  now: Date
): Promise<ModelTarget> {
  return resolveUserFunctionTarget('tts', entitlement, preferred, now);
}

/** Resolves the ordered TEXT target chain without allowing preference-based tier escalation. */
export async function resolveUserTextTargets(
  entitlement: UserEntitlement | null | undefined,
  preferred: TextModelPreference,
  now: Date
): Promise<[ModelTarget, ...ModelTarget[]]> {
  const effectiveTier = resolveEffectiveTier(entitlement, now);
  const policy = (await getTierModelPolicyForFunction('text'))[effectiveTier];
  const allowedPreference = isFullTarget(preferred)
    ? policy.allowed.find((target) => isSameTarget(target, preferred))
    : undefined;
  // Escalation guard: a stored preference is only a preference, never a privilege grant.
  const primary = allowedPreference ?? policy.default;

  // The chain is strictly the tier's allowed set (primary first). No out-of-allowance
  // fallback tail: a free user's chain stays a singleton — consistent with the
  // transcription resolver — so the failure path can never run a non-allowed model.
  return [
    primary,
    ...policy.allowed.filter((target) => !isSameTarget(target, primary)),
  ];
}
