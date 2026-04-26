import {
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

  it('maps transient failures to a retryable 503 response contract', () => {
    const error = new Error('Connection error. (Note: audio/webm;codecs=opus format may have compatibility issues)');

    expect(isRetryableTranscriptionError(error)).toBe(true);
    expect(mapTranscriptionError(error)).toEqual({
      status: 503,
      error: RETRYABLE_TRANSCRIPTION_ERROR,
      retryable: true,
      phase: 'transcribe_audio',
    });
  });

  it('maps unsupported audio failures to non-retryable 400 responses', () => {
    expect(mapTranscriptionError(new Error('Audio file might be corrupted or unsupported'))).toEqual({
      status: 400,
      error: 'Audio file might be corrupted or unsupported. Please try recording again.',
    });
  });
});
