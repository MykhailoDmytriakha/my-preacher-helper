import { createTranscription } from '@clients/openAI.client';

export const RETRYABLE_TRANSCRIPTION_ERROR =
  'Temporary transcription connection issue. The recording looked valid, but the transcription service connection failed. Please try again.';

export interface TranscriptionErrorResponse {
  status: number;
  error: string;
  retryable?: boolean;
  phase?: 'transcribe_audio';
}

export interface TranscriptionRetryEvent {
  attempt: number;
  nextAttempt: number;
  maxAttempts: number;
  delayMs: number;
  error: unknown;
}

export interface CreateTranscriptionWithRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  transcribe?: (file: File | Blob) => Promise<string>;
  onRetry?: (event: TranscriptionRetryEvent) => void;
}

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_BASE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 750;

function collectErrorText(error: unknown): string {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    const causeText = 'cause' in error
      ? collectErrorText((error as Error & { cause?: unknown }).cause)
      : '';
    return `${error.name} ${error.message} ${causeText}`.trim();
  }

  if (typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return [
      record.name,
      record.message,
      record.code,
      record.errno,
      record.type,
      collectErrorText(record.cause),
    ]
      .filter(Boolean)
      .join(' ');
  }

  return String(error);
}

export function isRetryableTranscriptionError(error: unknown): boolean {
  const text = collectErrorText(error).toLowerCase();

  return [
    'connection error',
    'econnreset',
    'etimedout',
    'socket hang up',
    'fetch failed',
    'network',
    'timeout',
    'temporarily unavailable',
    'rate limit',
    '429',
    '500',
    '502',
    '503',
    '504',
  ].some((marker) => text.includes(marker));
}

export function mapTranscriptionError(transcriptionError: unknown): TranscriptionErrorResponse | null {
  if (!(transcriptionError instanceof Error)) {
    return null;
  }

  const errorMessage = transcriptionError.message.toLowerCase();
  if (errorMessage.includes('audio file might be corrupted or unsupported')) {
    return { status: 400, error: 'Audio file might be corrupted or unsupported. Please try recording again.' };
  }
  if (errorMessage.includes('audio file is empty')) {
    return { status: 400, error: 'Audio recording failed - file is empty. Please try recording again.' };
  }
  if (errorMessage.includes('audio file is too small')) {
    return { status: 400, error: 'Audio recording is too short. Please record for at least 1 second.' };
  }
  if (errorMessage.includes('400') || errorMessage.includes('invalid_request_error')) {
    return { status: 400, error: 'Audio file format not supported. Please try recording again.' };
  }
  if (isRetryableTranscriptionError(transcriptionError)) {
    return {
      status: 503,
      error: RETRYABLE_TRANSCRIPTION_ERROR,
      retryable: true,
      phase: 'transcribe_audio',
    };
  }
  return null;
}

function wait(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function createTranscriptionWithRetry(
  file: File | Blob,
  options: CreateTranscriptionWithRetryOptions = {}
): Promise<string> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const transcribe = options.transcribe ?? createTranscription;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await transcribe(file);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < maxAttempts && isRetryableTranscriptionError(error);

      if (!canRetry) {
        throw error;
      }

      const delayMs = baseDelayMs * attempt;
      console.warn(
        `Transcription retry: attempt ${attempt}/${maxAttempts} failed with a transient error. Retrying in ${delayMs}ms.`,
        error
      );
      options.onRetry?.({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      });
      await wait(delayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Transcription failed');
}
