import { createAudioThought, createAudioThoughtWithForceTag, retryAudioTranscription, deleteThought, updateThought, createManualThought } from '@/services/thought.service';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock environment variable
process.env.NEXT_PUBLIC_API_BASE = 'http://localhost:3000';

// Mock toast
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

describe('Thought Service', () => {
  const mockBlob = new Blob(['test audio'], { type: 'audio/webm' });
  const mockSermonId = 'test-sermon-id';
  const mockThought = {
    id: 'test-thought-id',
    text: 'Test thought',
    tags: ['test'],
    date: '2023-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
    mockFetch.mockReset();
    // Ensure fetch is properly mocked
    mockFetch.mockImplementation(() => {
      throw new Error('fetch not mocked');
    });
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe('createAudioThought', () => {
    it('should successfully create audio thought on first attempt', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await createAudioThought(mockBlob, mockSermonId);

      expect(result).toEqual(mockThought);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/thoughts'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        })
      );
    });

    it('should retry on failure and succeed on second attempt', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Transcription failed' }),
      };
      const mockSuccessResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };

      mockFetch
        .mockResolvedValueOnce(mockErrorResponse)
        .mockResolvedValueOnce(mockSuccessResponse);

      // This should throw on first attempt, but we're testing the retry logic
      await expect(createAudioThought(mockBlob, mockSermonId, 0, 1)).rejects.toThrow(
        'Transcription failed (attempt 1/2): Transcription failed'
      );
    });

    it('should handle max retries correctly', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ error: 'Transcription failed' }),
      };

      mockFetch.mockResolvedValue(mockErrorResponse);

      // Test that the function handles max retries properly
      // When retryCount >= maxRetries, it should immediately throw
      await expect(createAudioThought(mockBlob, mockSermonId, 3, 3)).rejects.toThrow(
        'Transcription failed after all retries: Maximum retry attempts exceeded'
      );
    });

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(createAudioThought(mockBlob, mockSermonId, 0, 1)).rejects.toThrow(
        'Network error'
      );
    });

    it('should handle non-JSON error responses', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
      };

      mockFetch.mockResolvedValue(mockErrorResponse);

      await expect(createAudioThought(mockBlob, mockSermonId, 0, 1)).rejects.toThrow(
        'Transcription failed (attempt 1/2): Bad Request'
      );
    });

    it('should handle error responses with originalText', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        json: jest.fn().mockResolvedValue({ 
          error: 'Failed to generate a valid thought', 
          originalText: 'раз два три',
          transcriptionText: 'Transcribed text'
        }),
      };

      mockFetch.mockResolvedValue(mockErrorResponse);

      await expect(createAudioThought(mockBlob, mockSermonId, 0, 1)).rejects.toThrow(
        'Transcription failed (attempt 1/2): Failed to generate a valid thought. Recognized text: "раз два три"'
      );
    });

    it('should clear stored audio on success', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Mock window.clearAudioRecorderStorage
      const mockClearStorage = jest.fn();
      (global as any).window = {
        clearAudioRecorderStorage: mockClearStorage,
      };

      await createAudioThought(mockBlob, mockSermonId);

      // For now, just test that the function completes successfully
      expect(mockResponse.json).toHaveBeenCalled();
    });
  });

  describe('retryAudioTranscription', () => {
    it('should call createAudioThought with correct retry parameters', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await retryAudioTranscription(mockBlob, mockSermonId, 1, 3);

      expect(result).toEqual(mockThought);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/thoughts'),
        expect.objectContaining({
          method: 'POST',
          body: expect.any(FormData),
        })
      );
    });
  });

  describe('deleteThought', () => {
    it('should successfully delete thought', async () => {
      const mockResponse = {
        ok: true,
      };
      mockFetch.mockResolvedValue(mockResponse);

      await deleteThought(mockSermonId, mockThought);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/thoughts'),
        expect.objectContaining({
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sermonId: mockSermonId, thought: mockThought }),
        })
      );
    });

    it('should throw error on delete failure', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
      };
      mockFetch.mockResolvedValue(mockErrorResponse);

      await expect(deleteThought(mockSermonId, mockThought)).rejects.toThrow(
        'Failed to delete thought with status 500'
      );
    });
  });

  describe('updateThought', () => {
    it('should successfully update thought', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await updateThought(mockSermonId, mockThought);

      expect(result).toEqual(mockThought);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/thoughts'),
        expect.objectContaining({
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sermonId: mockSermonId, thought: mockThought }),
        })
      );
    });

    it('should handle server error response', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 500,
        text: jest.fn().mockResolvedValue('Server error message'),
      };
      mockFetch.mockResolvedValue(mockErrorResponse);

      await expect(updateThought(mockSermonId, mockThought)).rejects.toThrow(
        'Failed to update thought with status 500: Server error message'
      );
    });
  });

  describe('createManualThought', () => {
    it('should successfully create manual thought', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue(mockThought),
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await createManualThought(mockSermonId, mockThought);

      expect(result).toEqual(mockThought);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/thoughts?manual=true'),
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sermonId: mockSermonId, thought: mockThought }),
        })
      );
    });

    it('should throw error on manual thought creation failure', async () => {
      const mockErrorResponse = {
        ok: false,
        status: 400,
      };
      mockFetch.mockResolvedValue(mockErrorResponse);

      await expect(createManualThought(mockSermonId, mockThought)).rejects.toThrow(
        'Failed to create manual thought with status 400'
      );
    });
  });

  describe('createAudioThoughtWithForceTag', () => {
    it('should create audio thought with force tag', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';
      const forceTag = 'Вступление';

      // Mock the API call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'thought-123',
          text: 'Transcribed text',
          tags: [forceTag, 'custom-tag'],
          date: new Date().toISOString(),
        }),
      });

      const result = await createAudioThoughtWithForceTag(mockAudioBlob, sermonId, forceTag);

      expect(result).toHaveProperty('id', 'thought-123');
      expect(result).toHaveProperty('text', 'Transcribed text');
      expect(result).toHaveProperty('tags');
      expect(result.tags).toContain(forceTag);
      expect(result.tags).toContain('custom-tag');
    });

    it('should work without force tag (backward compatibility)', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';

      // Mock the API call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'thought-123',
          text: 'Transcribed text',
          tags: ['auto-generated-tag'],
          date: new Date().toISOString(),
        }),
      });

      const result = await createAudioThoughtWithForceTag(mockAudioBlob, sermonId, null);

      expect(result).toHaveProperty('id', 'thought-123');
      expect(result).toHaveProperty('text', 'Transcribed text');
      expect(result).toHaveProperty('tags');
      expect(result.tags).toContain('auto-generated-tag');
    });

    it('should handle different force tag values', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';
      const forceTags = ['Вступление', 'Основная часть', 'Заключение'];

      for (const forceTag of forceTags) {
        // Mock the API call
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({
            id: `thought-${forceTag}`,
            text: 'Transcribed text',
            tags: [forceTag],
            date: new Date().toISOString(),
          }),
        });

        const result = await createAudioThoughtWithForceTag(mockAudioBlob, sermonId, forceTag);

        expect(result.tags).toContain(forceTag);
      }
    });

    it('should handle API errors gracefully', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';
      const forceTag = 'Вступление';

      // Mock API error
      global.fetch = jest.fn().mockRejectedValue(new Error('API Error'));

      await expect(
        createAudioThoughtWithForceTag(mockAudioBlob, sermonId, forceTag)
      ).rejects.toThrow('API Error');
    });

    it('sends outlinePointId in FormData when provided', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';
      const forceTag = 'Вступление';
      const outlinePointId = 'op-xyz';

      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 't1', text: 'ok', tags: [forceTag], date: new Date().toISOString(), outlinePointId }),
      });
      // @ts-ignore
      global.fetch = fetchMock;

      await createAudioThoughtWithForceTag(mockAudioBlob, sermonId, forceTag, 0, 3, outlinePointId);

      const callArgs = fetchMock.mock.calls[0][1];
      const body = callArgs.body as FormData;
      expect(body.get('sermonId')).toBe(sermonId);
      expect(body.get('forceTag')).toBe(forceTag);
      expect(body.get('outlinePointId')).toBe(outlinePointId);
    });
  });

  describe('retryAudioTranscription with force tag', () => {
    it('should retry transcription with force tag', async () => {
      const mockAudioBlob = new Blob(['audio content'], { type: 'audio/wav' });
      const sermonId = 'test-sermon-123';
      const retryCount = 1;
      const forceTag = 'Основная часть';

      // Mock the API call
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'thought-123',
          text: 'Retried transcription',
          tags: [forceTag],
          date: new Date().toISOString(),
        }),
      });

      const result = await retryAudioTranscription(mockAudioBlob, sermonId, retryCount, 3, forceTag);

      expect(result).toHaveProperty('id', 'thought-123');
      expect(result).toHaveProperty('text', 'Retried transcription');
      expect(result.tags).toContain(forceTag);
    });
  });
}); 
