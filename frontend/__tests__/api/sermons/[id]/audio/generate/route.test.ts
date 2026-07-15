/**
 * @jest-environment node
 */
import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { resolveUserTtsTarget } from '@/api/clients/ai/tierPolicy';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { generateChunkAudio, splitTextEvenly, splitTextIntoChunks } from '@/api/clients/tts.client';
import { adminDb } from '@/config/firebaseAdminConfig';
import { UsageCapReachedError } from '@/services/usageLimits';
import { createUsageAdmission, consumeAiUsage, consumeAudioSeconds } from '@/services/usageLimits.server';
import { getUserEntitlementServerSide } from '@/services/userEntitlement.server';
import { concatenateAudioBlobs, createSilenceBlob } from '@/utils/audioConcat';
import { getMeteredAudioDurationSeconds } from '@/utils/server/audioDurationMetering.server';

globalThis.ReadableStream = globalThis.ReadableStream || ReadableStream;
globalThis.TextEncoder = globalThis.TextEncoder || (TextEncoder as typeof globalThis.TextEncoder);
globalThis.TextDecoder = globalThis.TextDecoder || (TextDecoder as typeof globalThis.TextDecoder);

class MockHeaders {
  private readonly values: Map<string, string>;

  constructor(init?: Record<string, string>) {
    this.values = new Map(
      Object.entries(init || {}).map(([key, value]) => [key.toLowerCase(), value])
    );
  }

  get(name: string): string | null {
    return this.values.get(name.toLowerCase()) ?? null;
  }
}

jest.mock('next/server', () => {
  class NextRequest {
    url: string;
    body: unknown;
    signal: { aborted: boolean };

    constructor(url: string, init: { body?: unknown; signal?: { aborted: boolean } }) {
      this.url = url;
      this.body = init.body;
      this.signal = init.signal || { aborted: false };
    }

    async json() {
      return typeof this.body === 'string' ? JSON.parse(this.body) : this.body;
    }
  }

  class NextResponse {
    body: unknown;
    status: number;
    headers: MockHeaders;

    constructor(body?: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      this.body = body;
      this.status = init?.status || 200;
      this.headers = new MockHeaders(init?.headers);
    }

    static json(body: unknown, init?: { status?: number; headers?: Record<string, string> }) {
      return new NextResponse(body, init);
    }

    async json() {
      return this.body;
    }
  }

  return {
    NextRequest,
    NextResponse,
  };
});

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: jest.fn(),
  },
}));

jest.mock('@/api/clients/tts.client', () => ({
  generateChunkAudio: jest.fn(),
  splitTextEvenly: jest.fn((text: string) => [text]),
  splitTextIntoChunks: jest.fn((text: string) => [text]),
}));

jest.mock('@/api/clients/ai/tierPolicy', () => ({
  resolveUserTtsTarget: jest.fn(),
}));

jest.mock('@/utils/audioConcat', () => ({
  concatenateAudioBlobs: jest.fn(),
  createSilenceBlob: jest.fn(),
}));

jest.mock('@/utils/server/audioDurationMetering.server', () => ({
  getMeteredAudioDurationSeconds: jest.fn(),
}));

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: jest.fn(),
  resolveEffectiveTier: jest.fn((entitlement: { paidTier?: string } | null | undefined) => entitlement?.paidTier ?? 'free'),
}));

jest.mock('@/services/usageLimits.server', () => ({
  createUsageAdmission: jest.fn(),
  consumeAiUsage: jest.fn(),
  consumeAudioSeconds: jest.fn(),
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn(),
}));

const { NextRequest } = require('next/server') as {
  NextRequest: new (
    url: string,
    init: { body?: unknown; signal?: { aborted: boolean } }
  ) => { json: () => Promise<unknown>; signal: { aborted: boolean } };
};
const { POST } = require('@/api/sermons/[id]/audio/generate/route') as {
  POST: typeof import('@/api/sermons/[id]/audio/generate/route').POST;
};

const mockDoc = jest.fn();
const mockGet = jest.fn();
const mockUpdate = jest.fn();

const createRequest = (
  body: Record<string, unknown>,
  signal: { aborted: boolean } = { aborted: false }
) =>
  new NextRequest('http://localhost/api/sermons/sermon-1/audio/generate', {
    body: JSON.stringify(body.userId ? {
      provider: 'openai',
      model: 'gpt-4o-mini-tts',
      ...body,
    } : body),
    signal,
  });

