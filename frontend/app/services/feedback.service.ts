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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Error submitting feedback');
  }

  return data;
}
