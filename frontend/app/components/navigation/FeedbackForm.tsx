'use client';

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import "@locales/i18n";
import { buildDiagnosticReport } from '@/utils/appDiagnostics';
import { clipboardHasText, extractClipboardImageFiles } from '@/utils/clipboardImages';
import {
  getFeedbackPayloadByteLength,
  getUtf8ByteLength,
  MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES,
  MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES,
  MAX_FEEDBACK_IMAGE_BYTES,
  MAX_FEEDBACK_IMAGES,
  MAX_FEEDBACK_TEXT_BYTES,
} from '@/utils/feedbackPayload';
import { writeFailureTranslationKey } from '@/utils/writeRecovery';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

/**
 * The report is appended to the message rather than sent as its own field.
 *
 * It used to be reachable only through a viewer: open a dialog, read a wall of JSON, press
 * copy, then find the message box again and paste it in beside your own words. People did
 * that by hand — including the owner — and what arrived was one field holding a paragraph
 * of human sentences and eight kilobytes of machine detail, with the sentences buried. The
 * work of getting the two into one message belonged to the app all along.
 *
 * Appending keeps every part of the existing path intact: the size checks, the mail
 * template, what is stored. The marker below is what separates the person's words from the
 * machine's, so whoever reads the message can tell at a glance where one ends.
 */
