// Additional tests for /api/thoughts route to improve coverage
import { UsageCapReachedError } from '@/services/usageLimits';

const updateMock = jest.fn();
const docMock = jest.fn(() => ({ update: updateMock }));
const collectionMock = jest.fn(() => ({ doc: docMock }));
const runTransactionMock = jest.fn();
const RETRYABLE_ERROR_MESSAGE = 'Temporary transcription connection issue. The recording looked valid, but the transcription service connection failed. Please try again.';

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminDb: {
    collection: collectionMock,
    runTransaction: runTransactionMock,
  },
}));

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: {
    arrayUnion: (value: unknown) => ({ elements: [value] }),
    arrayRemove: (value: unknown) => ({ elements: [value] }),
    serverTimestamp: () => 'mocked-server-timestamp',
  },
}));

jest.mock('@clients/openAI.client', () => ({
  createTranscription: jest.fn(),
  generateThought: jest.fn(),
}));

jest.mock('@clients/thought.structured', () => ({
  generateThoughtStructured: jest.fn(),
}));

jest.mock('@clients/firestore.client', () => ({
  getCustomTags: jest.fn(),
}));

jest.mock('@/api/auth/requireAuthenticatedUid.server', () => ({
  getRequiredAuthenticatedUid: jest.fn((request: Request) => Promise.resolve(
    request.headers?.get('authorization') ? 'user-1' : null
  )),
}));

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: jest.fn().mockResolvedValue({ paidTier: 'free' }),
}));

jest.mock('@/services/usageLimits.server', () => ({
  createUsageAdmission: jest.fn().mockReturnValue({
    userId: 'user-1',
    resources: ['transcription', 'ai'],
  }),
  consumeTranscriptionSeconds: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
    updateSermonData: jest.fn(),
  },
}));

