jest.mock('server-only', () => ({}), { virtual: true });

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: { verifyIdToken: jest.fn() },
  adminDb: { runTransaction: jest.fn() },
}));

jest.mock('@/services/userEntitlement.server', () => ({
  userEntitlementDocument: jest.fn(),
  normalizeEntitlementWithModelPreferences: jest.fn(),
  resolveEffectiveTier: jest.fn(),
}));

jest.mock('@/services/usageLimits.server', () => ({
  resolveUsageRemaining: jest.fn(),
}));

jest.mock('@/services/aiModelDefaults.server', () => ({
  aiModelDefaultsDocument: jest.fn(),
  normalizeAiModelDefaults: jest.fn(),
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

import { Timestamp } from 'firebase-admin/firestore';

import { getFunctionCatalog, getFunctionDefault } from '@/api/clients/ai/functionCatalog';
import { GET } from '@/api/me/entitlement/route';
import { __resetStoreAvailabilityForTests } from '@/services/storeAvailability.server';

const { adminAuth, adminDb } = jest.requireMock('@/config/firebaseAdminConfig') as {
  adminAuth: { verifyIdToken: jest.Mock };
  adminDb: { runTransaction: jest.Mock };
};
const entitlementService = jest.requireMock('@/services/userEntitlement.server') as {
  userEntitlementDocument: jest.Mock;
  normalizeEntitlementWithModelPreferences: jest.Mock;
  resolveEffectiveTier: jest.Mock;
};
const usageService = jest.requireMock('@/services/usageLimits.server') as {
  resolveUsageRemaining: jest.Mock;
};
const defaultsService = jest.requireMock('@/services/aiModelDefaults.server') as {
  aiModelDefaultsDocument: jest.Mock;
  normalizeAiModelDefaults: jest.Mock;
};

const userReference = { path: 'users/caller-uid' };
const defaultsReference = { path: 'config/aiModelDefaults' };
const userData = { source: 'user' };
const defaultsData = { source: 'defaults' };
const readTime = new Timestamp(1794036480, 500000002);
const getAll = jest.fn();

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
    entitlementService.userEntitlementDocument.mockReturnValue(userReference);
    defaultsService.aiModelDefaultsDocument.mockReturnValue(defaultsReference);
    adminDb.runTransaction.mockImplementation(callback => callback({ getAll }));
    getAll.mockResolvedValue([
      { readTime: new Timestamp(1794036480, 500000001), data: () => userData },
      { readTime, data: () => defaultsData },
    ]);
    adminAuth.verifyIdToken.mockResolvedValue({ uid: 'caller-uid' });
    usageService.resolveUsageRemaining.mockReturnValue(usage);
    defaultsService.normalizeAiModelDefaults.mockReturnValue({ effective: {
      transcription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    } });
  });

  it('returns every paid catalog model and the saved current model per function', async () => {
    entitlementService.normalizeEntitlementWithModelPreferences.mockReturnValue({
      paidTier: 'tier2',
      preferredTranscription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
      preferredText: { providerId: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' },
      preferredTts: { providerId: 'openai', modelId: 'gpt-4o-mini-tts' },
    });
    entitlementService.resolveEffectiveTier.mockReturnValue('tier2');

    const response = await GET(request('Bearer valid-token'));

    expect(entitlementService.userEntitlementDocument).toHaveBeenCalledWith('caller-uid');
    expect(adminDb.runTransaction).toHaveBeenCalledWith(expect.any(Function), { readOnly: true });
    expect(getAll).toHaveBeenCalledWith(userReference, defaultsReference);
    expect(entitlementService.normalizeEntitlementWithModelPreferences).toHaveBeenCalledWith(userData, readTime.toDate());
    expect(defaultsService.normalizeAiModelDefaults).toHaveBeenCalledWith(defaultsData);
    expect(response.headers.get('X-Account-Read-Version')).toBe('1794036480:500000002');
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
    defaultsService.normalizeAiModelDefaults.mockReturnValue({ effective: {
      transcription: { providerId: 'openai', modelId: 'gpt-4o-mini-transcribe' },
      text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
      tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
    } });
    entitlementService.normalizeEntitlementWithModelPreferences.mockReturnValue({
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
    expect(adminDb.runTransaction).not.toHaveBeenCalled();
  });

  // BUG-20261019-quota-outage-burns-vercel-functions: the screen asks for this on every reconnect with a
  // 5 s browser timeout; a store that never answered held the function until Vercel killed it at 10 s.
  it('answers within three seconds of the request even when verifying the caller took most of them', async () => {
    jest.useFakeTimers();
    let answer: { status: number } | undefined;
    try {
      __resetStoreAvailabilityForTests();
      adminAuth.verifyIdToken.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({ uid: 'caller-uid' }), 2_500)));
      getAll.mockImplementation(() => new Promise(() => undefined));
      void GET(request('Bearer token')).then(response => { answer = response as unknown as typeof answer; });
      await jest.advanceTimersByTimeAsync(3_000);
      expect(answer?.status).toBe(503);
    } finally {
      jest.useRealTimers();
      __resetStoreAvailabilityForTests();
    }
  });

  it('answers 503 with Retry-After within a few seconds when the store never answers', async () => {
    jest.useFakeTimers();
    let answer: { status: number; headers: Headers; json: () => Promise<unknown> } | undefined;
    try {
      __resetStoreAvailabilityForTests();
      getAll.mockImplementation(() => new Promise(() => undefined));
      void GET(request('Bearer token')).then(response => { answer = response as unknown as typeof answer; });
      await jest.advanceTimersByTimeAsync(3_000);
      expect(answer?.status).toBe(503);
      expect(answer?.headers.get('Retry-After')).toMatch(/^\d+$/);
    } finally {
      jest.useRealTimers();
      __resetStoreAvailabilityForTests();
    }
    await expect(answer!.json()).resolves.toEqual({ code: 'unavailable' });
  });
});
