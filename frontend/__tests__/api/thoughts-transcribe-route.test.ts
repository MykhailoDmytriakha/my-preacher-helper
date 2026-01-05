// Tests for /api/thoughts/transcribe route
import * as thoughtsTranscribeRoute from 'app/api/thoughts/transcribe/route';

import { createTranscription } from '@clients/openAI.client';
import { polishTranscription } from '@clients/polishTranscription.structured';

jest.mock('@clients/openAI.client', () => ({
  createTranscription: jest.fn(),
}));

jest.mock('@clients/polishTranscription.structured', () => ({
  polishTranscription: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn().mockImplementation((data, options = {}) => {
      return {
        status: options.status || 200,
        json: async () => data,
      };
    }),
  },
}));

interface MockFormData {
  get: (key: string) => unknown;
}

interface MockRequest {
  formData: () => Promise<MockFormData>;
}

class FakeBlob {
  public size: number;
  public type: string;
  constructor(blobParts: BlobPart[] = [], options: BlobPropertyBag = {}) {
    this.size = blobParts.reduce((total, part) => {
      if (typeof part === 'string') {
        return total + part.length;
      }
      if (part instanceof ArrayBuffer) {
        return total + part.byteLength;
      }
      if (ArrayBuffer.isView(part)) {
        return total + part.byteLength;
      }
      if (part && typeof (part as Blob).size === 'number') {
        return total + (part as Blob).size;
      }
      return total;
    }, 0);
    this.type = options.type ?? 'audio/webm';
  }
}

describe('Thoughts transcribe route', () => {
  beforeAll(() => {
    (global as unknown as { Blob?: typeof FakeBlob }).Blob = FakeBlob as unknown as typeof Blob;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const buildRequest = (audio: unknown): MockRequest => ({
    formData: async () => ({
      get: (key: string) => (key === 'audio' ? audio : null),
    }),
  });

  it('returns 400 when audio is not a Blob', async () => {
    const request = buildRequest({} as unknown);
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Invalid audio format');
  });

  it('returns 400 when audio is empty', async () => {
    const request = buildRequest(new FakeBlob([]));
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Audio file is empty');
  });

  it('returns polished text when polish succeeds', async () => {
    (createTranscription as jest.Mock).mockResolvedValue('Raw transcription');
    (polishTranscription as jest.Mock).mockResolvedValue({
      success: true,
      polishedText: 'Polished transcription',
      originalText: 'Raw transcription',
      error: null,
    });

    const request = buildRequest(new FakeBlob([new Uint8Array(1024)]));
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.polishedText).toBe('Polished transcription');
    expect(data.originalText).toBe('Raw transcription');
    expect(polishTranscription).toHaveBeenCalledWith('Raw transcription');
  });

  it('falls back to original text when polish fails', async () => {
    (createTranscription as jest.Mock).mockResolvedValue('Raw transcription');
    (polishTranscription as jest.Mock).mockResolvedValue({
      success: false,
      polishedText: null,
      originalText: 'Raw transcription',
      error: 'Could not preserve meaning while cleaning',
    });

    const request = buildRequest(new FakeBlob([new Uint8Array(1024)]));
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.polishedText).toBe('Raw transcription');
    expect(data.originalText).toBe('Raw transcription');
    expect(data.warning).toBe('Could not polish transcription, returning original');
  });

  it('returns 400 when transcription is too short', async () => {
    (createTranscription as jest.Mock).mockRejectedValue(
      new Error('audio file is too small')
    );

    const request = buildRequest(new FakeBlob([new Uint8Array(1024)]));
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('Audio recording is too short. Please record for at least 1 second.');
  });
});
