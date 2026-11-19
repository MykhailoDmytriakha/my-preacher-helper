import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

import { newClientId } from '@/utils/clientId';
import { announceFeedbackRefused, deliverFeedback, FeedbackNotKeptError, queueFeedback, type QueuedFeedback } from '@/utils/feedbackOutbox';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { useTranslation } from '@locales/useTranslation';
import { submitFeedback } from '@services/feedback.service';

/** How long «Sending…» shows before the window closes. */
const SEND_ANIMATION_MS = 400;
/** How long the form waits for the server's answer before leaving delivery to the background. */
const SEND_WINDOW_MS = 1500;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, Math.max(0, ms)));

/** Queues the feedback; null when the device cannot keep it, and the form sends it directly. */
async function keepOnDevice(input: Parameters<typeof queueFeedback>[0]): Promise<QueuedFeedback | null> {
  try {
    return await queueFeedback(input);
  } catch (error) {
    if (error instanceof FeedbackNotKeptError) return null;
    throw error;
  }
}

/**
 * Kept on the device: the window closes after a short moment, and delivery goes on in the background
 * (owner, 2026-11-17). An answer that comes within that moment is still said in the form — a refusal
 * keeps the words in the open form, as before; one that comes later is announced, not dropped.
 */
async function sendFromDevice(queued: QueuedFeedback): Promise<void> {
  const delivery = deliverFeedback(queued);
  const outcome = await Promise.race([delivery, wait(SEND_WINDOW_MS).then(() => null)]);
  if (outcome?.kind === 'refused') throw outcome.error;
  if (!outcome) void delivery.then(late => { if (late.kind === 'refused') announceFeedbackRefused(late.error); });
}

export function useFeedback() {
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  /**
   * THE NAME OF THE FEEDBACK IN THE OPEN WINDOW, bound to its words. The same words pressed again keep
   * their name on either road — kept on the device or sent at once — so the server finishes that
   * feedback, its letter included, instead of storing and mailing it twice; changed words get a new
   * name, so the server never answers «already done» for words it has not seen (Codex review rounds 2
   * and 3, 2026-11-17). A sent feedback or a closed window starts afresh.
   */
  const pendingName = useRef<{ name: string; words: string } | null>(null);
  const nameFor = (words: string): string => {
    if (pendingName.current?.words !== words) pendingName.current = { name: newClientId(), words };
    return pendingName.current.name;
  };
  const { t } = useTranslation();

  // Function to open feedback modal
  const handleFeedbackClick = useCallback(() => {
    setShowFeedbackModal(true);
  }, []);

  // Function to close feedback modal
  const closeFeedbackModal = useCallback(() => {
    pendingName.current = null;
    setShowFeedbackModal(false);
  }, []);

  // Function to submit feedback
  const handleSubmitFeedback = useCallback(async (
    feedbackText: string,
    feedbackType: string,
    images: string[] = [],
    userId: string = 'anonymous',
    diagnostics?: Record<string, unknown>
  ) => {
    const pressedAt = Date.now();
    try {
      // A signed-in sender's feedback is named; an anonymous one keeps the old unnamed contract.
      const name = userId === 'anonymous' ? undefined : nameFor(JSON.stringify([feedbackText, feedbackType, images]));
      const queued = name ? await keepOnDevice({ id: name, ownerId: userId, feedbackText, feedbackType, images, ...(diagnostics ? { diagnostics } : {}) }) : null;
      if (queued) await sendFromDevice(queued);
      else if (name) await submitFeedback(feedbackText, feedbackType, images, userId, diagnostics, name);
      else if (diagnostics) await submitFeedback(feedbackText, feedbackType, images, userId, diagnostics);
      else await submitFeedback(feedbackText, feedbackType, images, userId);
      pendingName.current = null;

      // A short moment of «Sending…», so the press is seen before the window closes.
      await wait(SEND_ANIMATION_MS - (Date.now() - pressedAt));

      setShowFeedbackModal(false);
      
      // Use toast instead of browser alert
      toast.success(t('feedback.successMessage'));
      
      return true;
    } catch (error) {

      // Add a slight delay before showing the error alert
      await new Promise(resolve => setTimeout(resolve, 500));

      // Too many submissions: refused for a KNOWN period. Saying "try again" here
      // was misleading — the next attempt cannot succeed until the window rolls.
      // The form keeps the text either way; this only tells the truth about when.
      const rateLimited = (error as { status?: number } | null)?.status === 429;
      if (rateLimited) {
        const seconds = (error as { retryAfterSeconds?: number }).retryAfterSeconds;
        const minutes = seconds ? Math.max(1, Math.ceil(seconds / 60)) : undefined;
        toast.error(
          minutes
            ? t('feedback.tooManySubmissionsIn', { minutes })
            : t('feedback.tooManySubmissions')
        );
        return false;
      }

      const failureKey = writeFailureTranslationKey(error, 'feedback.errorMessage');
      if (failureKey === 'writeRecovery.refused') {
        // The form owns refusal recovery because it can keep the exact draft beside
        // the message; swallowing the typed error here would reduce it to a generic failure.
        throw error;
      }

      // Use toast instead of browser alert for failures that the form cannot classify.
      toast.error(t(failureKey));
      
      return false;
    }
  }, [t]);

  return {
    showFeedbackModal,
    handleFeedbackClick,
    closeFeedbackModal,
    handleSubmitFeedback
  };
}
