'use client';

import { useTranslation } from "react-i18next";

import FeedbackForm from "@/components/navigation/FeedbackForm";
import "@locales/i18n";

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string, type: string) => Promise<boolean | void>;
}

export default function FeedbackModal({ isOpen, onClose, onSubmit }: FeedbackModalProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="feedback-modal" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen p-4">
        {/* Modal backdrop */}
        <div className="fixed inset-0 bg-black bg-opacity-40 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        
        {/* Modal content */}
        <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white" suppressHydrationWarning={true}>
              {t('feedback.title') || 'Send Feedback'}
            </h3>
            <button 
              type="button" 
              className="text-gray-400 hover:text-gray-500 focus:outline-none" 
              onClick={onClose}
            >
              <span className="sr-only">Close</span>
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          
          <FeedbackForm onSubmit={onSubmit} onCancel={onClose} />
        </div>
      </div>
    </div>
  );
} 