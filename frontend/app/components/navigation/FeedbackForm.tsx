'use client';

import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import "@locales/i18n";

const MAX_IMAGES = 3;
const MAX_IMAGE_SIZE_BYTES = 4 * 1024 * 1024; // 4 MB

interface FeedbackFormProps {
  onSubmit: (text: string, type: string, images: string[]) => Promise<boolean | void>;
  onCancel: () => void;
}

export default function FeedbackForm({ onSubmit, onCancel }: FeedbackFormProps) {
  const { t } = useTranslation();
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackType, setFeedbackType] = useState('suggestion');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [images, setImages] = useState<string[]>([]);
  const [imageError, setImageError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImageError('');
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      setImageError(t('feedback.imageLimitReached') || 'Maximum 3 images allowed');
      // Reset input so same file can be re-selected if image is removed
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const toProcess = files.slice(0, remaining);
    toProcess.forEach(file => {
      if (file.size > MAX_IMAGE_SIZE_BYTES) {
        setImageError(`"${file.name}" is too large (max 4 MB)`);
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          setImages(prev => {
            if (prev.length >= MAX_IMAGES) return prev;
            return [...prev, result];
          });
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset input so the same file can be re-selected after removal
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveImage = (index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index));
    setImageError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackText.trim()) {
      try {
        setIsSubmitting(true);
        await onSubmit(feedbackText, feedbackType, images);
      } catch {
        // Error is handled in the parent component
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const canAddMore = images.length < MAX_IMAGES;

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

      {/* Image attachment section */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2" suppressHydrationWarning={true}>
          {t('feedback.imagesLabel') || 'Attachments'}
        </label>

        {/* Thumbnails grid */}
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2" data-testid="image-previews">
            {images.map((src, index) => (
              <div key={index} className="relative group w-16 h-16 rounded-md overflow-hidden border border-gray-300 dark:border-gray-600 flex-shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`attachment-${index + 1}`}
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveImage(index)}
                  aria-label={t('feedback.removeImage') || 'Remove image'}
                  disabled={isSubmitting}
                  data-testid={`remove-image-${index}`}
                  className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50 opacity-0 group-hover:opacity-100 transition-opacity rounded-md focus:opacity-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Attach button */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            disabled={isSubmitting || !canAddMore}
            data-testid="image-file-input"
            className="sr-only"
            id="feedback-image-input"
            aria-label={t('feedback.attachImages') || 'Attach images (optional)'}
          />
          <label
            htmlFor="feedback-image-input"
            suppressHydrationWarning={true}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors cursor-pointer select-none ${
              isSubmitting || !canAddMore
                ? 'opacity-50 cursor-not-allowed border-gray-300 dark:border-gray-600 text-gray-400'
                : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
            {t('feedback.attachImages') || 'Attach images (optional)'}
          </label>
          <span className="text-xs text-gray-400 dark:text-gray-500" suppressHydrationWarning={true}>
            {t('feedback.imagesNote') || 'Up to 3 images, max 4 MB each'}
          </span>
        </div>

        {imageError && (
          <p className="mt-1 text-xs text-red-500" role="alert" data-testid="image-error">
            {imageError}
          </p>
        )}
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