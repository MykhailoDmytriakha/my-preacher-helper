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
export async function submitFeedback(
  feedbackText: string,
  feedbackType: string,
  images: string[] = [],
  userId: string = 'anonymous'
) {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      feedbackText,
      feedbackType,
      images,
      userId
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Error submitting feedback');
  }

  return data;
}