/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}), { virtual: true });

import { ReadableStream } from 'node:stream/web';

import { audioExportFirestore } from '../../../../../../test-utils/audioExportFirestore';
import { TextDecoder, TextEncoder } from 'util';

import { resolveUserTtsTarget } from '@/api/clients/ai/tierPolicy';
import { getRequiredAuthenticatedUid } from '@/api/auth/requireAuthenticatedUid.server';
import { generateChunkAudio, splitTextEvenly, splitTextIntoChunks } from '@/api/clients/tts.client';
import { adminDb } from '@/config/firebaseAdminConfig';
import { __resetStoreAvailabilityForTests } from '@/services/storeAvailability.server';
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
    getAll: jest.fn(),
    runTransaction: jest.fn(async callback => {
      const writes: Promise<unknown>[] = [];
      const result = await callback({ get: (ref: any) => ref.get(), update: (ref: any, data: unknown) => { writes.push(Promise.resolve(ref.update(data))); } });
      await Promise.all(writes);
      return result;
    }),
  },
}));

// Sermons are engine-owned: production writes the metadata through updateOwnedDocument, which
// edits the stored document via the engine. Only that door is replaced here.
const mockUpdateOwnedDocument = jest.fn();
jest.mock('@/data-engine/serverEdit.server', () => ({
  ...jest.requireActual('@/data-engine/serverEdit.server'),
  updateOwnedDocument: (...args: unknown[]) => mockUpdateOwnedDocument(...args),
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
  normalizeEntitlementUsage: jest.requireActual('@/services/userEntitlement.server').normalizeEntitlementUsage,
  getUsagePeriodStart: jest.requireActual('@/services/userEntitlement.server').getUsagePeriodStart,
  resolveEffectiveTier: jest.fn((entitlement: { paidTier?: string } | null | undefined) => entitlement?.paidTier ?? 'free'),
}));

