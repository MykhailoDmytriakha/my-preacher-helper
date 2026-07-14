/**
 * Service for handling user feedback operations
 */

/**
 * Submits user feedback to the API
 * @param feedbackText - The content of the feedback
 * @param feedbackType - The type of feedback (suggestion, bug, question, other)
 * @param images - Optional array of Base64-encoded image data URLs (max 3)
 * @param userId - The user's ID or 'anonymous'
 * @param userEmail - The user's email or empty string
 * @returns Promise with the response data
 */
import { getAuthenticatedRequestHeaders } from '@/utils/authenticatedRequest';

export async function submitFeedback(
  feedbackText: string,
  feedbackType: string,
  images: string[] = [],
  userId: string = 'anonymous',
  userEmail: string = ''
) {
  // Endpoint derives identity from the bearer token; userId is kept for signature
  // compatibility but is ignored server-side.
  const authHeaders = await getAuthenticatedRequestHeaders();
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      feedbackText,
      feedbackType,
      images,
      userId,
      userEmail
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Error submitting feedback');
  }

  return data;
}