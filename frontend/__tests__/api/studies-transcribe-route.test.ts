import * as studiesTranscribeRoute from 'app/api/studies/transcribe/route';

import { createTranscription } from '@clients/openAI.client';
import { polishTranscription } from '@clients/polishTranscription.structured';
import { validateAudioDuration } from '@/utils/server/audioServerUtils';

const RETRYABLE_ERROR_MESSAGE = 'Temporary transcription connection issue. The recording looked valid, but the transcription service connection failed. Please try again.';

jest.mock('@clients/openAI.client', () => ({
  createTranscription: jest.fn(),
}));

jest.mock('@clients/polishTranscription.structured', () => ({
  polishTranscription: jest.fn(),
}));

jest.mock('@/utils/server/audioServerUtils', () => ({
  validateAudioDuration: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => ({
      status: options.status || 200,
      json: async () => data,
    })),
  },
}));

describe('Studies transcribe route', () => {
  const buildRequest = (audio: unknown): Request => ({
    formData: async () => ({
      get: (key: string) => (key === 'audio' ? audio : null),
    }),
  } as unknown as Request);

  beforeEach(() => {
    jest.clearAllMocks();
    (validateAudioDuration as jest.Mock).mockResolvedValue({
      valid: true,
      duration: 2,
      maxAllowed: 97,
    });
  });

  it('returns polished study transcription when transcription and polish succeed', async () => {
    (createTranscription as jest.Mock).mockResolvedValue('Raw study note');
    (polishTranscription as jest.Mock).mockResolvedValue({
      success: true,
      polishedText: 'Polished study note',
      originalText: 'Raw study note',
      error: null,
    });

    const response = await studiesTranscribeRoute.POST(buildRequest(new Blob(['audio'], { type: 'audio/webm' })));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.polishedText).toBe('Polished study note');
    expect(data.originalText).toBe('Raw study note');
  });

  it('returns retryable 503 when transient transcription errors persist', async () => {
    (createTranscription as jest.Mock).mockRejectedValue(new Error('Connection error. read ECONNRESET'));

    const response = await studiesTranscribeRoute.POST(buildRequest(new Blob(['audio'], { type: 'audio/webm' })));
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data).toEqual({
      success: false,
      error: RETRYABLE_ERROR_MESSAGE,
      retryable: true,
      phase: 'transcribe_audio',
    });
    expect(createTranscription).toHaveBeenCalledTimes(2);
  });
});
