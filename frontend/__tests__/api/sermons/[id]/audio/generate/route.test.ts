import { ReadableStream } from 'node:stream/web';
import { TextDecoder, TextEncoder } from 'util';

import { generateChunkAudio, getTTSModel } from '@/api/clients/tts.client';
import { adminDb } from '@/config/firebaseAdminConfig';
import { concatenateAudioBlobs, insertSilenceBetweenBlobs } from '@/utils/audioConcat';

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
  getTTSModel: jest.fn(),
}));

jest.mock('@/utils/audioConcat', () => ({
  concatenateAudioBlobs: jest.fn(),
  insertSilenceBetweenBlobs: jest.fn(),
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
    body: JSON.stringify(body),
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

    (adminDb.collection as jest.Mock).mockReturnValue({
      doc: mockDoc,
    });

    mockDoc.mockReturnValue({
      get: mockGet,
      update: mockUpdate,
    });

    (getTTSModel as jest.Mock).mockReturnValue('gpt-audio-test');
    (insertSilenceBetweenBlobs as jest.Mock).mockImplementation(async (blobs: Blob[]) => blobs);
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

  it('returns 401 when userId is missing', async () => {
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
      error: 'No chunks found for section: conclusion',
    });
  });

  it('streams progress, chunk data, and completion for a successful generation', async () => {
    (generateChunkAudio as jest.Mock)
      .mockResolvedValueOnce({
        audioBlob: new Blob(['chunk-1'], { type: 'audio/wav' }),
        index: 0,
        durationSeconds: 1,
      })
      .mockResolvedValueOnce({
        audioBlob: new Blob(['chunk-2'], { type: 'audio/wav' }),
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
        voice: 'ash',
        model: 'gpt-audio-test',
        format: 'wav',
      }
    );
    expect(generateChunkAudio).toHaveBeenNthCalledWith(
      2,
      'Main part chunk text.',
      {
        voice: 'ash',
        model: 'gpt-audio-test',
        format: 'wav',
      }
    );
    expect(insertSilenceBetweenBlobs).toHaveBeenCalledWith(
      expect.arrayContaining([expect.any(Blob), expect.any(Blob)]),
      500
    );
    expect(concatenateAudioBlobs).toHaveBeenCalled();

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
          percent: 82,
          status: 'Adding pauses...',
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
          filename: 'grace-peace-audio.wav',
          audioUrl: '',
        }),
      ])
    );

    const audioChunkEvents = events.filter(event => event.type === 'audio_chunk');
    expect(audioChunkEvents.length).toBeGreaterThan(10);
    expect(events.some(event => String(event.status || '').includes('Downloading audio...'))).toBe(true);

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        'audioMetadata.voice': 'ash',
        'audioMetadata.model': 'gpt-audio-test',
        'audioMetadata.lastGenerated': expect.any(String),
      })
    );
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
          filename: 'grace-peace-audio.wav',
        }),
      ])
    );
  });

  it('sends an error event when generation fails inside the stream', async () => {
    (generateChunkAudio as jest.Mock).mockRejectedValueOnce(new Error('TTS failed'));

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

    expect(events).toEqual([
      {
        type: 'error',
        message: 'TTS failed',
      },
    ]);
    expect(mockUpdate).not.toHaveBeenCalled();
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
