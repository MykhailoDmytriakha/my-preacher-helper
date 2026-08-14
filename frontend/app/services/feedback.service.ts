/**
 * Service for handling user feedback operations
 */

/**
 * Submits user feedback to the API
 * @param feedbackText - The content of the feedback
 * @param feedbackType - The type of feedback (suggestion, bug, question, other)
 * @param images - Optional array of Base64-encoded image data URLs (max 3)
 * @param userId - The user's ID or 'anonymous'
 * @returns Promise with the response data
 */
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';
import {
  getUtf8ByteLength,
  MAX_FEEDBACK_PAYLOAD_BYTES,
  MAX_FEEDBACK_TEXT_BYTES,
  serializeFeedbackPayload,
} from '@/utils/feedbackPayload';

export async function submitFeedback(
  feedbackText: string,
  feedbackType: string,
  images: string[] = [],
  userId: string = 'anonymous'
) {
  // Endpoint derives identity from the bearer token; userId is kept for signature
  // compatibility but is ignored server-side.
  if (getUtf8ByteLength(feedbackText) > MAX_FEEDBACK_TEXT_BYTES) {
    throw new Error('Feedback text is too large');
  }

  const serializedPayload = serializeFeedbackPayload({
    feedbackText,
    feedbackType,
    images,
    userId,
  });
  if (getUtf8ByteLength(serializedPayload) > MAX_FEEDBACK_PAYLOAD_BYTES) {
    throw new Error('Feedback payload is too large');
  }

  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: serializedPayload
  });

  if (!response.ok) {
    // A proxy can return HTML for a 413. Parse best-effort so that malformed error
    // bodies cannot erase the response class which tells recovery not to retry.
    const body = await response.json().catch(() => null);
    const data = body && typeof body === 'object' ? (body as { error?: unknown; code?: unknown }) : {};
    const error = new Error(typeof data.error === 'string' ? data.error : 'Error submitting feedback');
    // Preserve the server's refusal class. The UI must not turn a 403 into a
    // guessed connectivity problem or invite a retry that cannot succeed.
    const codeByStatus: Record<number, string> = {
      400: 'invalid-argument',
      401: 'unauthenticated',
      403: 'permission-denied',
      404: 'not-found',
      // 413 is as final as a 403: the same letter will exceed the same ceiling every
      // time. Left unclassified, it reached the person as "something went wrong,
      // please try again" — advice that cannot work.
      413: 'invalid-argument',
    };
    const responseCode = typeof data.code === 'string' ? data.code : undefined;
    const code = responseCode || codeByStatus[response.status];
    Object.assign(error, { status: response.status, ...(code ? { code } : {}) });
    // 429 is neither transient nor final: it is a refusal WITH a known waiting time.
    // Carry the status and Retry-After so the form can say how long, instead of
    // inviting an immediate retry that is guaranteed to fail again.
    if (response.status === 429) {
      const retryAfterSeconds = Number(response.headers?.get('Retry-After')) || undefined;
      Object.assign(error, { retryAfterSeconds });
    }
    throw error;
  }

  return response.json();
}