const DIAGNOSTICS_MARKER = '--- technical details (attached by the app) ---';
/** Said in the message rather than swallowed: a missing report is itself worth knowing. */
const DIAGNOSTICS_UNAVAILABLE = '(this browser did not let the app collect them)';
const FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER = 'suggestion';
const PAYLOAD_TOO_LARGE_KEY = 'feedback.payloadTooLarge';

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
  /**
   * On by default, because the person reaching for this form has already hit something.
   * Off by default would keep the old friction in a new shape: the data would be one
   * click away and forgotten exactly when it is needed. The label says plainly what
   * travels, and one click removes it.
   */
  const [attachDiagnostics, setAttachDiagnostics] = useState(true);
  const [imageError, setImageError] = useState('');
  const [payloadError, setPayloadError] = useState('');
  const [submissionError, setSubmissionError] = useState('');
  const feedbackTextRef = useRef('');
  const imagesRef = useRef<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // One acceptance path for every source of a file — the picker, a paste, anything added later.
  // `imagesRef` rather than `images` because two pastes can land before React re-renders.
  const addImageFiles = useCallback((files: File[]) => {
    setImageError('');
    if (!files.length) return;

    const remaining = MAX_FEEDBACK_IMAGES - imagesRef.current.length;
    if (files.length > remaining) {
      setImageError(t('feedback.imageLimitReached') || 'Maximum 3 images allowed');
      if (remaining <= 0) return;
    }

    const toProcess = files.slice(0, remaining);
    toProcess.forEach(file => {
      if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
        setImageError(
          t('feedback.invalidImage') || 'Only PNG, JPEG, and WebP images are supported'
        );
        return;
      }
      if (file.size > MAX_FEEDBACK_IMAGE_BYTES) {
        setImageError(t('feedback.imageTooLarge') || 'Image is too large (max 3 MB)');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) {
          const nextImages = [...imagesRef.current, result];
          if (nextImages.length > MAX_FEEDBACK_IMAGES) return;

          const serializedAttachmentBytes = getFeedbackPayloadByteLength({
            feedbackText: '',
            feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
            images: nextImages,
            userId: '',
          });
          const serializedPayloadBytes = getFeedbackPayloadByteLength({
            feedbackText: feedbackTextRef.current,
            feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
            images: nextImages,
            userId: '',
          });
          if (
            serializedAttachmentBytes > MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES ||
            serializedPayloadBytes > MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES
          ) {
            setImageError(t(PAYLOAD_TOO_LARGE_KEY));
            return;
          }

          imagesRef.current = nextImages;
          setImages(nextImages);
        }
      };
      reader.readAsDataURL(file);
    });
  }, [t]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addImageFiles(Array.from(e.target.files || []));
    // Reset input so the same file can be re-selected after removal
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClipboard = useCallback((event: ClipboardEvent | React.ClipboardEvent) => {
    if (isSubmitting) return;

    const pastedImages = extractClipboardImageFiles(event.clipboardData);
    if (!pastedImages.length) return;

    // A screenshot paste carries no text worth keeping, and letting it through makes some browsers
    // drop the image's markup or file name into the textarea. A mixed paste keeps its text.
    if (!clipboardHasText(event.clipboardData)) event.preventDefault();

    addImageFiles(pastedImages);
  }, [addImageFiles, isSubmitting]);

  // The form handler covers pastes into its own fields; this covers Ctrl+V while the modal is open
  // but nothing inside it has focus — which is exactly how someone pastes a fresh screenshot.
  useEffect(() => {
    const onDocumentPaste = (event: ClipboardEvent) => {
      const target = event.target as Node | null;
      if (target && formRef.current?.contains(target)) return;
      handleClipboard(event);
    };

    document.addEventListener('paste', onDocumentPaste);
    return () => document.removeEventListener('paste', onDocumentPaste);
  }, [handleClipboard]);

  const handleRemoveImage = (index: number) => {
    const nextImages = imagesRef.current.filter((_, i) => i !== index);
    imagesRef.current = nextImages;
    setImages(nextImages);
    setImageError('');
    setPayloadError('');
  };

  const handleFeedbackTextChange = (value: string) => {
    feedbackTextRef.current = value;
    setFeedbackText(value);
    setSubmissionError('');
    const serializedPayloadBytes = getFeedbackPayloadByteLength({
      feedbackText: value,
      feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
      images: imagesRef.current,
      userId: '',
    });
    if (
      getUtf8ByteLength(value) > MAX_FEEDBACK_TEXT_BYTES ||
      serializedPayloadBytes > MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES
    ) {
      setPayloadError(t(PAYLOAD_TOO_LARGE_KEY));
      return;
    }

    setPayloadError('');
  };

  /**
   * The person's words first, the machine's afterwards, with a line between them.
   *
   * ⚠️ NO NETWORK CALL HERE, DELIBERATELY. The viewer asks the server for its version, and
   * that is fine when someone is sitting reading a dialog. On the send path it is a round
   * trip between pressing the button and anything happening — and offline it is the full
   * five-second timeout before giving up, at exactly the moment people write about
   * something being broken. The version that settles "were we looking at the same code" is
   * the one this browser is running, and the report carries it without asking anyone.
   */
  const withDiagnostics = (message: string): string => {
    /**
     * An optional attachment must never cost someone their message. The report reads a
     * dozen browser APIs, and any one of them can be missing or refused — a privacy mode,
     * an unusual engine, an embedded webview. Letting that throw would turn "I ticked a box"
     * into "the send button does nothing", which is the worst possible failure on a form
     * whose entire purpose is telling us something is wrong.
     */
    try {
      const report = JSON.stringify(buildDiagnosticReport(), null, 2);
      return `${message}\n\n${DIAGNOSTICS_MARKER}\n${report}`;
    } catch {
      return `${message}\n\n${DIAGNOSTICS_MARKER}\n${DIAGNOSTICS_UNAVAILABLE}`;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (feedbackText.trim()) {
      const serializedPayloadBytes = getFeedbackPayloadByteLength({
        feedbackText,
        feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
        images,
        userId: '',
      });
      if (getUtf8ByteLength(feedbackText) > MAX_FEEDBACK_TEXT_BYTES ||
        serializedPayloadBytes > MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES) {
        setPayloadError(t(PAYLOAD_TOO_LARGE_KEY));
        return;
      }

      try {
        setIsSubmitting(true);
        setSubmissionError('');
        /**
         * Collected at SEND time, not when the box was ticked: the last events before the
         * person pressed the button are the ones worth having, and the server check needs
         * a round trip we should not make them wait through earlier.
         */
        const message = attachDiagnostics ? withDiagnostics(feedbackText) : feedbackText;
        const accepted = await onSubmit(message, feedbackType, images);
        if (accepted === false) {
          setSubmissionError(t('feedback.errorMessage'));
        }
      } catch (error) {
        setSubmissionError(t(writeFailureTranslationKey(error, 'feedback.errorMessage')));
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const feedbackTextBytes = getUtf8ByteLength(feedbackText);
  const excessTextBytes = Math.max(0, feedbackTextBytes - MAX_FEEDBACK_TEXT_BYTES);
  const canAddMore = images.length < MAX_FEEDBACK_IMAGES;
  const serializedAttachmentBytes = getFeedbackPayloadByteLength({
    feedbackText: '',
    feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
    images,
    userId: '',
  });
  const serializedPayloadBytes = getFeedbackPayloadByteLength({
    feedbackText,
    feedbackType: FEEDBACK_TYPE_PAYLOAD_PLACEHOLDER,
    images,
    userId: '',
  });
  const remainingAttachmentBytes = Math.max(
    0,
    Math.min(
      MAX_FEEDBACK_ATTACHMENT_PAYLOAD_BYTES - serializedAttachmentBytes,
      MAX_FEEDBACK_CLIENT_PAYLOAD_BYTES - serializedPayloadBytes
    )
  );

  return (
    <form ref={formRef} onSubmit={handleSubmit} onPaste={handleClipboard}>
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
          onChange={(e) => handleFeedbackTextChange(e.target.value)}
          aria-describedby="feedback-text-budget"
          aria-invalid={excessTextBytes > 0 || undefined}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
          placeholder={t('feedback.messagePlaceholder') || 'Please tell us what you think...'}
          required
          disabled={isSubmitting}
        />
        <p id="feedback-text-budget" data-testid="feedback-text-budget" className="mt-1 text-xs text-gray-500 dark:text-gray-400" aria-live="polite">
          {t('feedback.textBudget', { used: feedbackTextBytes, limit: MAX_FEEDBACK_TEXT_BYTES })}
          {excessTextBytes > 0 && ` — ${t('feedback.textOverBudget', { count: excessTextBytes })}`}
        </p>
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
            accept="image/png,image/jpeg,image/webp"
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
            {t('feedback.imagesNote') || 'Up to 3 images, max 3 MB each and 4.4 MB total'}
          </span>
        </div>

        <p
          className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          data-testid="paste-hint"
          suppressHydrationWarning={true}
        >
          {t('feedback.pasteHint') || 'Or paste a screenshot straight from the clipboard (Ctrl+V)'}
        </p>

        <p
          className="mt-1 text-xs text-gray-400 dark:text-gray-500"
          data-testid="attachment-budget"
        >
          {t('feedback.attachmentBudgetRemaining', {
            amount: (remainingAttachmentBytes / 1_000_000).toFixed(1),
          })}
        </p>

        {/*
          Sits with the other attachments, because that is what it is. It used to be a
          button under the form that opened a viewer full of JSON and a copy action — so
          getting the data to the developer meant reading it, copying it, and pasting it
          back into your own message by hand.
        */}
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
          <input
            type="checkbox"
            checked={attachDiagnostics}
            onChange={(e) => setAttachDiagnostics(e.target.checked)}
            disabled={isSubmitting}
            data-testid="attach-diagnostics"
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
          />
          <span>
            <span suppressHydrationWarning={true}>{t('feedback.attachDiagnostics')}</span>
            <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400" suppressHydrationWarning={true}>
              {t('feedback.attachDiagnosticsNote')}
            </span>
          </span>
        </label>

        {imageError && (
          <p className="mt-1 text-xs text-red-500" role="alert" data-testid="image-error">
            {imageError}
          </p>
        )}
        {payloadError && (
          <p className="mt-1 text-xs text-red-500" role="alert" data-testid="payload-error">
            {payloadError}
          </p>
        )}
      </div>

      {submissionError && (
        <p className="mb-4 text-sm text-red-600 dark:text-red-400" role="alert">
          {submissionError}
        </p>
      )}

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
