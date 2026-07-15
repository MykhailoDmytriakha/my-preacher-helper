jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: { verifyIdToken: jest.fn() },
}));

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: jest.fn(),
  resolveEffectiveTier: jest.fn(),
}));

jest.mock('@/services/usageLimits.server', () => ({
  resolveUsageRemaining: jest.fn(),
}));

jest.mock('@/services/aiModelDefaults.server', () => ({
  getAiModelDefaults: jest.fn(),
}));

jest.mock('@/api/clients/ai/tierPolicy', () => ({
  TIER_LIMITS: {
    free: { aiCallsPerPeriod: 100, transcriptionSecondsPerPeriod: 3600, audioSecondsPerPeriod: 1200 },
    tier2: { aiCallsPerPeriod: 1000, transcriptionSecondsPerPeriod: 36000, audioSecondsPerPeriod: 12000 },
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body, init = {}) => ({
      status: init.status ?? 200,
      headers: new Headers(init.headers),
      json: async () => body,
    })),
  },
}));

import { getFunctionCatalog, getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import { GET } from '@/api/me/entitlement/route';

const { adminAuth } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock };
};
const entitlementService = jest.requireMock('@/services/userEntitlement.server') as {
  getUserEntitlementServerSide: jest.Mock;
  resolveEffectiveTier: jest.Mock;
};
const usageService = jest.requireMock('@/services/usageLimits.server') as {
  resolveUsageRemaining: jest.Mock;
};
const defaultsService = jest.requireMock('@/services/aiModelDefaults.server') as {
  getAiModelDefaults: jest.Mock;
};

const usage = {
  ai: {
    used: 42, baseLimit: 1000, hardCap: 1100, baseRemaining: 958,
    graceRemaining: 100, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z',
  },
  transcription: {
    used: 3600, baseLimit: 36000, hardCap: 39600, baseRemaining: 32400,
    graceRemaining: 3600, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z',
  },
  audio: {
    used: 123.5, baseLimit: 12000, hardCap: 13200, baseRemaining: 11876.5,
    graceRemaining: 1200, state: 'normal', resetsAt: '2026-08-01T00:00:00.000Z',
  },
  aiLimit: 1000, aiUsed: 42, aiRemaining: 958,
  transcriptionSecondsLimit: 36000, transcriptionSecondsUsed: 3600, transcriptionSecondsRemaining: 32400,
  audioSecondsUsed: 123.5,
  aiBlocked: false, transcriptionBlocked: false, periodResets: false,
};

describe('GET /api/me/entitlement', () => {
  const request = (authorization?: string) => new Request('http://localhost/api/me/entitlement', {
    headers: authorization ? { authorization } : undefined,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adminAuth.verifyIdToken.mockResolvedValue({ uid: 'caller-uid' });
    usageService.resolveUsageRemaining.mockReturnValue(usage);
    defaultsService.getAiModelDefaults.mockResolvedValue({
      transcription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    });
  });

  it('returns every paid catalog model and the saved current model per function', async () => {
    entitlementService.getUserEntitlementServerSide.mockResolvedValue({
      paidTier: 'tier2',
      preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
      preferredText: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
      preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    });
    entitlementService.resolveEffectiveTier.mockReturnValue('tier2');

    const response = await GET(request('Bearer valid-token'));

    expect(entitlementService.getUserEntitlementServerSide).toHaveBeenCalledWith('caller-uid', { includeModelPreferences: true });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      effectiveTier: 'tier2',
      functions: {
        transcription: { available: getFunctionCatalog('transcription'), current: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' } },
        text: { available: getFunctionCatalog('text'), current: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' } },
        tts: { available: getFunctionCatalog('tts'), current: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' } },
      },
      usage,
      limits: {
        aiCallsPerPeriod: 1000,
        transcriptionSecondsPerPeriod: 36000,
        audioSecondsPerPeriod: 12000,
      },
      paidTier: 'tier2',
    });
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(Object.keys((await response.json()).functions)).toEqual(['text', 'transcription', 'tts']);
  });

  it('exposes only defaults to free users and never elevates a stored paid preference', async () => {
    defaultsService.getAiModelDefaults.mockResolvedValue({
      transcription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    });
    entitlementService.getUserEntitlementServerSide.mockResolvedValue({
      paidTier: 'free',
      preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      preferredText: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
      preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    });
    entitlementService.resolveEffectiveTier.mockReturnValue('free');

    const body = await (await GET(request('Bearer valid-token'))).json();

    expect(body.functions.text).toEqual({
      available: [getFunctionDefault('text')],
      current: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
    });
    expect(body.functions.transcription.available).toEqual([
      expect.objectContaining({ providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' }),
    ]);
    expect(body.functions.tts.available).toEqual([getFunctionDefault('tts')]);
    expect(body.functions.tts.current).toEqual({ providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' });
  });

  it.each([
    ['without a token', undefined],
    ['with an invalid token', 'Bearer invalid-token'],
  ])('returns 401 %s', async (_label, authorization) => {
    if (authorization) adminAuth.verifyIdToken.mockRejectedValue(new Error('invalid token'));

    const response = await GET(request(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(entitlementService.getUserEntitlementServerSide).not.toHaveBeenCalled();
  });
});
