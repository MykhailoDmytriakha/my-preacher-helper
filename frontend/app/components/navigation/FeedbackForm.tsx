'use client';

import { useState } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

interface FeedbackFormProps {
  onSubmit: (text: string, type: string) => Promise<boolean | void>;
  onCancel: () => void;
}

export default function FeedbackForm({ onSubmit, onCancel }: FeedbackFormProps) {
  const { t } = useTranslation();
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackType, setFeedbackType] = useState('suggestion');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackText.trim()) {
      try {
        setIsSubmitting(true);
        await onSubmit(feedbackText, feedbackType);
      } catch (error) {
        // Error is handled in the parent component
      } finally {
        setIsSubmitting(false);
      }
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" suppressHydrationWarning={true}>
          {t('feedback.typeLabel') || 'Feedback Type'}
        </label>
        <select
          value={feedbackType}
          onChange={(e) => setFeedbackType(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          required
          disabled={isSubmitting}
        >
          <option value="suggestion" suppressHydrationWarning={true}>{t('feedback.typeSuggestion') || 'Suggestion'}</option>
          <option value="bug" suppressHydrationWarning={true}>{t('feedback.typeBug') || 'Bug Report'}</option>
          <option value="question" suppressHydrationWarning={true}>{t('feedback.typeQuestion') || 'Question'}</option>
          <option value="other" suppressHydrationWarning={true}>{t('feedback.typeOther') || 'Other'}</option>
        </select>
      </div>
      
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1" suppressHydrationWarning={true}>
          {t('feedback.messageLabel') || 'Your Feedback'}
        </label>
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder={t('feedback.messagePlaceholder') || 'Please tell us what you think...'}
          required
          disabled={isSubmitting}
        />
      </div>
      
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
          suppressHydrationWarning={true}
          disabled={isSubmitting}
        >
          {t('feedback.cancelButton') || 'Cancel'}
        </button>
        <button
          type="submit"
          className={`px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${
            isSubmitting 
              ? 'bg-gray-400 cursor-not-allowed' 
              : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700'
          }`}
          suppressHydrationWarning={true}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <span className="flex items-center">
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              {t('feedback.sendingButton') || 'Sending...'}
            </span>
          ) : (
            t('feedback.submitButton') || 'Submit'
          )}
        </button>
      </div>
    </form>
  );
} 