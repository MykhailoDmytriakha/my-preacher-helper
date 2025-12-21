// Intentionally do NOT import the route at module scope because Next's
// Request polyfill expects Web Fetch API globals to exist at import time.

// Mock external dependencies used by the route
jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn().mockResolvedValue({
      id: 's-1',
      title: 'T',
      verse: 'V',
      date: new Date().toISOString(),
      thoughts: [],
      userId: 'u-1',
    }),
  },
}));

// Provide a lightweight NextResponse.json to avoid pulling Next internals
jest.mock('next/server', () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => data,
    }),
  },
}));

jest.mock('@clients/firestore.client', () => ({
  getRequiredTags: jest.fn().mockResolvedValue([{ name: 'Вступление' }, { name: 'Основная часть' }, { name: 'Заключение' }]),
  getCustomTags: jest.fn().mockResolvedValue([]),
}));

jest.mock('@clients/openAI.client', () => ({
  createTranscription: jest.fn().mockResolvedValue('audio text'),
  generateThought: jest.fn().mockResolvedValue({
    originalText: 'audio text',
    formattedText: 'final text',
    tags: ['Основная часть'],
    meaningSuccessfullyPreserved: true,
  }),
}));

jest.mock('@clients/thought.structured', () => ({
  generateThoughtStructured: jest.fn().mockResolvedValue({
    originalText: 'audio text',
    formattedText: 'final text',
    tags: ['Основная часть'],
    meaningSuccessfullyPreserved: true,
  }),
}));

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: () => ({
      doc: () => ({
        update: jest.fn().mockResolvedValue(undefined),
      }),
    }),
    runTransaction: jest.fn(),
  },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { arrayUnion: (v: any) => v, arrayRemove: (v: any) => v },
}));

jest.mock('uuid', () => ({ v4: () => 'thought-fixed-id' }));

describe('api/thoughts POST attaches outlinePointId', () => {
  it('returns Thought with outlinePointId when provided in FormData', async () => {
    // Ensure Fetch API globals exist before importing the route
    try {
      const undici = await import('undici');
      globalThis.Blob = globalThis.Blob || undici.Blob;
      globalThis.File = globalThis.File || undici.File;
      globalThis.FormData = globalThis.FormData || undici.FormData;
      globalThis.Headers = globalThis.Headers || undici.Headers;
      globalThis.Request = globalThis.Request || undici.Request;
      globalThis.Response = globalThis.Response || undici.Response;
    } catch {}

    const fd = new FormData();
    const blob = new Blob(['123'], { type: 'audio/webm' });
    fd.append('audio', blob, 'recording.webm');
    fd.append('sermonId', 's-1');
    fd.append('outlinePointId', 'op-1');

    const req: any = { url: 'http://localhost/api/thoughts', formData: async () => fd };
    const { POST } = await import('@/api/thoughts/route');
    const res = await POST(req as unknown as Request);
    const json = await (res as Response).json();

    expect(json.id).toBe('thought-fixed-id');
    expect(json.text).toBe('final text');
    expect(json.outlinePointId).toBe('op-1');
  });
});