jest.mock('@/utils/server/audioServerUtils', () => ({
  validateAudioDuration: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options: { status?: number } = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

function createFormRequest(formData: FormData, url = 'http://localhost/api/thoughts') {
  return {
    formData: async () => formData,
    url,
    headers: new Headers({ authorization: 'Bearer valid-token' }),
  } as unknown as Request;
}

function createJsonRequest(body: unknown, url = 'http://localhost/api/thoughts') {
  return {
    json: async () => body,
    url,
    headers: new Headers({ authorization: 'Bearer valid-token' }),
  } as unknown as Request;
}

describe('Thoughts API route additional coverage', () => {
  let POST: (request: Request) => Promise<Response>;
  let DELETE: (request: Request) => Promise<Response>;
  let PUT: (request: Request) => Promise<Response>;

  let createTranscriptionMock: jest.Mock;
  let generateThoughtStructuredMock: jest.Mock;
  let getCustomTagsMock: jest.Mock;
  let fetchSermonByIdMock: jest.Mock;
  let validateAudioDurationMock: jest.Mock;
  let sermonsRepoMock: any;

  beforeAll(async () => {
    try {
      const undici = await import('undici');
      globalThis.Blob = globalThis.Blob || undici.Blob;
      globalThis.File = globalThis.File || undici.File;
      globalThis.FormData = globalThis.FormData || undici.FormData;
      globalThis.Headers = globalThis.Headers || undici.Headers;
      globalThis.Request = globalThis.Request || undici.Request;
      globalThis.Response = globalThis.Response || undici.Response;
    } catch {
      // Ignore if undici is unavailable; Node 18+ provides these globals.
    }
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.resetModules();

    const routeModule = await import('@/api/thoughts/route');
    POST = routeModule.POST;
    DELETE = routeModule.DELETE;
    PUT = routeModule.PUT;

    const openAIClient = await import('@clients/openAI.client');
    const thoughtStructured = await import('@clients/thought.structured');
    const firestoreClient = await import('@clients/firestore.client');
    const sermonsRepo = await import('@repositories/sermons.repository');
    const audioServerUtils = await import('@/utils/server/audioServerUtils');

    createTranscriptionMock = openAIClient.createTranscription as jest.Mock;
    generateThoughtStructuredMock = thoughtStructured.generateThoughtStructured as jest.Mock;
    getCustomTagsMock = firestoreClient.getCustomTags as jest.Mock;
    validateAudioDurationMock = audioServerUtils.validateAudioDuration as jest.Mock;
    sermonsRepoMock = sermonsRepo;
    fetchSermonByIdMock = sermonsRepo.sermonsRepository.fetchSermonById as jest.Mock;

    getCustomTagsMock.mockResolvedValue([]);
    validateAudioDurationMock.mockResolvedValue({ valid: true, duration: 2, maxAllowed: 97 });
    fetchSermonByIdMock.mockResolvedValue({ userId: 'user-1', thoughts: [] });
    createTranscriptionMock.mockResolvedValue('transcribed');
    generateThoughtStructuredMock.mockResolvedValue({
      meaningSuccessfullyPreserved: true,
      originalText: 'transcribed',
      formattedText: 'formatted',
      tags: ['Примеры'],
    });
  });

  describe('POST manual mode', () => {
    it('returns created manual thought with optional fields', async () => {
      const request = createJsonRequest(
        {
          sermonId: 'sermon-1',
          thought: {
            text: 'Manual thought',
            tags: ['Tag1'],
            date: '2024-01-01',
            outlinePointId: 'op-1',
            subPointId: 'sp-1',
            position: 2,
          },
        },
        'http://localhost/api/thoughts?manual=true'
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(
        expect.objectContaining({
          id: 'mock-uuid',
          text: 'Manual thought',
          tags: ['Tag1'],
          date: '2024-01-01',
          outlinePointId: 'op-1',
          subPointId: 'sp-1',
          position: 2,
        })
      );
      expect(sermonsRepoMock.sermonsRepository.updateSermonData).toHaveBeenCalledTimes(1);
    });

    it('removes deprecated structural tags from manual thoughts', async () => {
      const request = createJsonRequest(
        {
          sermonId: 'sermon-1',
          thought: {
            text: 'Manual thought',
            tags: ['Основная часть', 'Примеры'],
            date: '2024-01-01',
          },
        },
        'http://localhost/api/thoughts?manual=true'
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tags).toEqual(['Примеры']);
      expect(sermonsRepoMock.sermonsRepository.updateSermonData).toHaveBeenCalledWith(
        'sermon-1',
        expect.objectContaining({
          thoughts: expect.objectContaining({
            elements: [expect.objectContaining({ tags: ['Примеры'] })],
          }),
        })
      );
    });

    it('returns 400 when sermonId or thought is missing', async () => {
      const request = createJsonRequest({ thought: null }, 'http://localhost/api/thoughts?manual=true');

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'sermonId and thought are required' });
    });

    it('returns 400 when thought is missing required fields', async () => {
      fetchSermonByIdMock.mockResolvedValueOnce({ userId: 'user-1' });

      const request = createJsonRequest(
        {
          sermonId: 'sermon-1',
          thought: {
            tags: ['Tag1'],
          },
        },
        'http://localhost/api/thoughts?manual=true'
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Thought is missing required fields' });
    });
  });

  describe('POST validation and transcription errors', () => {
    it('returns 400 when sermonId is missing', async () => {
      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'sermonId is required' });
      expect(createTranscriptionMock).not.toHaveBeenCalled();
    });

    it('returns 400 when audio is not a Blob', async () => {
      const formData = new FormData();
      formData.append('audio', 'not-a-blob');
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid audio format' });
      expect(createTranscriptionMock).not.toHaveBeenCalled();
    });

    it('returns 400 when audio duration exceeds the configured limit', async () => {
      validateAudioDurationMock.mockResolvedValueOnce({
        valid: false,
        duration: 132,
        maxAllowed: 97,
        error: 'Audio duration (132.0s) exceeds maximum allowed (97s).',
      });

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Audio duration (132.0s) exceeds maximum allowed (97s).' });
      expect(createTranscriptionMock).not.toHaveBeenCalled();
    });

    it('passes only auxiliary available tags into thought generation', async () => {
      getCustomTagsMock.mockResolvedValueOnce([
        { name: 'Основная часть' },
        { name: 'Стих' },
        { name: 'Примеры' },
      ]);

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const usageLimits = await import('@/services/usageLimits.server');
      const entitlementService = await import('@/services/userEntitlement.server');

      expect(response.status).toBe(200);
      expect(generateThoughtStructuredMock).toHaveBeenCalledWith(
        'transcribed',
        expect.any(Object),
        ['Стих', 'Примеры'],
        {
          userId: 'user-1',
          usageAdmission: expect.objectContaining({ userId: 'user-1' }),
        }
      );
      expect(entitlementService.getUserEntitlementServerSide).toHaveBeenCalledWith('user-1');
      expect(usageLimits.createUsageAdmission).toHaveBeenCalledWith(
        'user-1',
        { paidTier: 'free' },
        ['transcription', 'ai'],
        expect.any(Date)
      );
      expect(usageLimits.consumeTranscriptionSeconds).toHaveBeenCalledWith(
        'user-1',
        2,
        expect.any(Date)
      );
    });

    it('returns a typed cap envelope and does not persist a thought fallback', async () => {
      const capError = new UsageCapReachedError(
        'ai',
        110,
        100,
        110,
        '2026-08-01T00:00:00.000Z'
      );
      generateThoughtStructuredMock.mockRejectedValueOnce(capError);

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const response = await POST(createFormRequest(formData));

      expect(response.status).toBe(429);
      await expect(response.json()).resolves.toEqual({
        code: 'USAGE_CAP_REACHED',
        resource: 'ai',
        used: 110,
        baseLimit: 100,
        hardCap: 110,
        resetsAt: '2026-08-01T00:00:00.000Z',
      });
      expect(sermonsRepoMock.sermonsRepository.updateSermonData).not.toHaveBeenCalled();
    });

    it.each([
      {
        message: 'Audio file might be corrupted or unsupported',
        expected: 'Audio file might be corrupted or unsupported. Please try recording again.',
      },
      {
        message: 'Audio file is empty',
        expected: 'Audio recording failed - file is empty. Please try recording again.',
      },
      {
        message: 'Audio file is too small',
        expected: 'Audio recording is too short. Please record for at least 1 second.',
      },
      {
        message: '400 invalid_request_error',
        expected: 'Audio file format not supported. Please try recording again.',
      },
    ])('returns 400 for transcription error: $message', async ({ message, expected }) => {
      createTranscriptionMock.mockRejectedValueOnce(new Error(message));

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: expected });
    });

    it('does NOT retry server-side; a transient error yields a retryable 503 after ONE attempt (client re-posts as a fresh request)', async () => {
      createTranscriptionMock
        .mockRejectedValueOnce(new Error('Connection error. read ECONNRESET'))
        .mockResolvedValueOnce('transcribed after retry');

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      // Retry moved to the client: each retry is a fresh HTTP request with its own
      // 60s Vercel budget, so the server no longer loops inside one invocation.
      // The second mocked value is intentionally never reached.
      expect(response.status).toBe(503);
      expect(data.retryable).toBe(true);
      expect(createTranscriptionMock).toHaveBeenCalledTimes(1);
    });

    it('returns a retryable 503 when transient transcription errors persist', async () => {
      createTranscriptionMock.mockRejectedValue(new Error('Connection error. read ECONNRESET'));

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data).toEqual({
        error: RETRYABLE_ERROR_MESSAGE,
        retryable: true,
        phase: 'transcribe_audio',
      });
    });

    it('returns 500 for unknown transcription errors', async () => {
      createTranscriptionMock.mockRejectedValueOnce(new Error('unexpected error'));

      const formData = new FormData();
      formData.append('audio', new Blob(['audio'], { type: 'audio/webm' }));
      formData.append('sermonId', 'sermon-1');
      const request = createFormRequest(formData);

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to transcribe audio. Please try again.' });
    });
  });

  describe('DELETE', () => {
    it('removes a thought from the sermon', async () => {
      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'to remove' },
      });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ message: 'Thought deleted successfully.' });
      expect(sermonsRepoMock.sermonsRepository.updateSermonData).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when sermonId or thought is missing', async () => {
      const request = createJsonRequest({ sermonId: 'sermon-1' });

      const response = await DELETE(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'sermonId and thought are required' });
    });
  });

  describe('PUT', () => {
    it('returns 400 when sermonId or thought is missing', async () => {
      const request = createJsonRequest({ sermonId: 'sermon-1' });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'sermonId and thought are required' });
    });

    it('returns 400 when thought is missing required fields', async () => {
      fetchSermonByIdMock.mockResolvedValueOnce({
        id: 'sermon-1',
        thoughts: [{ id: 'thought-1', text: 'original' }],
        userId: 'user-1',
      });

      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1' }, // missing text
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Thought is missing required fields' });
    });

    it('returns 400 when thought.id is missing', async () => {
      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { text: 'missing id' },
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Thought id is required' });
    });

    it('returns 404 when sermon is not found', async () => {
      fetchSermonByIdMock.mockResolvedValueOnce(null);

      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'update' },
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'Sermon not found' });
    });

    it('returns 404 when thought is not found in sermon', async () => {
      fetchSermonByIdMock.mockResolvedValueOnce({
        id: 'sermon-1',
        thoughts: [],
        userId: 'user-1',
      });

      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'update' },
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data).toEqual({ error: 'Thought not found in sermon' });
    });

    it('updates a thought in a transaction', async () => {
      const oldThought = {
        id: 'thought-1',
        text: 'old',
        date: '2024-01-01',
        tags: ['Tag1'],
        outlinePointId: 'op-old',
        position: 3,
      };

      fetchSermonByIdMock.mockResolvedValueOnce({
        id: 'sermon-1',
        thoughts: [oldThought],
        userId: 'user-1',
      });

      const sermonDocRef = { id: 'sermon-1', update: jest.fn() };
      docMock.mockReturnValueOnce(sermonDocRef);

      const transactionUpdateMock = jest.fn();
      runTransactionMock.mockImplementationOnce(async (callback: (transaction: any) => Promise<void>) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ thoughts: [oldThought], userId: 'user-1' }),
          }),
          update: transactionUpdateMock,
        };
        await callback(transaction);
      });

      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: {
          id: 'thought-1',
          text: 'new',
          outlinePointId: 'op-new',
        },
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual(
        expect.objectContaining({
          id: 'thought-1',
          text: 'new',
          date: '2024-01-01',
          tags: ['Tag1'],
          outlinePointId: 'op-new',
          position: 3,
        })
      );

      expect(transactionUpdateMock).toHaveBeenCalledWith(sermonDocRef, {
        thoughts: expect.arrayContaining([
          expect.objectContaining({ id: 'thought-1', text: 'new' }),
        ]),
        updatedAt: expect.any(String),
      });
    });

    it('removes deprecated structural tags during thought updates', async () => {
      const oldThought = {
        id: 'thought-1',
        text: 'old',
        date: '2024-01-01',
        tags: ['Основная часть', 'Примеры'],
      };

      fetchSermonByIdMock.mockResolvedValueOnce({
        id: 'sermon-1',
        thoughts: [oldThought],
        userId: 'user-1',
      });

      const sermonDocRef = { id: 'sermon-1', update: jest.fn() };
      docMock.mockReturnValueOnce(sermonDocRef);

      const transactionUpdateMock = jest.fn();
      runTransactionMock.mockImplementationOnce(async (callback: (transaction: any) => Promise<void>) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ thoughts: [oldThought], userId: 'user-1' }),
          }),
          update: transactionUpdateMock,
        };
        await callback(transaction);
      });

      const response = await PUT(createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'new' },
      }));
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.tags).toEqual(['Примеры']);
      expect(transactionUpdateMock).toHaveBeenCalledWith(sermonDocRef, {
        thoughts: [expect.objectContaining({ id: 'thought-1', tags: ['Примеры'] })],
        updatedAt: expect.any(String),
      });
    });

    it('returns 500 when transaction fails', async () => {
      const oldThought = {
        id: 'thought-1',
        text: 'old',
        date: '2024-01-01',
        tags: ['Tag1'],
      };

      fetchSermonByIdMock.mockResolvedValueOnce({
        id: 'sermon-1',
        thoughts: [oldThought],
        userId: 'user-1',
      });

      runTransactionMock.mockRejectedValueOnce(new Error('transaction failed'));

      const request = createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'new' },
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to update thought.' });
    });
  });

  describe('ownership enforcement across mutation methods', () => {
    beforeEach(() => {
      fetchSermonByIdMock.mockResolvedValue({
        id: 'sermon-1',
        userId: 'victim-user',
        thoughts: [{ id: 'thought-1', text: 'old', date: '2024-01-01', tags: [] }],
      });
    });

    it.each([
      ['manual POST', () => POST(createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'new', date: '2024-01-01', tags: [] },
      }, 'http://localhost/api/thoughts?manual=true'))],
      ['DELETE', () => DELETE(createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'old' },
      }))],
      ['PUT', () => PUT(createJsonRequest({
        sermonId: 'sermon-1',
        thought: { id: 'thought-1', text: 'new' },
      }))],
    ])('returns 403 for a non-owner on %s', async (_label, invoke) => {
      const response = await invoke();

      expect(response.status).toBe(403);
      expect(sermonsRepoMock.sermonsRepository.updateSermonData).not.toHaveBeenCalled();
      expect(runTransactionMock).not.toHaveBeenCalled();
    });
  });
});
