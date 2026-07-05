import { createTranscription } from '@clients/openAI.client';

export const RETRYABLE_TRANSCRIPTION_ERROR =
  'Temporary transcription connection issue. The recording looked valid, but the transcription service connection failed. Please try again.';

export const BILLING_TRANSCRIPTION_ERROR =
  'OpenAI account is out of credit or over its quota. Add funds / check billing, then try again.';

/**
 * Coarse, STABLE classification of a transcription failure. Drives both the
 * retry decision (network / rate_limit / server are transient) and the human
 * message shown to the user (the client maps `kind` → localized text).
 * Matched on collected error text, which for OpenAI SDK errors includes the
 * stable `code`/`type` fields (`insufficient_quota`, `rate_limit_exceeded`,
 * `invalid_api_key`) — never the volatile human `message`.
 */
export type TranscriptionErrorKind =
  | 'billing'        // 429 insufficient_quota — out of credit; NOT retryable
  | 'rate_limit'     // 429 rate_limit_exceeded — funded but throttled; retryable
  | 'auth'           // 401 invalid_api_key; NOT retryable
  | 'invalid_audio'  // corrupted / empty / too short; NOT retryable
  | 'bad_request'    // 400 / invalid_request_error; NOT retryable
  | 'network'        // ECONNRESET / socket hang up / fetch failed / timeout; retryable
  | 'server'         // 5xx / temporarily unavailable; retryable
  | 'unknown';       // unmapped

export interface TranscriptionErrorResponse {
  status: number;
  error: string;
  retryable?: boolean;
  phase?: 'transcribe_audio';
  kind?: TranscriptionErrorKind;
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

// ONE attempt per serverless invocation. Retry is the CLIENT's job now — each
// client retry is a fresh HTTP request with its own 60s Vercel budget, so N
// retries never share (and blow) a single function's timeout. Callers that want
// in-invocation retries can still pass maxAttempts explicitly.
const DEFAULT_MAX_ATTEMPTS = 1;
const DEFAULT_BASE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 750;

function collectErrorText(error: unknown): string {
  if (!error) {
    return '';
  }

  if (error instanceof Error) {
    // OpenAI SDK errors (APIError) are Error subclasses that carry the STABLE
    // classification signal in own-props `code`/`type`/`status` (e.g.
    // `insufficient_quota`, `rate_limit_exceeded`, `invalid_api_key`), NOT in the
    // human `message`. Read them too — else billing/rate-limit/auth are
    // misclassified and the "add funds" path is unreachable. (Popper Critical 1.)
    const record = error as Error & {
      cause?: unknown; code?: unknown; type?: unknown; status?: unknown; errno?: unknown;
    };
    const causeText = 'cause' in error ? collectErrorText(record.cause) : '';
    return [error.name, error.message, record.code, record.type, record.status, record.errno, causeText]
      .filter(Boolean)
      .join(' ')
      .trim();
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

const RETRYABLE_KINDS: ReadonlySet<TranscriptionErrorKind> = new Set<TranscriptionErrorKind>([
  'network',
  'rate_limit',
  'server',
]);

/**
 * Classify a transcription error into a stable kind. ORDER MATTERS — most
 * specific / most consequential signals first: `insufficient_quota` (billing)
 * before generic 429/rate-limit, `invalid_api_key` (auth) before the broad
 * `invalid_request_error` bad-request marker. A raw ECONNRESET arrives with no
 * HTTP body, so it lands in `network` (retryable) — the "out of credit can look
 * like a socket reset on transcriptions" case is handled client-side as a soft
 * billing hint after network retries are exhausted.
 */
export function classifyTranscriptionError(error: unknown): TranscriptionErrorKind {
  const text = collectErrorText(error).toLowerCase();

  // Auth first: OpenAI surfaces invalid_api_key with type=invalid_request_error,
  // which would otherwise be swallowed by the generic bad_request check below.
  if (text.includes('invalid_api_key') || text.includes('incorrect api key')) {
    return 'auth';
  }
  // Billing — out of credit / quota (429 insufficient_quota). NOT a rate limit.
  if (text.includes('insufficient_quota')) {
    return 'billing';
  }
  // Deterministic audio-content problems.
  if (
    text.includes('corrupted or unsupported') ||
    text.includes('audio file is empty') ||
    text.includes('audio file is too small')
  ) {
    return 'invalid_audio';
  }
  // Rate limit — funded but throttled (429 rate_limit_exceeded / bare 429). Retryable.
  if (
    text.includes('rate_limit_exceeded') ||
    text.includes('rate limit') ||
    text.includes('too many requests') ||
    text.includes('429')
  ) {
    return 'rate_limit';
  }
  // Network / transport — connection reset, socket hang up, timeouts.
  if (
    text.includes('econnreset') ||
    text.includes('socket hang up') ||
    text.includes('etimedout') ||
    text.includes('econnrefused') ||
    text.includes('fetch failed') ||
    text.includes('connection error') ||
    text.includes('network') ||
    text.includes('timeout')
  ) {
    return 'network';
  }
  // Server — OpenAI 5xx / transient unavailability.
  if (
    text.includes('temporarily unavailable') ||
    text.includes('server_error') ||
    text.includes('500') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('504')
  ) {
    return 'server';
  }
  // Generic bad request last (broad markers).
  if (text.includes('invalid_request_error') || text.includes('400')) {
    return 'bad_request';
  }
  return 'unknown';
}

export function isRetryableTranscriptionError(error: unknown): boolean {
  return RETRYABLE_KINDS.has(classifyTranscriptionError(error));
}

export function mapTranscriptionError(transcriptionError: unknown): TranscriptionErrorResponse | null {
  if (!(transcriptionError instanceof Error)) {
    return null;
  }

  const kind = classifyTranscriptionError(transcriptionError);

  switch (kind) {
    case 'billing':
      return { status: 429, error: BILLING_TRANSCRIPTION_ERROR, retryable: false, kind };
    case 'auth':
      return { status: 401, error: 'Transcription service authentication failed. Please contact support.', retryable: false, kind };
    case 'invalid_audio': {
      const msg = transcriptionError.message.toLowerCase();
      if (msg.includes('audio file is empty')) {
        return { status: 400, error: 'Audio recording failed - file is empty. Please try recording again.', kind };
      }
      if (msg.includes('audio file is too small')) {
        return { status: 400, error: 'Audio recording is too short. Please record for at least 1 second.', kind };
      }
      return { status: 400, error: 'Audio file might be corrupted or unsupported. Please try recording again.', kind };
    }
    case 'network':
    case 'server':
    case 'rate_limit':
      return {
        status: 503,
        error: RETRYABLE_TRANSCRIPTION_ERROR,
        retryable: true,
        phase: 'transcribe_audio',
        kind,
      };
    case 'bad_request':
      return { status: 400, error: 'Audio file format not supported. Please try recording again.', kind };
    case 'unknown':
    default:
      return null;
  }
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
