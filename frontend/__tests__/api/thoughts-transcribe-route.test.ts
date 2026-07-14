// Tests for /api/thoughts/transcribe route
import * as thoughtsTranscribeRoute from 'app/api/thoughts/transcribe/route';

import { createTranscription } from '@clients/openAI.client';
import { polishTranscription } from '@clients/polishTranscription.structured';
import { validateAudioDuration } from '@/utils/server/audioServerUtils';

const mockVerifyIdToken = jest.fn();
const mockGetUserEntitlementServerSide = jest.fn();
const mockAssertTranscriptionUsageAvailable = jest.fn();
const mockConsumeTranscriptionSeconds = jest.fn();

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

jest.mock('@/config/firebaseAdminConfig', () => ({
  adminAuth: { verifyIdToken: mockVerifyIdToken },
}));

jest.mock('@/services/userEntitlement.server', () => ({
  getUserEntitlementServerSide: mockGetUserEntitlementServerSide,
}));

jest.mock('@/services/usageLimits.server', () => ({
  assertTranscriptionUsageAvailable: mockAssertTranscriptionUsageAvailable,
  consumeTranscriptionSeconds: mockConsumeTranscriptionSeconds,
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
  headers: Headers;
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
    (validateAudioDuration as jest.Mock).mockResolvedValue({
      valid: true,
      duration: 10.2,
      maxAllowed: 97,
    });
    mockVerifyIdToken.mockResolvedValue({ uid: 'user-1' });
    mockGetUserEntitlementServerSide.mockResolvedValue({ paidTier: 'free' });
    mockConsumeTranscriptionSeconds.mockResolvedValue(undefined);
  });

  const buildRequest = (
    audio: unknown,
    authorization: string | null = 'Bearer valid-token'
  ): MockRequest => ({
    formData: async () => ({
      get: (key: string) => (key === 'audio' ? audio : null),
    }),
    headers: new Headers(authorization ? { authorization } : undefined),
  });

  it('returns 401 without a bearer token and never reaches a provider', async () => {
    const request = buildRequest(new FakeBlob([new Uint8Array(1024)]), null);
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);

    expect(response.status).toBe(401);
    expect(createTranscription).not.toHaveBeenCalled();
    expect(polishTranscription).not.toHaveBeenCalled();
    expect(mockAssertTranscriptionUsageAvailable).not.toHaveBeenCalled();
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
    expect(createTranscription).toHaveBeenCalledWith(expect.any(FakeBlob), 'user-1');
    expect(polishTranscription).toHaveBeenCalledWith('Raw transcription', 'user-1');
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledWith('user-1');
    expect(mockConsumeTranscriptionSeconds).toHaveBeenCalledWith(
      'user-1',
      11,
      expect.any(Date)
    );
  });

  it('checks and consumes rounded transcription seconds for a verified caller', async () => {
    (createTranscription as jest.Mock).mockResolvedValue('Raw transcription');
    (polishTranscription as jest.Mock).mockResolvedValue({
      success: true,
      polishedText: 'Polished transcription',
      originalText: 'Raw transcription',
      error: null,
    });

    const request = buildRequest(
      new FakeBlob([new Uint8Array(1024)]),
      'Bearer valid-token'
    );
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);

    expect(response.status).toBe(200);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('valid-token');
    expect(mockGetUserEntitlementServerSide).toHaveBeenCalledWith('user-1');
    expect(mockAssertTranscriptionUsageAvailable).toHaveBeenCalledWith(
      { paidTier: 'free' },
      11,
      expect.any(Date)
    );
    expect(mockConsumeTranscriptionSeconds).toHaveBeenCalledWith(
      'user-1',
      11,
      expect.any(Date)
    );
  });

  it('returns 429 before transcription when the verified caller is exhausted', async () => {
    const exhausted = Object.assign(new Error('Transcription usage limit exhausted'), {
      code: 'USAGE_EXHAUSTED',
    });
    mockAssertTranscriptionUsageAvailable.mockImplementationOnce(() => {
      throw exhausted;
    });

    const request = buildRequest(
      new FakeBlob([new Uint8Array(1024)]),
      'Bearer valid-token'
    );
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(429);
    expect(data.error).toBe('Transcription usage limit exhausted');
    expect(createTranscription).not.toHaveBeenCalled();
    expect(mockConsumeTranscriptionSeconds).not.toHaveBeenCalled();
  });

  it('returns 401 for a provided but invalid bearer token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('invalid token'));

    const request = buildRequest(
      new FakeBlob([new Uint8Array(1024)]),
      'Bearer invalid-token'
    );
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);

    expect(response.status).toBe(401);
    expect(createTranscription).not.toHaveBeenCalled();
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

  it('returns retryable 503 when transient transcription errors persist', async () => {
    (createTranscription as jest.Mock).mockRejectedValue(
      new Error('Connection error. read ECONNRESET')
    );

    const request = buildRequest(new FakeBlob([new Uint8Array(1024)]));
    const response = await thoughtsTranscribeRoute.POST(request as unknown as Request);
    const data = await response.json();

    expect(response.status).toBe(503);
    expect(data.error).toBe(RETRYABLE_ERROR_MESSAGE);
    expect(data.retryable).toBe(true);
    expect(data.phase).toBe('transcribe_audio');
    expect(data.kind).toBe('network');
    // One attempt per invocation now — the CLIENT retries with fresh requests.
    expect(createTranscription).toHaveBeenCalledTimes(1);
  });
});
