// Mock dependencies - imports are used in jest.mock() setup below
// Import the mocked module to access the spies

// Mock dependencies
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

// Mock next/server (NextResponse)
jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

// Mock Firebase Admin - Use a factory that returns new mocks
// We define the mock implementation inside the factory to avoid hoisting issues
jest.mock('@/config/firebaseAdminConfig', () => {
  const updateFn = jest.fn();
  const docFn = jest.fn(() => ({ update: updateFn }));
  const collectionFn = jest.fn(() => ({ doc: docFn }));
  return {
    adminDb: {
      collection: collectionFn,
      runTransaction: jest.fn(),
    }
  };
});

// Also mock the alias path if used
jest.mock('@/config/firebaseAdminConfig', () => {
  const updateFn = jest.fn();
  const docFn = jest.fn(() => ({ update: updateFn }));
  const collectionFn = jest.fn(() => ({ doc: docFn }));
  return {
    adminDb: {
      collection: collectionFn,
      runTransaction: jest.fn(),
    }
  };
});

// Mock UUID
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Helper to create a mock request
function createMockRequest(formData: FormData, authenticated = true) {
  return {
    formData: () => Promise.resolve(formData),
    url: 'http://localhost/api/thoughts',
    headers: new Headers(authenticated ? { authorization: 'Bearer valid-token' } : undefined),
    json: () => Promise.resolve({}), // Default mock
  } as unknown as Request;
}

describe('Thoughts API POST', () => {
  const mockAudioBlob = new Blob(['mock audio content'], { type: 'audio/webm' });
  const mockSermonId = 'sermon-123';
  const mockTranscription = 'This is a test transcription';

  let POST: any;
  let generateThoughtStructuredMock: jest.Mock;
  let sermonsRepoMock: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.USE_STRUCTURED_OUTPUT = 'true'; // Enable structured output for these tests
    jest.resetModules(); // Reset cache to re-evaluate module with new env var

    // Re-require route
    const routeModule = await import('@/api/thoughts/route');
    POST = routeModule.POST;

    // Re-require dependencies to configure the active mocks
    const firestoreClient = await import('@clients/firestore.client');
    const openAIClient = await import('@clients/openAI.client');
    const sermonsRepo = await import('@repositories/sermons.repository');
    const thoughtStructured = await import('@clients/thought.structured');

    generateThoughtStructuredMock = thoughtStructured.generateThoughtStructured as jest.Mock;
    sermonsRepoMock = sermonsRepo;

    // Configure these new mock instances
    (firestoreClient.getCustomTags as jest.Mock).mockResolvedValue([]);
    (sermonsRepo.sermonsRepository.fetchSermonById as jest.Mock).mockResolvedValue({ userId: 'user-1', thoughts: [] });
    (openAIClient.createTranscription as jest.Mock).mockResolvedValue(mockTranscription);
  });

  it('returns 401 without a bearer token and never reaches transcription', async () => {
    const formData = new FormData();
    formData.append('audio', mockAudioBlob);
    formData.append('sermonId', mockSermonId);
    const openAIClient = await import('@clients/openAI.client');

    const response = await POST(createMockRequest(formData, false));

    expect(response.status).toBe(401);
    expect(openAIClient.createTranscription).not.toHaveBeenCalled();
    expect(generateThoughtStructuredMock).not.toHaveBeenCalled();
  });

  it('returns 403 before transcription when the sermon belongs to another user', async () => {
    const formData = new FormData();
    formData.append('audio', mockAudioBlob);
    formData.append('sermonId', mockSermonId);
    const openAIClient = await import('@clients/openAI.client');
    sermonsRepoMock.sermonsRepository.fetchSermonById.mockResolvedValueOnce({
      userId: 'victim-user',
      thoughts: [],
    });

    const response = await POST(createMockRequest(formData));

    expect(response.status).toBe(403);
    expect(openAIClient.createTranscription).not.toHaveBeenCalled();
    expect(generateThoughtStructuredMock).not.toHaveBeenCalled();
  });

  it('should fall back to raw transcription when valid structure generation fails', async () => {
    // Mock generation failure (meaning not preserved)
    generateThoughtStructuredMock.mockResolvedValue({
      meaningSuccessfullyPreserved: false,
      originalText: mockTranscription,
      formattedText: null,
      tags: null
    });

    const formData = new FormData();
    formData.append('audio', mockAudioBlob);
    formData.append('sermonId', mockSermonId);

    const request = createMockRequest(formData);

    const spyConsoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    const spyConsoleLog = jest.spyOn(console, 'log').mockImplementation();
    const spyConsoleError = jest.spyOn(console, 'error').mockImplementation();

    const response = await POST(request);
    const data = await response.json();

    // Check that console.warn was called
    expect(spyConsoleWarn).toHaveBeenCalledWith(
      expect.stringContaining("Falling back to raw transcription"),
      expect.anything()
    );

    // Verify response status is 200 (Success) instead of 500
    expect(response.status).toBe(200);

    // Verify that the fallback data was used
    expect(data).toEqual(expect.objectContaining({
      text: mockTranscription, // Raw transcription used as text
      tags: [],                // Empty tags
      id: 'mock-uuid',
    }));

    // Verify it was saved using sermonsRepository.updateSermonData
    expect(sermonsRepoMock.sermonsRepository.updateSermonData).toHaveBeenCalledWith(
      mockSermonId,
      expect.objectContaining({
        thoughts: expect.objectContaining({
          elements: expect.arrayContaining([
            expect.objectContaining({
              text: mockTranscription,
              tags: []
            })
          ])
        })
      })
    );

    spyConsoleWarn.mockRestore();
    spyConsoleLog.mockRestore();
    spyConsoleError.mockRestore();
  });

  it('should return successful structured thought when generation succeeds', async () => {
    // Mock generation success
    generateThoughtStructuredMock.mockResolvedValue({
      meaningSuccessfullyPreserved: true,
      originalText: mockTranscription,
      formattedText: "Formatted text",
      tags: ["Примеры"]
    });

    const formData = new FormData();
    formData.append('audio', mockAudioBlob);
    formData.append('sermonId', mockSermonId);

    const request = createMockRequest(formData);

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual(expect.objectContaining({
      text: "Formatted text",
      tags: ["Примеры"]
    }));
  });
});
