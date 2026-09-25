'use client';

import { PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/20/solid';
import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import type { ManualTextBinding } from './manualTextBinding';

interface EditableVerseProps {
  initialVerse: string;
  onSave: (newVerse: string) => Promise<void>;
  disabled?: boolean;
  manual?: ManualTextBinding;
  textSizeClass?: string;
  inputSizeClass?: string;
  buttonSizeClass?: string;
  buttonPaddingClass?: string;
  containerClass?: string;
}

const EditableVerse: React.FC<EditableVerseProps> = ({
  initialVerse,
  onSave,
  disabled = false,
  manual,
  textSizeClass = 'text-sm',
  inputSizeClass = 'text-sm',
  buttonSizeClass = 'w-4 h-4',
  buttonPaddingClass = 'p-1.5',
  containerClass = 'flex items-center gap-2 flex-grow min-w-0',
}) => {
  const { t } = useTranslation();
  const [legacyEditing, setIsEditing] = useState(false);
  const isEditing = manual?.active ?? legacyEditing;
  const [legacyValue, setEditedVerse] = useState(initialVerse);
  const editedVerse = manual?.value ?? legacyValue;
  const [localSaving, setIsSaving] = useState(false);
  const isSaving = localSaving || Boolean(manual?.busy);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Update internal state if initialVerse prop changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditedVerse(initialVerse);
    }
  }, [initialVerse, isEditing]);

  // Focus textarea when editing starts and adjust height
  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
      adjustTextareaHeight();
    }
  }, [isEditing]);

  // Adjust textarea height based on content
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      const scrollHeight = textareaRef.current.scrollHeight;
      const lineHeight = 20; // Approximate line height in pixels
      const maxHeight = lineHeight * 10; // Max 10 lines
      textareaRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  };

  // Handle textarea input to adjust height
  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (manual) void manualAction(() => manual.update(value));
    else setEditedVerse(value);
    adjustTextareaHeight();
  };

  const manualAction = async (action: () => Promise<void>) => {
    setError(null);
    try { await action(); } catch { setError(t('errors.failedToSaveVerse')); }
  };

  const handleEditClick = () => {
    if (disabled || isSaving) return;
    if (manual) { void manualAction(() => manual.begin()); return; }
    setEditedVerse(initialVerse);
    setIsEditing(true);
    setError(null);
  };

  const handleCancelEdit = () => {
    if (manual) { void manualAction(() => manual.cancel()); return; }
    setIsEditing(false);
    setEditedVerse(initialVerse);
    setError(null);
  };

  const handleSave = async () => {
    if (disabled || isSaving) return;
    const trimmedVerse = editedVerse.trim();
    if (!manual && trimmedVerse === initialVerse) {
      setIsEditing(false);
      setError(null);
      return;
    }

    // Don't save if the trimmed verse is empty
    if (!trimmedVerse) {
      if (manual) { await manualAction(() => manual.cancel()); return; }
      setIsEditing(false);
      setError(null);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await (manual ? manual.save(trimmedVerse) : onSave(trimmedVerse));
      setIsEditing(false);
    } catch (err) {
      console.error("Error saving verse:", err);
      setError(t('errors.failedToSaveVerse'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (disabled) return;
    if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  // Don't render if verse is empty and not editing
  if (!initialVerse && !isEditing) {
    return null;
  }

  return (
    <div className={containerClass}>
      {isEditing ? (
        <div className="flex flex-col gap-2 w-full">
          <textarea
            ref={textareaRef}
            value={editedVerse}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            className={`flex-grow px-2 py-1 border rounded bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 resize-none overflow-hidden ${inputSizeClass} ${error ? 'border-red-500 focus:ring-red-500' : 'border-blue-500 focus:ring-blue-500'}`}
            disabled={isSaving || disabled}
            rows={1}
            aria-label={t('editSermon.verseLabel')}
            aria-invalid={!!error}
            aria-describedby={error ? "verse-error" : undefined}
            placeholder={t('editSermon.versePlaceholder')}
            style={{ minHeight: '20px', maxHeight: '200px' }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              className={`${buttonPaddingClass} text-green-600 hover:bg-green-100 dark:hover:bg-gray-600 rounded-full disabled:opacity-50`}
              disabled={isSaving || disabled}
              title={t('common.save')}
            >
              {isSaving ? (
                <svg className={`animate-spin text-blue-600 ${buttonSizeClass}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                <CheckIcon className={buttonSizeClass} />
              )}
            </button>
            <button
              onClick={handleCancelEdit}
              className={`${buttonPaddingClass} text-red-600 hover:bg-red-100 dark:hover:bg-gray-600 rounded-full disabled:opacity-50`}
              disabled={isSaving || disabled}
              title={t('common.cancel')}
            >
              <XMarkIcon className={buttonSizeClass} />
            </button>
            {error && <p id="verse-error" className="text-red-500 text-xs">{error}</p>}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2 group min-w-0">
          <p className={`${textSizeClass} text-gray-600 dark:text-gray-300 font-medium whitespace-pre-line break-words flex-grow`}>
            {initialVerse}
          </p>
          <button
            onClick={handleEditClick}
            className={`${buttonPaddingClass} text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full disabled:opacity-50 disabled:hover:bg-transparent`}
            disabled={disabled || isSaving}
            title={t('common.edit')}
          >
            <PencilIcon className={buttonSizeClass} />
          </button>
        </div>
      )}
      {!isEditing && error && <p role="alert" className="text-red-500 text-xs">{error}</p>}
    </div>
  );
};

export default EditableVerse;
