jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: { verifyIdToken: jest.fn() },
  adminDb: { collection: jest.fn() },
}));

jest.mock('@/services/aiModelDefaults.server', () => ({
  getAiModelDefaultsState: jest.fn(),
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

import { GET, POST } from '@/api/admin/ai-defaults/route';
import { adminAuth, adminDb } from '@/config/firebaseAdminConfig';

const { getAiModelDefaultsState: mockGetAiModelDefaultsState } = jest.requireMock(
  '@/services/aiModelDefaults.server'
) as { getAiModelDefaultsState: jest.Mock };

const mockSet = jest.fn();
const mockDoc = jest.fn(() => ({ set: mockSet }));
const mockCollection = adminDb.collection as jest.Mock;
const mockVerifyIdToken = adminAuth.verifyIdToken as jest.Mock;

const effective = {
  transcription: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
  text: { providerId: 'gemini', modelId: 'gemini-3.1-flash-lite-preview' },
  tts: { providerId: 'gemini', modelId: 'gemini-3.1-flash-tts' },
};

const createRequest = (method: 'GET' | 'POST', body?: unknown, token = 'valid-token') =>
  new Request('http://localhost/api/admin/ai-defaults', {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

describe('/api/admin/ai-defaults', () => {
  const originalAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_EMAIL = 'owner@example.com';
    mockVerifyIdToken.mockResolvedValue({
      uid: 'admin-uid',
      email: 'owner@example.com',
      email_verified: true,
    });
    mockCollection.mockReturnValue({ doc: mockDoc });
    mockSet.mockResolvedValue(undefined);
    mockGetAiModelDefaultsState.mockResolvedValue({ stored: {}, effective });
  });

  afterAll(() => {
    if (originalAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = originalAdminEmail;
  });

  it('returns 401 before touching config for an unauthenticated request', async () => {
    const response = await GET(new Request('http://localhost/api/admin/ai-defaults'));

    expect(response.status).toBe(401);
    expect(mockGetAiModelDefaultsState).not.toHaveBeenCalled();
    expect(mockCollection).not.toHaveBeenCalled();
  });

  it('returns 403 before touching config for an unverified admin email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'attacker',
      email: 'owner@example.com',
      email_verified: false,
    });

    const response = await POST(createRequest('POST', { text: effective.text }));

    expect(response.status).toBe(403);
    expect(mockCollection).not.toHaveBeenCalled();
    expect(mockGetAiModelDefaultsState).not.toHaveBeenCalled();
  });

  it('returns stored and effective defaults for an admin GET', async () => {
    const state = { stored: { text: effective.text }, effective };
    mockGetAiModelDefaultsState.mockResolvedValue(state);

    const response = await GET(createRequest('GET'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(state);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('rejects a model that is not a real catalog entry for its function', async () => {
    const response = await POST(createRequest('POST', {
      text: { providerId: 'openai', modelId: 'gpt-4o-transcribe' },
    }));

    expect(response.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('strictly rejects unknown fields', async () => {
    const response = await POST(createRequest('POST', {
      text: effective.text,
      injected: true,
    }));

    expect(response.status).toBe(400);
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('merges valid defaults through Admin SDK and returns the effective readback', async () => {
    const patch = {
      transcription: effective.transcription,
      text: { providerId: 'openrouter', modelId: 'qwen/qwen3.7-plus' },
      tts: effective.tts,
    };
    const readback = { stored: patch, effective: patch };
    mockGetAiModelDefaultsState.mockResolvedValue(readback);

    const response = await POST(createRequest('POST', patch));

    expect(mockCollection).toHaveBeenCalledWith('config');
    expect(mockDoc).toHaveBeenCalledWith('aiModelDefaults');
    expect(mockSet).toHaveBeenCalledWith(patch, { merge: true });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(readback);
  });
});
