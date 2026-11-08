export const AI_RESULT_OPERATION_HEADER = 'X-AI-Operation-Id';
export const AI_RESULT_RECOVERY_ONLY_HEADER = 'X-AI-Recover-Only';
export const AI_RESULT_PENDING = 'ai-result-pending';
export const AI_RESULT_UNAVAILABLE = 'ai-result-unavailable';
export const AI_RESULT_CONFLICT = 'ai-result-conflict';

/** Allow auth/transport overhead beyond the text routes' bounded settlement. */
export const SCRATCH_COMPOSE_REQUEST_TIMEOUT_MS = 65_000;
export const SCRATCH_COMPOSE_UI_TIMEOUT_MS = SCRATCH_COMPOSE_REQUEST_TIMEOUT_MS + 5_000;

export function aiResultFailureKey(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === AI_RESULT_PENDING) return 'errors.aiResultPending';
  if (code === AI_RESULT_UNAVAILABLE || code === AI_RESULT_CONFLICT) return 'errors.aiResultUnavailable';
}
