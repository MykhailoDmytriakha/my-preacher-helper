import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { writeFailureTranslationKey } from '@/utils/writeRecovery';
import { submitFeedback } from '@services/feedback.service';

export function useFeedback() {
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const { t } = useTranslation();

  // Function to open feedback modal
  const handleFeedbackClick = useCallback(() => {
    setShowFeedbackModal(true);
  }, []);

  // Function to close feedback modal
  const closeFeedbackModal = useCallback(() => {
    setShowFeedbackModal(false);
  }, []);

  // Function to submit feedback
  const handleSubmitFeedback = useCallback(async (
    feedbackText: string,
    feedbackType: string,
    images: string[] = [],
    userId: string = 'anonymous'
  ) => {
    try {
      // Use the feedback service to submit feedback
      await submitFeedback(feedbackText, feedbackType, images, userId);

      // Add a slight delay to ensure the loading state is visible before closing the modal
      await new Promise(resolve => setTimeout(resolve, 500));

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