const createFinalAudioBlob = (size: number) =>
  ({
    arrayBuffer: jest.fn().mockResolvedValue(new Uint8Array(size).buffer),
  }) as unknown as Blob;

async function readStreamEvents(stream: ReadableStream<Uint8Array>): Promise<Record<string, unknown>[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();

  return text
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);
}

describe('POST /api/sermons/[id]/audio/generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (splitTextEvenly as jest.Mock).mockImplementation((text: string) => [text]);
    (splitTextIntoChunks as jest.Mock).mockImplementation((text: string) => [text]);
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValue('user-1');

    (getUserEntitlementServerSide as jest.Mock).mockResolvedValue({ paidTier: 'tier2' });
    (resolveUserTtsTarget as jest.Mock).mockResolvedValue({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-tts',
    });
    (consumeAiUsage as jest.Mock).mockResolvedValue(undefined);
    (consumeAudioSeconds as jest.Mock).mockResolvedValue(undefined);
    (createUsageAdmission as jest.Mock).mockReturnValue({
      userId: 'user-1',
      resources: ['ai', 'audio'],
    });
    (getMeteredAudioDurationSeconds as jest.Mock).mockResolvedValue(1);

    (adminDb.collection as jest.Mock).mockReturnValue({
      doc: mockDoc,
    });

    mockDoc.mockReturnValue({
      get: mockGet,
      update: mockUpdate,
    });

    (createSilenceBlob as jest.Mock).mockReturnValue(new Blob([new Uint8Array(8)], { type: 'audio/wav' }));
    (concatenateAudioBlobs as jest.Mock).mockResolvedValue(createFinalAudioBlob(400_000));

    mockGet.mockResolvedValue({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          {
            text: 'Introduction chunk text.',
            sectionId: 'introduction',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 0,
          },
          {
            text: 'Main part chunk text.',
            sectionId: 'mainPart',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 1,
          },
        ],
      }),
    });
  });

  it('returns 401 when the authentication token is missing', async () => {
    (getRequiredAuthenticatedUid as jest.Mock).mockResolvedValueOnce(null);
    const response = await POST(createRequest({ voice: 'onyx' }) as never, {
      params: Promise.resolve({ id: 'sermon-1' }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'User not authenticated' });
  });

  it('returns 404 when the sermon does not exist', async () => {
    mockGet.mockResolvedValueOnce({ exists: false });

    const response = await POST(
      createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never,
      { params: Promise.resolve({ id: 'missing-sermon' }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Sermon not found' });
  });

  it('returns 403 for sermons owned by another user', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        title: 'Grace & Peace',
        userId: 'other-user',
        audioChunks: [],
      }),
    });

    const response = await POST(
      createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'Forbidden: You do not own this sermon',
    });
  });

  it('returns 400 when a free user requests a TTS target other than the resolved default', async () => {
    (getUserEntitlementServerSide as jest.Mock).mockResolvedValueOnce({ paidTier: 'free' });
    (resolveUserTtsTarget as jest.Mock).mockResolvedValueOnce({
      providerId: 'gemini',
      modelId: 'gemini-3.1-flash-tts',
    });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'onyx',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Requested TTS provider/model is not allowed for this plan',
    });
    expect(generateChunkAudio).not.toHaveBeenCalled();
  });

  it('returns 400 for a provider/model mismatch and for a voice outside that provider', async () => {
    const mismatchedTarget = await POST(
      createRequest({
        userId: 'user-1',
        provider: 'google',
        model: 'gpt-4o-mini-tts',
        voice: 'Puck',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );
    expect(mismatchedTarget.status).toBe(400);

    const invalidVoice = await POST(
      createRequest({
        userId: 'user-1',
        provider: 'openai',
        model: 'gpt-4o-mini-tts',
        voice: 'Puck',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );
    expect(invalidVoice.status).toBe(400);
    await expect(invalidVoice.json()).resolves.toEqual({
      error: 'Voice Puck is not available for openai/gpt-4o-mini-tts',
    });
    expect(generateChunkAudio).not.toHaveBeenCalled();
  });

  it('returns 400 when optimized chunks have not been saved yet', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [],
      }),
    });

    const response = await POST(
      createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'No saved chunks. Run optimize step first.',
    });
  });

  it('returns 400 when the requested section has no saved chunks', async () => {
    const response = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'onyx',
        quality: 'standard',
        sections: 'conclusion',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'No chunks found for sections: conclusion',
    });
  });

  it('streams progress, chunk data, and completion for a successful generation', async () => {
    (generateChunkAudio as jest.Mock)
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(250_000)], { type: 'audio/mpeg' }),
        index: 0,
        durationSeconds: 1,
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(250_000)], { type: 'audio/mpeg' }),
        index: 1,
        durationSeconds: 1,
      });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'ash',
        quality: 'hd',
        sections: 'all',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');

    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      1,
      'Introduction chunk text.',
      {
        provider: 'openai',
        voice: 'ash',
        model: 'gpt-4o-mini-tts',
        format: 'mp3',
      }
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      2,
      'Main part chunk text.',
      {
        provider: 'openai',
        voice: 'ash',
        model: 'gpt-4o-mini-tts',
        format: 'mp3',
      }
    );
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'progress',
          current: 1,
          total: 2,
          percent: 40,
          status: 'Generating chunk 1/2...',
        }),
        expect.objectContaining({
          type: 'progress',
          percent: 85,
          status: 'Merging audio files...',
        }),
        expect.objectContaining({
          type: 'progress',
          percent: 90,
          status: 'Preparing download...',
        }),
        expect.objectContaining({
          type: 'download_complete',
          filename: 'grace-peace-audio.mp3',
          audioUrl: '',
        }),
      ])
    );

    const audioChunkEvents = events.filter(event => event.type === 'audio_chunk');
    expect(audioChunkEvents.length).toBeGreaterThan(10);
    expect(events.some(event => String(event.status || '').includes('Downloading audio...'))).toBe(true);

    expect(getUserEntitlementServerSide).toHaveBeenCalledWith('user-1', { includeModelPreferences: true });
    expect(resolveUserTtsTarget).toHaveBeenCalledWith(
      { paidTier: 'tier2' },
      undefined,
      expect.any(Date)
    );
    expect(createUsageAdmission).toHaveBeenCalledWith(
      'user-1',
      { paidTier: 'tier2' },
      ['ai', 'audio'],
      expect.any(Date)
    );
    expect(consumeAiUsage).toHaveBeenCalledWith('user-1', expect.any(Date));
    expect(consumeAiUsage).toHaveBeenCalledTimes(1);
    expect(getMeteredAudioDurationSeconds).toHaveBeenCalledTimes(2);
    expect(consumeAudioSeconds).toHaveBeenCalledWith('user-1', 2, expect.any(Date));

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'audioMetadata.voice': 'ash',
        'audioMetadata.model': 'gpt-4o-mini-tts',
        'audioMetadata.lastGenerated': expect.any(String),
      })
    );
  });

  it('normalizes saved Scripture references before sending text to TTS', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          {
            text: 'Мат 24:42: бодрствуйте.',
            sectionId: 'introduction',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 0,
          },
        ],
      }),
    });
    (generateChunkAudio as jest.Mock).mockResolvedValueOnce({
      audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/mpeg' }),
      index: 0,
      durationSeconds: 1,
    });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'ash',
        quality: 'standard',
        sections: 'introduction',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(generateChunkAudio).toHaveBeenCalledWith(
      'Матфея, двадцать четвертая глава, сорок второй стих: бодрствуйте.',
      {
        provider: 'openai',
        voice: 'ash',
        model: 'gpt-4o-mini-tts',
        format: 'mp3',
      }
    );
  });

  it('groups saved chunks into major sermon sections for Google Gemini TTS', async () => {
    const longMainChunkOne = 'Main chunk one. '.repeat(160);
    const longMainChunkTwo = 'Main chunk two. '.repeat(160);
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          {
            text: 'Intro chunk.',
            sectionId: 'introduction',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 0,
          },
          {
            text: longMainChunkOne,
            sectionId: 'mainPart',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 1,
          },
          {
            text: longMainChunkTwo,
            sectionId: 'mainPart',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 2,
          },
          {
            text: 'Conclusion chunk.',
            sectionId: 'conclusion',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 3,
          },
        ],
      }),
    });
    (generateChunkAudio as jest.Mock)
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 0,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 1,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 2,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        provider: 'google',
        voice: 'Sulafat',
        model: 'gemini-2.5-flash-tts',
        quality: 'standard',
        sections: 'all',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      1,
      'Intro chunk.',
      {
        provider: 'google',
        voice: 'Sulafat',
        model: 'gemini-2.5-flash-preview-tts',
        format: 'wav',
      }
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      2,
      `${longMainChunkOne.trim()}\n\n${longMainChunkTwo.trim()}`,
      {
        provider: 'google',
        voice: 'Sulafat',
        model: 'gemini-2.5-flash-preview-tts',
        format: 'wav',
      }
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      3,
      'Conclusion chunk.',
      {
        provider: 'google',
        voice: 'Sulafat',
        model: 'gemini-2.5-flash-preview-tts',
        format: 'wav',
      }
    );
    expect(createSilenceBlob).toHaveBeenCalledWith(700, 24000, 1);
    const mergedBlobs = (concatenateAudioBlobs as jest.Mock).mock.calls[0][0] as Blob[];
    expect(mergedBlobs).toHaveLength(5);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'download_complete',
          filename: 'grace-peace-audio.wav',
          mimeType: 'audio/wav',
        }),
      ])
    );
    expect(splitTextIntoChunks).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'audioMetadata.provider': 'google',
        'audioMetadata.voice': 'Sulafat',
        'audioMetadata.model': 'gemini-2.5-flash-tts',
      })
    );
  });

  it('splits oversized Google sections into even quality chunks', async () => {
    const oversizedMainText = 'Main oversized section. '.repeat(1300);
    (splitTextEvenly as jest.Mock).mockReturnValueOnce([
      'Main oversized section part one.',
      'Main oversized section part two.',
    ]);
    mockGet.mockResolvedValueOnce({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          {
            text: oversizedMainText,
            sectionId: 'mainPart',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 0,
          },
          {
            text: 'Conclusion chunk.',
            sectionId: 'conclusion',
            createdAt: '2026-02-27T00:00:00.000Z',
            index: 1,
          },
        ],
      }),
    });
    (generateChunkAudio as jest.Mock)
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 0,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 1,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 2,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        provider: 'google',
        voice: 'Sulafat',
        model: 'gemini-2.5-flash-tts',
        quality: 'standard',
        sections: 'all',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(splitTextEvenly).toHaveBeenCalledWith(oversizedMainText.trim());
    expect(splitTextIntoChunks).not.toHaveBeenCalled();
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      1,
      'Main oversized section part one.',
      expect.objectContaining({ provider: 'google', format: 'wav' })
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      2,
      'Main oversized section part two.',
      expect.objectContaining({ provider: 'google', format: 'wav' })
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      3,
      'Conclusion chunk.',
      expect.objectContaining({ provider: 'google', format: 'wav' })
    );
    expect(createSilenceBlob).toHaveBeenCalledTimes(1);
    const mergedBlobs = (concatenateAudioBlobs as jest.Mock).mock.calls[0][0] as Blob[];
    expect(mergedBlobs).toHaveLength(4);
  });

  it('preserves exactly one Google section pause across one-chunk batch seams', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      id: 'sermon-1',
      data: () => ({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          { text: 'Intro first. Intro second.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 },
          { text: 'Main only.', sectionId: 'mainPart', createdAt: '2026-02-27T00:00:00.000Z', index: 1 },
        ],
      }),
    });
    (splitTextEvenly as jest.Mock).mockImplementation((text: string) =>
      text.startsWith('Intro') ? ['Intro first.', 'Intro second.'] : [text]
    );
    (generateChunkAudio as jest.Mock).mockResolvedValue({
      audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
      index: 0,
      durationSeconds: 1,
      mimeType: 'audio/wav',
    });

    const batchEvents = [];
    for (const offset of [0, 1, 2]) {
      const response = await POST(
        createRequest({
          userId: 'user-1',
          provider: 'google',
          voice: 'Puck',
          model: 'gemini-2.5-flash-tts',
          quality: 'standard',
          sections: 'all',
          offset,
          limit: 1,
        }) as never,
        { params: Promise.resolve({ id: 'sermon-1' }) }
      );
      batchEvents.push(await readStreamEvents(response.body as ReadableStream<Uint8Array>));
    }

    expect(createSilenceBlob).toHaveBeenCalledTimes(1);
    expect((concatenateAudioBlobs as jest.Mock).mock.calls.map(([blobs]) => blobs.length)).toEqual([1, 2, 1]);
    expect(batchEvents.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'download_complete', totalChunks: 3 }),
    ]));
    expect(consumeAiUsage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['OpenAI', { provider: 'openai', voice: 'onyx', model: 'gpt-4o-mini-tts' }],
    ['Google', { provider: 'google', voice: 'Puck', model: 'gemini-2.5-flash-tts' }],
  ])('retries one transient %s chunk failure and then succeeds', async (_label, providerBody) => {
    (generateChunkAudio as jest.Mock)
      .mockRejectedValueOnce(new Error('transient provider failure'))
      .mockResolvedValueOnce({
        audioBlob: new Blob([new Uint8Array(10)], { type: providerBody.provider === 'google' ? 'audio/wav' : 'audio/mpeg' }),
        index: 0,
        durationSeconds: 1,
        mimeType: providerBody.provider === 'google' ? 'audio/wav' : 'audio/mpeg',
      });

    const response = await POST(
      createRequest({
        userId: 'user-1',
        ...providerBody,
        quality: 'standard',
        sections: 'introduction',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );
    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(generateChunkAudio).toHaveBeenCalledTimes(2);
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'download_complete' })]));
  });

  it('defaults Google TTS generation to the configured Gemini 2.5 env model', async () => {
    const previousModel25 = process.env.GEMINI_AUDIO_2_5_TTS;
    process.env.GEMINI_AUDIO_2_5_TTS = 'configured-gemini-2.5-tts';
    try {
      (generateChunkAudio as jest.Mock).mockResolvedValue({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 0,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      });

      const response = await POST(
        createRequest({
          userId: 'user-1',
          provider: 'google',
          voice: 'Charon',
          model: 'gemini-2.5-flash-tts',
          quality: 'standard',
          sections: 'introduction',
        }) as never,
        { params: Promise.resolve({ id: 'sermon-1' }) }
      );

      await readStreamEvents(response.body as ReadableStream<Uint8Array>);

      expect(generateChunkAudio).toHaveBeenCalledWith(
        'Introduction chunk text.',
        expect.objectContaining({
          provider: 'google',
          voice: 'Charon',
          model: 'configured-gemini-2.5-tts',
          format: 'wav',
        })
      );
    } finally {
      if (previousModel25 === undefined) {
        delete process.env.GEMINI_AUDIO_2_5_TTS;
      } else {
        process.env.GEMINI_AUDIO_2_5_TTS = previousModel25;
      }
    }
  });

  it('uses the configured Gemini 3.1 env model when that UI model is selected', async () => {
    const previousModel31 = process.env.GEMINI_AUDIO_3_1_TTS;
    process.env.GEMINI_AUDIO_3_1_TTS = 'configured-gemini-3.1-tts';
    try {
      (generateChunkAudio as jest.Mock).mockResolvedValue({
        audioBlob: new Blob([new Uint8Array(10)], { type: 'audio/wav' }),
        index: 0,
        durationSeconds: 1,
        mimeType: 'audio/wav',
      });

      const response = await POST(
        createRequest({
          userId: 'user-1',
          provider: 'google',
          voice: 'Charon',
          model: 'gemini-3.1-flash-tts',
          quality: 'standard',
          sections: 'introduction',
        }) as never,
        { params: Promise.resolve({ id: 'sermon-1' }) }
      );

      await readStreamEvents(response.body as ReadableStream<Uint8Array>);

      expect(generateChunkAudio).toHaveBeenCalledWith(
        'Introduction chunk text.',
        expect.objectContaining({
          provider: 'google',
          voice: 'Charon',
          model: 'configured-gemini-3.1-tts',
          format: 'wav',
        })
      );
    } finally {
      if (previousModel31 === undefined) {
        delete process.env.GEMINI_AUDIO_3_1_TTS;
      } else {
        process.env.GEMINI_AUDIO_3_1_TTS = previousModel31;
      }
    }
  });

  it('stops streaming chunk data when the client disconnects', async () => {
    (generateChunkAudio as jest.Mock).mockResolvedValue({
      audioBlob: new Blob(['chunk-1'], { type: 'audio/wav' }),
      index: 0,
      durationSeconds: 1,
    });

    const response = await POST(
      createRequest(
        {
          userId: 'user-1',
          voice: 'onyx',
          quality: 'standard',
          sections: 'introduction',
        },
        { aborted: true }
      ) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(events.some(event => event.type === 'audio_chunk')).toBe(false);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'download_complete',
          filename: 'grace-peace-audio.mp3',
        }),
      ])
    );
  });

  it('continues an export after one chunk rejects and meters only successful audio', async () => {
    (generateChunkAudio as jest.Mock).mockImplementation((text: string) => {
      if (text.startsWith('Introduction')) {
        return Promise.reject(new Error('first chunk failed'));
      }
      return Promise.resolve({
        audioBlob: new Blob(['successful-chunk'], { type: 'audio/mpeg' }),
        index: 1,
        durationSeconds: 99,
        mimeType: 'audio/mpeg',
      });
    });
    (getMeteredAudioDurationSeconds as jest.Mock).mockResolvedValueOnce(2.75);

    const response = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'onyx',
        quality: 'standard',
        sections: 'all',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'download_complete' }),
    ]));
    expect(events.some(event => event.type === 'error')).toBe(false);
    expect(getMeteredAudioDurationSeconds).toHaveBeenCalledWith(
      expect.any(Blob),
      'audio/mpeg',
      'Main part chunk text.'
    );
    expect(consumeAudioSeconds).toHaveBeenCalledWith('user-1', 2.75, expect.any(Date));
    expect(consumeAiUsage).toHaveBeenCalledTimes(1);
    expect((generateChunkAudio as jest.Mock).mock.calls.filter(([text]) =>
      String(text).startsWith('Introduction'))).toHaveLength(2);
  });

  it('admits only offset zero and lets later batches finish after crossing the cap', async () => {
    (generateChunkAudio as jest.Mock).mockResolvedValue({
      audioBlob: new Blob(['batch-chunk'], { type: 'audio/mpeg' }),
      index: 0,
      durationSeconds: 99,
      mimeType: 'audio/mpeg',
    });
    (getMeteredAudioDurationSeconds as jest.Mock)
      .mockResolvedValueOnce(1.25)
      .mockResolvedValueOnce(2.5);

    const firstResponse = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'onyx',
        quality: 'standard',
        sections: 'all',
        offset: 0,
        limit: 1,
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );
    await readStreamEvents(firstResponse.body as ReadableStream<Uint8Array>);

    (getUserEntitlementServerSide as jest.Mock).mockResolvedValue({
      paidTier: 'tier2',
      usage: { aiUsed: 220, audioSecondsUsed: 13_200 },
    });

    const secondResponse = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'onyx',
        quality: 'standard',
        sections: 'all',
        offset: 1,
        limit: 1,
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );
    await readStreamEvents(secondResponse.body as ReadableStream<Uint8Array>);

    expect(consumeAudioSeconds).toHaveBeenNthCalledWith(1, 'user-1', 1.25, expect.any(Date));
    expect(consumeAudioSeconds).toHaveBeenNthCalledWith(2, 'user-1', 2.5, expect.any(Date));
    expect(createUsageAdmission).toHaveBeenCalledTimes(1);
    expect(consumeAiUsage).toHaveBeenCalledTimes(1);
    expect(consumeAiUsage).toHaveBeenCalledWith('user-1', expect.any(Date));
  });

  it('sends an error event when generation fails inside the stream', async () => {
    // Chunks are generated in parallel, so make every chunk fail to keep the
    // stream deterministic: a single failing chunk could otherwise race with a
    // sibling chunk's progress event.
    (generateChunkAudio as jest.Mock).mockRejectedValue(new Error('TTS failed'));

    const response = await POST(
      createRequest({
        userId: 'user-1',
        voice: 'onyx',
        quality: 'standard',
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(200);

    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress', current: 2, total: 2, percent: 80 }),
      {
        type: 'error',
        message: 'TTS generation failed with openai/gpt-4o-mini-tts: All TTS chunks failed',
      },
    ]));
    expect((generateChunkAudio as jest.Mock).mock.calls.every(([, options]) =>
      options.provider === 'openai' && options.model === 'gpt-4o-mini-tts'))
      .toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(getMeteredAudioDurationSeconds).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
    expect(consumeAudioSeconds).not.toHaveBeenCalled();
  });

  it('returns a typed 429 envelope before TTS when usage is capped', async () => {
    (createUsageAdmission as jest.Mock).mockImplementationOnce(() => {
      throw new UsageCapReachedError(
        'audio',
        1_320,
        1_200,
        1_320,
        '2026-08-01T00:00:00.000Z'
      );
    });

    const response = await POST(
      createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      code: 'USAGE_CAP_REACHED',
      resource: 'audio',
      used: 1_320,
      baseLimit: 1_200,
      hardCap: 1_320,
      resetsAt: '2026-08-01T00:00:00.000Z',
    });
    expect(generateChunkAudio).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
    expect(consumeAudioSeconds).not.toHaveBeenCalled();
  });

  it('returns 500 when the route setup fails before the stream starts', async () => {
    const badRequest = {
      json: jest.fn().mockRejectedValue(new Error('Bad JSON')),
      signal: { aborted: false },
    };

    const response = await POST(badRequest as never, {
      params: Promise.resolve({ id: 'sermon-1' }),
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Bad JSON' });
  });
});