jest.mock('@/services/usageLimits.server', () => ({
  createUsageAdmission: jest.fn(),
  usageAfterConsumption: jest.requireActual('@/services/usageLimits.server').usageAfterConsumption,
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
let mockOperationalIO: ReturnType<typeof audioExportFirestore>;

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

// Test facts declare which persisted source and sections have actually been prepared.
// This fixture helper is independent of production source-discovery code.
function withPreparedSource<T extends { audioChunks: unknown[]; audioMetadata?: Record<string, unknown>; audioSources?: Record<string, unknown> }>(
  document: T,
  mode: 'ai' | 'raw',
  preparedSections: ('introduction' | 'mainPart' | 'conclusion')[],
  id = `test-${mode}-source`,
) {
  const chunks = document.audioChunks as Record<string, unknown>[];
  return {
    ...document,
    audioMetadata: { ...document.audioMetadata, mode, chunksCount: chunks.length },
    audioSources: {
      ...document.audioSources,
      [mode]: { id, revision: 1, sections: [...preparedSections], chunks: structuredClone(chunks) },
    },
  };
}

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

    mockOperationalIO = audioExportFirestore();
    (adminDb.collection as jest.Mock).mockImplementation(name => name === 'sermons' ? { doc: mockDoc } : mockOperationalIO.db.collection(name));
    (adminDb.runTransaction as jest.Mock).mockImplementation(callback => mockOperationalIO.db.runTransaction(callback));
    (adminDb.getAll as jest.Mock).mockImplementation((...references) => mockOperationalIO.db.getAll(...references));

    mockDoc.mockReturnValue({
      get: mockGet,
    });
    mockUpdateOwnedDocument.mockReset();
    mockUpdateOwnedDocument.mockResolvedValue({});

    (createSilenceBlob as jest.Mock).mockReturnValue(new Blob([new Uint8Array(8)], { type: 'audio/wav' }));
    (concatenateAudioBlobs as jest.Mock).mockResolvedValue(createFinalAudioBlob(400_000));

    mockGet.mockResolvedValue({
      exists: true,
      id: 'sermon-1',
      data: () => withPreparedSource({
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
      }, 'ai', ['introduction', 'mainPart', 'conclusion']),
    });
  });

  describe('stored source identity before any TTS work', () => {
    const ai = [{ index: 0, sectionId: 'introduction', text: 'Saved AI correction', createdAt: '2026-10-01T00:00:00.000Z' }];
    const raw = [{ ...ai[0], text: 'Original source words' }];
    const setStored = (active = ai, activeMode = 'ai') => mockGet.mockResolvedValue({
      exists: true, id: 'sermon-1', data: () => ({ userId: 'user-1', audioChunks: active, audioMetadata: { mode: activeMode },
        audioSources: { ai: { id: 'ai-set', revision: 7, sections: ['introduction'], chunks: ai }, raw: { id: 'raw-set', revision: 3, sections: ['introduction'], chunks: raw } } }),
    });
    const call = async (body: Record<string, unknown>) => {
      (generateChunkAudio as jest.Mock).mockResolvedValue({ audioBlob: new Blob([new Uint8Array(8)], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1 });
      const response = await POST(createRequest({ userId: 'user-1', voice: 'onyx', sections: 'introduction', mode: 'ai', source: { id: 'ai-set', revision: 7 }, expected: ai, ...body }) as never, { params: Promise.resolve({ id: 'sermon-1' }) });
      if (response.status === 200) await readStreamEvents(response.body as ReadableStream<Uint8Array>);
      return response;
    };

    it('refuses a stale source revision even if every word still matches', async () => {
      setStored();
      const response = await call({ source: { id: 'ai-set', revision: 6 } });
      expect(response.status).toBe(409); expect(generateChunkAudio).not.toHaveBeenCalled();
      expect(createUsageAdmission).not.toHaveBeenCalled();
    });

    it('refuses an unprepared selected section instead of generating incomplete audio', async () => {
      setStored();
      const response = await call({ sections: ['introduction', 'mainPart'] });
      expect(response.status).toBe(409); expect(generateChunkAudio).not.toHaveBeenCalled();
      expect(createUsageAdmission).not.toHaveBeenCalled();
    });

    it('reads the selected stored AI source while Original is the legacy active projection', async () => {
      setStored(raw, 'raw');
      const response = await call({});
      expect(response.status).toBe(200);
      expect(generateChunkAudio).toHaveBeenCalledWith('Saved AI correction', expect.any(Object));
    });

    it('never lets Google voice AI text, including a client without a source token', async () => {
      setStored();
      const response = await call({ provider: 'google', voice: 'Puck', model: 'gemini-3.1-flash-tts', mode: undefined, source: undefined });
      expect(response.status).toBe(409); expect(generateChunkAudio).not.toHaveBeenCalled();
      expect(createUsageAdmission).not.toHaveBeenCalled();
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

  // Engine-owned sermons are served on every deployment, so a document carrying the engine marker is
  // no longer refused up front with 426 (assertServerWritable lets it through); the generation runs
  // and the metadata lands through the engine door.
  it('generates audio for a document the engine owns instead of refusing it', async () => {
    mockGet.mockResolvedValueOnce({
      exists: true, id: 'sermon-1',
      data: () => withPreparedSource({ userId: 'user-1', title: 'Grace', _dataEngine: { protocol: 1 },
        audioChunks: [{ text: 'Introduction chunk text.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 }] }, 'ai', ['introduction', 'mainPart', 'conclusion']),
    });
    (generateChunkAudio as jest.Mock).mockResolvedValue({ audioBlob: new Blob([new Uint8Array(250_000)], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1 });
    const response = await POST(createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never, { params: Promise.resolve({ id: 'sermon-1' }) });
    expect(response.status).toBe(200);
    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);
    expect(events.some(event => event.type === 'download_complete')).toBe(true);
    expect(generateChunkAudio).toHaveBeenCalled();
    expect(mockUpdateOwnedDocument).toHaveBeenCalledWith('user-1', { collection: 'sermons', id: 'sermon-1' }, expect.objectContaining({ 'audioMetadata.voice': 'onyx' }));
  });

  it('streams an explicit error when the engine edit refuses after generation', async () => {
    const { ServerEditError } = jest.requireActual('@/data-engine/serverEdit.server') as typeof import('@/data-engine/serverEdit.server');
    (generateChunkAudio as jest.Mock).mockResolvedValue({ audioBlob: new Blob([new Uint8Array(250_000)], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1 });
    mockUpdateOwnedDocument.mockRejectedValueOnce(new ServerEditError('conflict', 409));
    const response = await POST(createRequest({ userId: 'user-1', voice: 'onyx', quality: 'standard' }) as never, { params: Promise.resolve({ id: 'sermon-1' }) });
    const events = await readStreamEvents(response.body as ReadableStream<Uint8Array>);
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', message: expect.stringContaining('conflict') }));
    expect(events.some(event => event.type === 'download_complete')).toBe(false);
  });

  /**
   * THE TEXT ON SCREEN IS THE TEXT VOICED (BUG-20260810-audio-chunks-whole-array). The wizard
   * sends the set it shows; a different stored set comes back instead of audio — before any
   * allowance is admitted.
   */
  it('answers with the stored set instead of audio when the shown set differs', async () => {
    const response = await POST(
      createRequest({
        userId: 'user-1', voice: 'ash', quality: 'hd', sections: 'all',
        expected: [
          { text: 'Introduction as the screen showed it.', sectionId: 'introduction', index: 0 },
          { text: 'Main part chunk text.', sectionId: 'mainPart', index: 1 },
        ],
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('chunks-changed');
    expect(body.chunks[0].text).toBe('Introduction chunk text.');
    expect(createUsageAdmission).not.toHaveBeenCalled();
    expect(generateChunkAudio).not.toHaveBeenCalled();
  });

  it('makes audio when the shown set is the stored one', async () => {
    (generateChunkAudio as jest.Mock).mockResolvedValue({ audioBlob: new Blob([new Uint8Array(8)], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1 });
    const response = await POST(
      createRequest({
        userId: 'user-1', voice: 'ash', quality: 'hd', sections: 'all',
        // As the wizard holds it: a preview field and no createdAt are bookkeeping, not text.
        expected: [
          { text: 'Introduction chunk text.', sectionId: 'introduction', index: 0, preview: 'Introduction…' },
          { text: 'Main part chunk text.', sectionId: 'mainPart', index: 1, kind: 'body' },
        ],
      }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) }
    );

    expect(response.status).toBe(200);
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

    expect(getUserEntitlementServerSide).toHaveBeenCalledWith('user-1', { includeModelPreferences: true, reconcileTextReceipts: true });
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

    expect(mockUpdateOwnedDocument).toHaveBeenCalledWith(
      'user-1',
      { collection: 'sermons', id: 'sermon-1' },
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
      data: () => withPreparedSource({
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
      }, 'ai', ['introduction']),
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
      data: () => withPreparedSource({
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
      }, 'raw', ['introduction', 'mainPart', 'conclusion']),
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
        mode: 'raw',
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
    expect(mockUpdateOwnedDocument).toHaveBeenCalledWith(
      'user-1',
      { collection: 'sermons', id: 'sermon-1' },
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
      data: () => withPreparedSource({
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
      }, 'raw', ['introduction', 'mainPart', 'conclusion']),
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
        mode: 'raw',
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
      data: () => withPreparedSource({
        id: 'sermon-1',
        title: 'Grace & Peace',
        userId: 'user-1',
        audioChunks: [
          { text: 'Intro first. Intro second.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 },
          { text: 'Main only.', sectionId: 'mainPart', createdAt: '2026-02-27T00:00:00.000Z', index: 1 },
        ],
      }, 'raw', ['introduction', 'mainPart', 'conclusion']),
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
          mode: 'raw',
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
    expect(mockOperationalIO.documents.get('users/user-1')!.usage.aiUsed).toBe(1);
  });

  it.each([
    ['OpenAI', { provider: 'openai', voice: 'onyx', model: 'gpt-4o-mini-tts', mode: 'ai' },
      withPreparedSource({ userId: 'user-1', title: 'Grace & Peace', audioChunks: [{ text: 'Introduction chunk text.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 }] }, 'ai', ['introduction'])],
    ['Google', { provider: 'google', voice: 'Puck', model: 'gemini-2.5-flash-tts', mode: 'raw' },
      withPreparedSource({ userId: 'user-1', title: 'Grace & Peace', audioChunks: [{ text: 'Introduction chunk text.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 }] }, 'raw', ['introduction'])],
  ])('retries one transient %s chunk failure and then succeeds', async (_label, providerBody, fixture) => {
    mockGet.mockResolvedValueOnce({ exists: true, id: 'sermon-1', data: () => fixture });
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
      mockGet.mockResolvedValueOnce({ exists: true, id: 'sermon-1', data: () => withPreparedSource({
        userId: 'user-1', audioChunks: [{ text: 'Introduction chunk text.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 }],
      }, 'raw', ['introduction']) });
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
          mode: 'raw',
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
      mockGet.mockResolvedValueOnce({ exists: true, id: 'sermon-1', data: () => withPreparedSource({
        userId: 'user-1', audioChunks: [{ text: 'Introduction chunk text.', sectionId: 'introduction', createdAt: '2026-02-27T00:00:00.000Z', index: 0 }],
      }, 'raw', ['introduction']) });
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
          mode: 'raw',
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

  it('refuses a batch whose chunk failed twice, names the chunk, and charges nothing for it', async () => {
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

    // The sermon text is never delivered with a hole in it: no audio, no completion.
    expect(events.some(event => event.type === 'download_complete' || event.type === 'audio_chunk')).toBe(false);
    expect(events).toContainEqual(expect.objectContaining({ type: 'error', code: 'tts-chunk-failed', chunks: [1] }));
    expect((generateChunkAudio as jest.Mock).mock.calls.filter(([text]) =>
      String(text).startsWith('Introduction'))).toHaveLength(2);
    expect(consumeAudioSeconds).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
  });

  it('refuses an unadmitted continuation before TTS', async () => {
    (createUsageAdmission as jest.Mock).mockImplementation(() => {
      throw new UsageCapReachedError('audio', 1_320, 1_200, 1_320, '2026-08-01T00:00:00.000Z');
    });
    (generateChunkAudio as jest.Mock).mockResolvedValue({
      audioBlob: new Blob(['forged-continuation'], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1,
    });
    const response = await POST(createRequest({ userId: 'user-1', voice: 'onyx', sections: 'all', offset: 1, limit: 1 }) as never,
      { params: Promise.resolve({ id: 'sermon-1' }) });
    if (response.status === 200) await readStreamEvents(response.body as ReadableStream<Uint8Array>);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(generateChunkAudio).not.toHaveBeenCalled();
    expect(consumeAudioSeconds).not.toHaveBeenCalled();
  });

  it('replays a completed continuation without another paid provider call or usage charge', async () => {
    (generateChunkAudio as jest.Mock).mockResolvedValue({
      audioBlob: new Blob(['retained-audio'], { type: 'audio/mpeg' }), index: 0, durationSeconds: 1,
    });
    const body = { userId: 'user-1', voice: 'onyx', sections: 'all', limit: 1, exportId: 'qa-audio-export-1' };
    const call = async (offset: number) => {
      const response = await POST(createRequest({ ...body, offset }) as never,
        { params: Promise.resolve({ id: 'sermon-1' }) });
      expect(response.status).toBe(200);
      return readStreamEvents(response.body as ReadableStream<Uint8Array>);
    };
    await call(0);
    (createUsageAdmission as jest.Mock).mockImplementation(() => {
      throw new UsageCapReachedError('audio', 1_320, 1_200, 1_320, '2026-08-01T00:00:00.000Z');
    });
    const original = await call(1);
    const replay = await call(1);
    expect(original.some(event => event.type === 'download_complete')).toBe(true);
    expect(replay.filter(event => event.type === 'audio_chunk')).toEqual(original.filter(event => event.type === 'audio_chunk'));
    expect(generateChunkAudio).toHaveBeenCalledTimes(2);
    expect(mockOperationalIO.documents.get('users/user-1')!.usage).toMatchObject({ audioSecondsUsed: 2, aiUsed: 1 });
    expect(createUsageAdmission).toHaveBeenCalledTimes(1);
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

    expect(mockOperationalIO.documents.get('users/user-1')!.usage).toMatchObject({ audioSecondsUsed: 3.75, aiUsed: 1 });
    expect(createUsageAdmission).toHaveBeenCalledTimes(1);
    expect(consumeAudioSeconds).not.toHaveBeenCalled();
    expect(consumeAiUsage).not.toHaveBeenCalled();
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
      expect.objectContaining({ type: 'error', code: 'tts-chunk-failed', chunks: [1, 2] }),
    ]));
    expect((generateChunkAudio as jest.Mock).mock.calls.every(([, options]) =>
      options.provider === 'openai' && options.model === 'gpt-4o-mini-tts'))
      .toBe(true);
    expect(mockUpdateOwnedDocument).not.toHaveBeenCalled();
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

  it('answers a refused first store read before generate provider work', async () => {
    __resetStoreAvailabilityForTests();
    mockGet.mockRejectedValueOnce(Object.assign(new Error('Test store refusal'), { code: 8 }));
    try {
      const request = new NextRequest('http://localhost:3047/api/qa-audio', { body: JSON.stringify({}) });
      const response = await POST(request as unknown as Parameters<typeof POST>[0], { params: Promise.resolve({ id: 'qa-sermon' }) });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({ code: 'unavailable' });
      expect(generateChunkAudio).not.toHaveBeenCalled();
    } finally {
      __resetStoreAvailabilityForTests();
    }
  });
});
