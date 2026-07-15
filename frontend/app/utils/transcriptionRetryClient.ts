import { isUsageCapReachedError } from '@/services/usageLimits';
import { apiClient } from '@/utils/apiClient';

const rethrowUsageCapReached = (error: unknown): void => {
  if (isUsageCapReachedError(error)) throw error;
};

/** Returns a server-verifiable Firebase identity or fails before any AI request is sent. */
export async function getTranscriptionAuthorizationHeaders(): Promise<HeadersInit> {
  const { auth } = await import('@/services/firebaseAuth.service');
  if (!auth.currentUser) throw new Error('Authentication required for transcription');

  const token = await auth.currentUser.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function getDefaultTransportHeaders(
  fetchImpl: TranscribeWithRetryOptions['fetchImpl']
): Promise<HeadersInit | undefined> {
  if (fetchImpl) return undefined;
  return getTranscriptionAuthorizationHeaders();
}

function buildTranscriptionRequest(
  formData: FormData,
  headers: HeadersInit | undefined
) {
  const request = { method: 'POST', body: formData, category: 'audio' as const };
  return headers ? { ...request, headers } : request;
}

/**
 * Client-side transcription with retry. Each retry is a SEPARATE HTTP request,
 * so it gets a fresh 60s Vercel budget instead of sharing (and blowing) one
 * function's timeout — this is the fix for the "retry-within-60s" death.
 *
 * It also refuses to bury errors: every attempt's failure (possibly a DIFFERENT
 * kind than the last) is collected into `TranscriptionClientError.attempts`, so
 * the UI can show the user the full, human-readable truth of what went wrong.
 */

export type TranscriptionErrorKind =
  | 'billing'
  | 'rate_limit'
  | 'auth'
  | 'invalid_audio'
  | 'bad_request'
  | 'network'
  | 'server'
  | 'unknown';

export interface TranscriptionAttemptError {
  kind: TranscriptionErrorKind;
  status: number;
  message: string;
}

export interface TranscriptionResult {
  polishedText: string;
  originalText: string;
  warning?: string;
}

const RETRYABLE_KINDS: ReadonlySet<TranscriptionErrorKind> = new Set<TranscriptionErrorKind>([
  'network',
  'rate_limit',
  'server',
]);

// Most-consequential first — used to order distinct kinds when several attempts
// failed differently, so the leading message the user sees is the one that matters.
const KIND_SEVERITY: readonly TranscriptionErrorKind[] = [
  'billing',
  'auth',
  'invalid_audio',
  'bad_request',
  'rate_limit',
  'server',
  'network',
  'unknown',
];

function dedupeKindsBySeverity(attempts: TranscriptionAttemptError[]): TranscriptionErrorKind[] {
  const present = new Set(attempts.map((a) => a.kind));
  return KIND_SEVERITY.filter((k) => present.has(k));
}

export class TranscriptionClientError extends Error {
  /** Distinct kinds across all attempts, ordered most-consequential first. */
  readonly kinds: TranscriptionErrorKind[];
  /** Every attempt's error — nothing buried. */
  readonly attempts: TranscriptionAttemptError[];
  /** Best recognized text the server managed to return, if any. */
  readonly originalText?: string;
  /** True when repeated connection resets suggest a possible billing problem. */
  readonly suggestsBilling: boolean;

  constructor(attempts: TranscriptionAttemptError[], originalText?: string) {
    const kinds = dedupeKindsBySeverity(attempts);
    const networkCount = attempts.filter((a) => a.kind === 'network').length;
    super(
      attempts.length > 0
        ? attempts.map((a) => a.message).join(' | ')
        : 'Transcription failed'
    );
    this.name = 'TranscriptionClientError';
    this.attempts = attempts;
    this.kinds = kinds.length > 0 ? kinds : ['unknown'];
    this.originalText = originalText;
    // "Out of credit can look like a socket reset on transcriptions" — so if we
    // retried through repeated network resets and still failed, hint at billing.
    this.suggestsBilling = networkCount >= 2 && !kinds.includes('billing');
  }
}

interface TranscriptionResponseBody {
  success?: boolean;
  polishedText?: string;
  originalText?: string;
  warning?: string;
  error?: string;
  kind?: TranscriptionErrorKind;
  retryable?: boolean;
  phase?: string;
}

export interface TranscribeWithRetryOptions {
  endpoint: string;
  /** Extra FormData fields (e.g. sermonId) appended to every attempt. */
  fields?: Record<string, string>;
  /** Retries AFTER the first attempt (total attempts = maxRetries + 1). */
  maxRetries?: number;
  baseDelayMs?: number;
  onAttemptFailed?: (info: { attempt: number; kind: TranscriptionErrorKind; willRetry: boolean }) => void;
  fetchImpl?: typeof apiClient;
  wait?: (ms: number) => Promise<void>;
}

const DEFAULT_BASE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 1000;

async function readTranscriptionBody(response: Response): Promise<TranscriptionResponseBody | null> {
  try {
    return (await response.json()) as TranscriptionResponseBody;
  } catch {
    return null;
  }
}

// When the server returns NO JSON body (e.g. a raw 504 FUNCTION_INVOCATION_TIMEOUT
// killed at the Vercel wall — the exact case client retry exists for), fall back to
// the HTTP status so 429/5xx are still retried instead of dropped as 'unknown'.
// (Popper Major 4.)
function kindFromHttpStatus(status: number): TranscriptionErrorKind {
  if (status === 429) return 'rate_limit';
  if (status === 401) return 'auth';
  if (status === 400 || status === 403 || status === 404 || status === 422) return 'bad_request';
  if (status >= 500) return 'server';
  return 'unknown';
}

// A 200 "success" whose recognized text is blank = silence / mic capture failure —
// not a real success (Codex Popper P6).
function isEmptySuccess(data: TranscriptionResponseBody): boolean {
  const polished = (data.polishedText ?? data.originalText ?? '').trim();
  const original = (data.originalText ?? data.polishedText ?? '').trim();
  return !polished && !original;
}

/**
 * POST an audio blob to a transcription endpoint, retrying transient failures as
 * fresh requests. Resolves with the transcription; rejects with a
 * TranscriptionClientError carrying every attempt's error and any recognized text.
 */
export async function transcribeAudioWithRetry(
  blob: Blob,
  options: TranscribeWithRetryOptions
): Promise<TranscriptionResult> {
  const maxRetries = Math.max(0, options.maxRetries ?? 2);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS);
  const call = options.fetchImpl ?? apiClient;
  const waitFn = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // Custom fetch seams remain fully caller-controlled. Production calls attach
  // Firebase identity; token failures reject instead of silently bypassing quota.
  const headers = await getDefaultTransportHeaders(options.fetchImpl);

  const attempts: TranscriptionAttemptError[] = [];
  let originalText: string | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const isLast = attempt === maxRetries;

    const formData = new FormData();
    formData.append('audio', blob, 'recording.webm');
    for (const [key, value] of Object.entries(options.fields ?? {})) {
      formData.append(key, value);
    }

    let response: Response;
    try {
      response = await call(options.endpoint, buildTranscriptionRequest(formData, headers));
    } catch (transportError) {
      rethrowUsageCapReached(transportError);
      // apiClient threw before any HTTP response — a genuine transport failure.
      const message = transportError instanceof Error ? transportError.message : 'Network error';
      attempts.push({ kind: 'network', status: 0, message });
      options.onAttemptFailed?.({ attempt: attempt + 1, kind: 'network', willRetry: !isLast });
      if (isLast) break;
      await waitFn(baseDelayMs * (attempt + 1));
      continue;
    }

    const data = await readTranscriptionBody(response);

    if (response.ok && data?.success) {
      // Empty recognition (silence / mic failure) is KEPT for recovery, not lost.
      if (isEmptySuccess(data)) {
        attempts.push({ kind: 'invalid_audio', status: response.status, message: 'No speech was recognized in the recording.' });
        break; // empty is usually genuine silence — don't retry
      }
      return {
        polishedText: data.polishedText ?? data.originalText ?? '',
        originalText: data.originalText ?? data.polishedText ?? '',
        warning: data.warning,
      };
    }

    const kind: TranscriptionErrorKind = data?.kind ?? kindFromHttpStatus(response.status);
    const message = data?.error ?? response.statusText ?? `HTTP ${response.status}`;
    if (data?.originalText) {
      originalText = data.originalText;
    }
    attempts.push({ kind, status: response.status, message });

    const serverAllowsRetry = data?.retryable ?? RETRYABLE_KINDS.has(kind);
    const willRetry = serverAllowsRetry && !isLast;
    options.onAttemptFailed?.({ attempt: attempt + 1, kind, willRetry });
    if (!willRetry) break;
    await waitFn(baseDelayMs * (attempt + 1));
  }

  throw new TranscriptionClientError(attempts, originalText);
}

