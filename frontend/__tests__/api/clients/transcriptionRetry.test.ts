import {
  BILLING_TRANSCRIPTION_ERROR,
  classifyTranscriptionError,
  createTranscriptionWithRetry,
  isRetryableTranscriptionError,
  mapTranscriptionError,
  RETRYABLE_TRANSCRIPTION_ERROR,
} from '@clients/transcriptionRetry';

describe('transcriptionRetry client helpers', () => {
  it('retries transient transcription errors and returns the successful result', async () => {
    const transcribe = jest.fn()
      .mockRejectedValueOnce(new Error('Connection error. read ECONNRESET'))
      .mockResolvedValueOnce('recognized text');
    const onRetry = jest.fn();

    const result = await createTranscriptionWithRetry(new Blob(['audio']), {
      baseDelayMs: 0,
      maxAttempts: 2,
      transcribe,
      onRetry,
    });

    expect(result).toBe('recognized text');
    expect(transcribe).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      nextAttempt: 2,
      maxAttempts: 2,
      delayMs: 0,
    }));
  });

  it('defaults to a single attempt per invocation (retry moved to the client)', async () => {
    const transcribe = jest.fn()
      .mockRejectedValueOnce(new Error('Connection error. read ECONNRESET'))
      .mockResolvedValueOnce('recognized text');

    await expect(createTranscriptionWithRetry(new Blob(['audio']), {
      baseDelayMs: 0,
      transcribe,
    })).rejects.toThrow('ECONNRESET');

    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('does not retry deterministic invalid-audio errors', async () => {
    const transcribe = jest.fn()
      .mockRejectedValueOnce(new Error('Audio file is too small'));

    await expect(createTranscriptionWithRetry(new Blob(['x']), {
      baseDelayMs: 0,
      maxAttempts: 3,
      transcribe,
    })).rejects.toThrow('Audio file is too small');

    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('does not retry billing (insufficient_quota) errors even with attempts left', async () => {
    const transcribe = jest.fn()
      .mockRejectedValue(new Error('429 You exceeded your current quota. insufficient_quota'));

    await expect(createTranscriptionWithRetry(new Blob(['x']), {
      baseDelayMs: 0,
      maxAttempts: 3,
      transcribe,
    })).rejects.toThrow('insufficient_quota');

    expect(transcribe).toHaveBeenCalledTimes(1);
  });

  it('maps transient failures to a retryable 503 response contract', () => {
    const error = new Error('Connection error. (Note: audio/webm;codecs=opus format may have compatibility issues)');

    expect(isRetryableTranscriptionError(error)).toBe(true);
    expect(mapTranscriptionError(error)).toEqual({
      status: 503,
      error: RETRYABLE_TRANSCRIPTION_ERROR,
      retryable: true,
      phase: 'transcribe_audio',
      kind: 'network',
    });
  });

  it('maps unsupported audio failures to non-retryable 400 responses', () => {
    expect(mapTranscriptionError(new Error('Audio file might be corrupted or unsupported'))).toEqual({
      status: 400,
      error: 'Audio file might be corrupted or unsupported. Please try recording again.',
      kind: 'invalid_audio',
    });
  });

  it('maps out-of-credit (insufficient_quota) to a non-retryable 429 billing response', () => {
    const error = new Error('429 You exceeded your current quota, please check your plan and billing details. insufficient_quota');

    expect(classifyTranscriptionError(error)).toBe('billing');
    expect(isRetryableTranscriptionError(error)).toBe(false);
    expect(mapTranscriptionError(error)).toEqual({
      status: 429,
      error: BILLING_TRANSCRIPTION_ERROR,
      retryable: false,
      kind: 'billing',
    });
  });

  it('distinguishes a funded rate-limit (retryable) from insufficient_quota (not)', () => {
    const rateLimited = new Error('Rate limit reached. rate_limit_exceeded');
    const outOfCredit = new Error('insufficient_quota');

    expect(classifyTranscriptionError(rateLimited)).toBe('rate_limit');
    expect(isRetryableTranscriptionError(rateLimited)).toBe(true);
    expect(classifyTranscriptionError(outOfCredit)).toBe('billing');
    expect(isRetryableTranscriptionError(outOfCredit)).toBe(false);
  });

  it('maps an invalid API key to a non-retryable 401 auth response', () => {
    const error = new Error('Incorrect API key provided. invalid_api_key');

    expect(classifyTranscriptionError(error)).toBe('auth');
    expect(mapTranscriptionError(error)).toEqual({
      status: 401,
      error: 'Transcription service authentication failed. Please contact support.',
      retryable: false,
      kind: 'auth',
    });
  });

  // REALISTIC OpenAI SDK error shapes — the classification signal lives in the
  // own-props code/type/status, NOT in the human message (Popper Critical 1).
  describe('realistic OpenAI SDK (APIError) shapes — markers on code/type/status, not message', () => {
    it('classifies out-of-credit (code=insufficient_quota on the object) as non-retryable billing', () => {
      const error = Object.assign(
        new Error('You exceeded your current quota, please check your plan and billing details.'),
        { status: 429, code: 'insufficient_quota', type: 'insufficient_quota' }
      );

      expect(classifyTranscriptionError(error)).toBe('billing');
      expect(isRetryableTranscriptionError(error)).toBe(false);
      expect(mapTranscriptionError(error)).toEqual({
        status: 429,
        error: BILLING_TRANSCRIPTION_ERROR,
        retryable: false,
        kind: 'billing',
      });
    });

    it('classifies a funded rate-limit (code=rate_limit_exceeded on the object) as retryable rate_limit', () => {
      const error = Object.assign(
        new Error('Rate limit reached for gpt-4o-transcribe in organization org-x on requests per min.'),
        { status: 429, code: 'rate_limit_exceeded', type: 'requests' }
      );

      expect(classifyTranscriptionError(error)).toBe('rate_limit');
      expect(isRetryableTranscriptionError(error)).toBe(true);
    });

    it('classifies APIConnectionError (ECONNRESET on cause, status undefined) as retryable network', () => {
      const cause = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      const error = Object.assign(new Error('Connection error.'), { cause });

      expect(classifyTranscriptionError(error)).toBe('network');
      expect(isRetryableTranscriptionError(error)).toBe(true);
    });

    it('classifies a 401 with code=invalid_api_key (no human phrase) as non-retryable auth', () => {
      const error = Object.assign(new Error('Unauthorized'), { status: 401, code: 'invalid_api_key' });

      expect(classifyTranscriptionError(error)).toBe('auth');
      expect(isRetryableTranscriptionError(error)).toBe(false);
    });

    // The openAI.client catch re-wraps known-issue-format (webm/opus — the DEFAULT)
    // failures in a new Error, attaching the original as `cause`. Billing must still
    // be seen through the wrap. (Popper convergence — Critical 1 deeper layer.)
    it('sees through a known-issue-format re-wrap (via cause) to classify billing', () => {
      const apiError = Object.assign(new Error('You exceeded your current quota, please check your plan and billing details.'), {
        status: 429, code: 'insufficient_quota', type: 'insufficient_quota',
      });
      const wrapped = new Error(`${apiError.message} (Note: audio/webm;codecs=opus format may have compatibility issues)`);
      (wrapped as Error & { cause?: unknown }).cause = apiError;

      expect(classifyTranscriptionError(wrapped)).toBe('billing');
      expect(isRetryableTranscriptionError(wrapped)).toBe(false);
    });
  });
});
