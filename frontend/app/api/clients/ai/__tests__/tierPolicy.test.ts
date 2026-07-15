jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: { collection: jest.fn() },
}));

jest.mock('@/services/aiModelDefaults.server', () => ({
  getAiModelDefaults: jest.fn(),
}));

import { getFunctionCatalog, getFunctionDefault } from '../functionCatalog';
import {
  TIER_LIMITS,
  getTierModelPolicy,
  getAllowedFunctionTargets,
  resolveUserTranscriptionTarget,
  resolveUserTextTargets,
  resolveUserTtsTarget,
} from '../tierPolicy';

const { getAiModelDefaults: mockGetAiModelDefaults } = jest.requireMock(
  '@/services/aiModelDefaults.server'
) as { getAiModelDefaults: jest.Mock };

describe('resolveUserTextTargets', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const catalogDefaults = {
    transcription: { providerId: 'openai' as const, modelId: 'gpt-4o-transcribe' },
    text: { providerId: 'gemini' as const, modelId: 'gemini-3.1-flash-lite-preview' },
    tts: { providerId: 'gemini' as const, modelId: 'gemini-3.1-flash-tts' },
  };

  beforeEach(() => {
    mockGetAiModelDefaults.mockResolvedValue(catalogDefaults);
  });

  it('keeps the free text chain a strict singleton — the configured default only, no out-of-allowance tail', async () => {
    const configuredDefault = { providerId: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-flash' };
    mockGetAiModelDefaults.mockResolvedValue({ ...catalogDefaults, text: configuredDefault });

    const policy = await getTierModelPolicy();

    // The free allowlist is exactly the configured default (no escalation).
    expect(policy.free).toEqual({
      default: configuredDefault,
      allowed: [configuredDefault],
    });
    // The resolved chain is strictly the free allowance — one element. No catalog
    // fallback tail that could run a model outside the free tier on the failure path.
    await expect(resolveUserTextTargets({ paidTier: 'free' }, undefined, now))
      .resolves.toEqual([configuredDefault]);
  });

  it('exposes the complete text catalog to every paid tier', async () => {
    const catalogTargets = getFunctionCatalog('text').map(({ providerId, modelId }) => ({ providerId, modelId }));
    const policy = await getTierModelPolicy();
    for (const tier of ['tier1', 'tier2', 'tier3', 'tier4'] as const) {
      expect(policy[tier].allowed).toEqual(catalogTargets);
    }
  });

  it('keeps every tier limit positive and paid tiers above the free defaults', () => {
    expect(TIER_LIMITS.free.aiCallsPerPeriod).toBeGreaterThan(0);
    expect(TIER_LIMITS.free.transcriptionSecondsPerPeriod).toBeGreaterThan(0);
    for (const tier of ['tier1', 'tier2', 'tier3', 'tier4'] as const) {
      expect(TIER_LIMITS[tier].aiCallsPerPeriod).toBeGreaterThan(TIER_LIMITS.free.aiCallsPerPeriod);
      expect(TIER_LIMITS[tier].transcriptionSecondsPerPeriod).toBeGreaterThan(TIER_LIMITS.free.transcriptionSecondsPerPeriod);
    }
  });

  it('defines the audio allowance for every tier', () => {
    expect(Object.fromEntries(
      Object.entries(TIER_LIMITS).map(([tier, limits]) => [tier, limits.audioSecondsPerPeriod])
    )).toEqual({
      free: 1_200,
      tier1: 6_000,
      tier2: 12_000,
      tier3: 30_000,
      tier4: 60_000,
    });
  });

  it('does not escalate a free user who stores a paid-model preference', async () => {
    const defaultTarget = getFunctionDefault('text');
    await expect(resolveUserTextTargets(
      { paidTier: 'free' },
      { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
      now
    )).resolves.toEqual([{ providerId: defaultTarget.providerId, modelId: defaultTarget.modelId }]);
  });

  it('puts an allowed paid preference first and preserves the remaining fallback order', async () => {
    const preferred = { providerId: 'openrouter' as const, modelId: 'deepseek/deepseek-v4-pro' };
    const policy = await getTierModelPolicy();
    await expect(resolveUserTextTargets({ paidTier: 'tier2' }, preferred, now)).resolves.toEqual([
      preferred,
      ...policy.tier2.allowed.filter((target) => target.providerId !== preferred.providerId || target.modelId !== preferred.modelId),
    ]);
  });

  it('uses the configured paid default when a full preference is not allowed', async () => {
    const configuredDefault = { providerId: 'openrouter' as const, modelId: 'qwen/qwen3.7-plus' };
    mockGetAiModelDefaults.mockResolvedValue({ ...catalogDefaults, text: configuredDefault });

    const targets = await resolveUserTextTargets(
      { paidTier: 'tier1' },
      { providerId: 'openai', modelId: 'gpt-5-mini' },
      now
    );

    expect(targets[0]).toEqual(configuredDefault);
  });
});

describe('per-function audio model resolvers', () => {
  const now = new Date('2026-07-12T12:00:00.000Z');
  const defaults = {
    text: { providerId: 'gemini' as const, modelId: 'gemini-3.1-flash-lite-preview' },
    transcription: { providerId: 'openai' as const, modelId: 'gpt-4o-mini-transcribe' },
    tts: { providerId: 'gemini' as const, modelId: 'gemini-3.1-flash-tts' },
  };

  beforeEach(() => {
    mockGetAiModelDefaults.mockResolvedValue(defaults);
  });

  it('locks free transcription to the configured default and ignores an escalation preference', async () => {
    await expect(resolveUserTranscriptionTarget(
      { paidTier: 'free' },
      { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      now
    )).resolves.toEqual(defaults.transcription);
    await expect(getAllowedFunctionTargets('transcription', { paidTier: 'free' }, now))
      .resolves.toEqual([defaults.transcription]);
  });

  it('honors a paid transcription preference only on strict provider and model equality', async () => {
    const allowed = { providerId: 'openai' as const, modelId: 'gpt-4o-transcribe' };
    await expect(resolveUserTranscriptionTarget({ paidTier: 'tier1' }, allowed, now))
      .resolves.toEqual(allowed);
    await expect(resolveUserTranscriptionTarget(
      { paidTier: 'tier1' },
      { providerId: 'gemini', modelId: allowed.modelId },
      now
    )).resolves.toEqual(defaults.transcription);
  });

  it('locks free TTS to the configured default but lets paid users choose any TTS catalog target', async () => {
    const openaiTts = { providerId: 'openai' as const, modelId: 'gpt-4o-mini-tts' };
    await expect(resolveUserTtsTarget({ paidTier: 'free' }, openaiTts, now))
      .resolves.toEqual(defaults.tts);
    await expect(resolveUserTtsTarget({ paidTier: 'tier2' }, openaiTts, now))
      .resolves.toEqual(openaiTts);
    await expect(getAllowedFunctionTargets('tts', { paidTier: 'tier2' }, now))
      .resolves.toEqual(getFunctionCatalog('tts').map(({ providerId, modelId }) => ({ providerId, modelId })));
  });

  it('uses the catalog baseline when admin default reads fail', async () => {
    mockGetAiModelDefaults.mockRejectedValueOnce(new Error('config unavailable'));
    const fallback = getFunctionDefault('tts');
    await expect(resolveUserTtsTarget({ paidTier: 'free' }, undefined, now)).resolves.toEqual({
      providerId: fallback.providerId,
      modelId: fallback.modelId,
    });
  });
});
