import { useState, useCallback } from 'react';
import { submitFeedback } from '@services/feedback.service';
import { useTranslation } from 'react-i18next';

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
  const handleSubmitFeedback = useCallback(async (feedbackText: string, feedbackType: string, userId: string = 'anonymous') => {
    try {
      // Use the feedback service to submit feedback
      await submitFeedback(feedbackText, feedbackType, userId);
      
      // Add a slight delay to ensure the loading state is visible before closing the modal
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setShowFeedbackModal(false);
      alert(t('feedback.successMessage'));
      return true;
    } catch (error) {
      console.error('Error submitting feedback:', error);
      
      // Add a slight delay before showing the error alert
      await new Promise(resolve => setTimeout(resolve, 500));
      
      alert(t('feedback.errorMessage'));
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