export interface TranscriptionErrorDisplay {
  /** i18n keys for each distinct kind, most-consequential first. */
  messageKeys: string[];
  /** Whether to append the "check your OpenAI billing" hint. */
  showBillingHint: boolean;
}

/**
 * Map a transcription failure to the i18n keys the UI should show. Nothing is
 * buried — every DISTINCT kind gets a key (ordered by severity), and repeated
 * network resets add a billing hint. The component resolves keys with its t().
 */
export function describeTranscriptionError(error: unknown): TranscriptionErrorDisplay {
  if (error instanceof TranscriptionClientError) {
    return {
      messageKeys: error.kinds.map((k) => `audio.transcribeError.${k}`),
      showBillingHint: error.suggestsBilling,
    };
  }
  return { messageKeys: ['audio.transcribeError.unknown'], showBillingHint: false };
}

/**
 * Build one human-readable message from a transcription failure. Joins the
 * distinct-kind messages (deduped once resolved) and appends the billing hint
 * when warranted — ready to drop into a toast or the recovery panel.
 */
export function buildTranscriptionErrorMessage(
  error: unknown,
  t: (key: string) => string
): string {
  const { messageKeys, showBillingHint } = describeTranscriptionError(error);
  const parts = messageKeys.map((key) => t(key));
  if (showBillingHint) {
    parts.push(t('audio.transcribeError.billingHint'));
  }
  return Array.from(new Set(parts)).join(' ');
}
