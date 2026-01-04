// Additional tests for /api/thoughts route to improve coverage

const updateMock = jest.fn();
const docMock = jest.fn(() => ({ update: updateMock }));
const collectionMock = jest.fn(() => ({ doc: docMock }));
const runTransactionMock = jest.fn();

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
  getRequiredTags: jest.fn(),
}));

jest.mock('@repositories/sermons.repository', () => ({
  sermonsRepository: {
    fetchSermonById: jest.fn(),
  },
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
  } as unknown as Request;
}

function createJsonRequest(body: unknown, url = 'http://localhost/api/thoughts') {
  return {
    json: async () => body,
    url,
  } as unknown as Request;
}

describe('Thoughts API route additional coverage', () => {
  let POST: (request: Request) => Promise<Response>;
  let DELETE: (request: Request) => Promise<Response>;
  let PUT: (request: Request) => Promise<Response>;

  let createTranscriptionMock: jest.Mock;
  let generateThoughtStructuredMock: jest.Mock;
  let getRequiredTagsMock: jest.Mock;
  let getCustomTagsMock: jest.Mock;
  let fetchSermonByIdMock: jest.Mock;

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

    createTranscriptionMock = openAIClient.createTranscription as jest.Mock;
    generateThoughtStructuredMock = thoughtStructured.generateThoughtStructured as jest.Mock;
    getRequiredTagsMock = firestoreClient.getRequiredTags as jest.Mock;
    getCustomTagsMock = firestoreClient.getCustomTags as jest.Mock;
    fetchSermonByIdMock = sermonsRepo.sermonsRepository.fetchSermonById as jest.Mock;

    getRequiredTagsMock.mockResolvedValue([]);
    getCustomTagsMock.mockResolvedValue([]);
    fetchSermonByIdMock.mockResolvedValue({ userId: 'user-1', thoughts: [] });
    createTranscriptionMock.mockResolvedValue('transcribed');
    generateThoughtStructuredMock.mockResolvedValue({
      meaningSuccessfullyPreserved: true,
      originalText: 'transcribed',
      formattedText: 'formatted',
      tags: ['Intro'],
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
          position: 2,
        })
      );
      expect(updateMock).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when sermonId or thought is missing', async () => {
      const request = createJsonRequest({ thought: null }, 'http://localhost/api/thoughts?manual=true');

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'sermonId and thought are required' });
    });

    it('returns 500 when thought is missing required fields', async () => {
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

      expect(response.status).toBe(500);
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
      expect(updateMock).toHaveBeenCalledTimes(1);
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

      const sermonDocRef = { id: 'sermon-1' };
      docMock.mockReturnValueOnce(sermonDocRef);

      const transactionUpdateMock = jest.fn();
      runTransactionMock.mockImplementationOnce(async (callback: (transaction: any) => Promise<void>) => {
        const transaction = {
          get: jest.fn().mockResolvedValue({
            exists: true,
            data: () => ({ thoughts: [oldThought] }),
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
});
