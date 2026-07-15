import {
  getTranscriptionAuthorizationHeaders,
  transcribeAudioWithRetry,
  TranscriptionClientError,
} from '@/utils/transcriptionRetryClient';
import { UsageCapReachedError } from '@/services/usageLimits';

jest.mock('@/utils/apiClient', () => ({ apiClient: jest.fn() }));
jest.mock('@/services/firebaseAuth.service', () => ({
  auth: { currentUser: null },
}));

const { apiClient: mockApiClient } = jest.requireMock('@/utils/apiClient') as {
  apiClient: jest.Mock;
};
const { auth: mockAuth } = jest.requireMock('@/services/firebaseAuth.service') as {
  auth: { currentUser: { getIdToken: jest.Mock } | null };
};
const mockGetIdToken = jest.fn();

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response;
}

// A raw 5xx (e.g. Vercel FUNCTION_INVOCATION_TIMEOUT) returns HTML/empty — json() throws.
function bodylessResponse(status: number): Response {
  return {
    ok: false,
    status,
    statusText: `HTTP ${status}`,
    json: async () => { throw new Error('Unexpected token < in JSON'); },
  } as unknown as Response;
}

const blob = new Blob(['audio'], { type: 'audio/webm' });

describe('transcribeAudioWithRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.currentUser = null;
  });

  it('attaches the current Firebase token on the production transport path', async () => {
    mockAuth.currentUser = { getIdToken: mockGetIdToken };
    mockGetIdToken.mockResolvedValue('firebase-token');
    mockApiClient.mockResolvedValue(
      jsonResponse(200, { success: true, polishedText: 'clean', originalText: 'raw' })
    );

    await transcribeAudioWithRetry(blob, { endpoint: '/api/thoughts/transcribe' });

    expect(mockApiClient).toHaveBeenCalledWith('/api/thoughts/transcribe', expect.objectContaining({
      headers: { Authorization: 'Bearer firebase-token' },
    }));
  });

  it('fails closed before transport when signed out or token retrieval fails', async () => {
    await expect(getTranscriptionAuthorizationHeaders())
      .rejects.toThrow('Authentication required for transcription');
    expect(mockApiClient).not.toHaveBeenCalled();

    mockAuth.currentUser = { getIdToken: mockGetIdToken };
    mockGetIdToken.mockRejectedValue(new Error('token unavailable'));
    await expect(transcribeAudioWithRetry(blob, { endpoint: '/api/thoughts/transcribe' }))
      .rejects.toThrow('token unavailable');
    expect(mockApiClient).not.toHaveBeenCalled();
  });

  it('returns transcription on first success', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, { success: true, polishedText: 'clean', originalText: 'raw' })
    );

    const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl });

    expect(result).toEqual({ polishedText: 'clean', originalText: 'raw', warning: undefined });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a retryable (network) failure with a fresh request, then succeeds', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(503, { success: false, error: 'conn', kind: 'network', retryable: true, phase: 'transcribe_audio' }))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, polishedText: 'clean', originalText: 'raw' }));

    const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, baseDelayMs: 0 });

    expect(result.polishedText).toBe('clean');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a billing failure and surfaces the billing kind', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(429, { success: false, error: 'out of credit', kind: 'billing', retryable: false })
    );

    await expect(
      transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 3 })
    ).rejects.toMatchObject({ kinds: ['billing'] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('collects every attempt error and flags possible billing on repeated network resets', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(503, { success: false, error: 'ECONNRESET', kind: 'network', retryable: true, phase: 'transcribe_audio' })
    );

    let thrown: TranscriptionClientError | null = null;
    try {
      await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 2, baseDelayMs: 0 });
    } catch (e) {
      thrown = e as TranscriptionClientError;
    }

    expect(thrown).toBeInstanceOf(TranscriptionClientError);
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(thrown!.attempts).toHaveLength(3);
    expect(thrown!.kinds).toEqual(['network']);
    expect(thrown!.suggestsBilling).toBe(true);
  });

  it('orders distinct kinds by severity and preserves recognized text', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(jsonResponse(503, { success: false, error: 'net', kind: 'network', retryable: true }))
      .mockResolvedValueOnce(jsonResponse(429, { success: false, error: 'no credit', kind: 'billing', retryable: false, originalText: 'my thought' }));

    let thrown: TranscriptionClientError | null = null;
    try {
      await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 3, baseDelayMs: 0 });
    } catch (e) {
      thrown = e as TranscriptionClientError;
    }

    // billing outranks network in severity ordering; stops retrying at billing.
    expect(thrown!.kinds).toEqual(['billing', 'network']);
    expect(thrown!.originalText).toBe('my thought');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown transport error (apiClient reject) as a network attempt', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    await expect(
      transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 1, baseDelayMs: 0 })
    ).rejects.toMatchObject({ kinds: ['network'] });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rethrows a typed usage cap without retrying or degrading it to a network error', async () => {
    const capError = new UsageCapReachedError(
      'transcription',
      3960,
      3600,
      3960,
      '2026-08-01T00:00:00.000Z'
    );
    const fetchImpl = jest.fn().mockRejectedValue(capError);

    await expect(transcribeAudioWithRetry(blob, {
      endpoint: '/api/studies/transcribe',
      fetchImpl,
      maxRetries: 3,
      baseDelayMs: 0,
    })).rejects.toBe(capError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries a bodyless 504 (Vercel timeout) by falling back to HTTP status', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce(bodylessResponse(504))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, polishedText: 'clean', originalText: 'raw' }));

    const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, baseDelayMs: 0 });

    expect(result.polishedText).toBe('clean');
    expect(fetchImpl).toHaveBeenCalledTimes(2); // 504 was retried, not dropped as unknown
  });

  it('does NOT retry a bodyless 400 (client error) via status fallback', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(bodylessResponse(400));

    await expect(
      transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 3, baseDelayMs: 0 })
    ).rejects.toMatchObject({ kinds: ['bad_request'] });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('treats an empty (silence) 200-success as invalid_audio so the recording is kept', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, { success: true, polishedText: '', originalText: '' })
    );

    await expect(
      transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl, maxRetries: 3, baseDelayMs: 0 })
    ).rejects.toMatchObject({ kinds: ['invalid_audio'] });

    expect(fetchImpl).toHaveBeenCalledTimes(1); // empty = silence, not retried
  });

  it('still returns a whitespace-trimmed non-empty success normally', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      jsonResponse(200, { success: true, polishedText: 'real text', originalText: 'raw' })
    );

    const result = await transcribeAudioWithRetry(blob, { endpoint: '/api/studies/transcribe', fetchImpl });
    expect(result.polishedText).toBe('real text');
  });
});
