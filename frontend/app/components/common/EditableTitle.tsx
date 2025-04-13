'use client';

import React, { useState, useRef, useEffect } from 'react';
import { PencilIcon, CheckIcon, XMarkIcon } from '@heroicons/react/20/solid';
import { useTranslation } from 'react-i18next';

interface EditableTitleProps {
  initialTitle: string;
  onSave: (newTitle: string) => Promise<void>; // Expects a promise to handle async save
  textSizeClass?: string; // e.g., "text-2xl sm:text-3xl"
  inputSizeClass?: string; // e.g., "text-2xl sm:text-3xl"
  buttonSizeClass?: string; // e.g., "w-5 h-5"
  buttonPaddingClass?: string; // e.g., "p-1.5"
  containerClass?: string; // e.g., "flex items-center gap-2 flex-grow min-w-0"
}

const EditableTitle: React.FC<EditableTitleProps> = ({
  initialTitle,
  onSave,
  textSizeClass = 'text-2xl sm:text-3xl',
  inputSizeClass = 'text-2xl sm:text-3xl',
  buttonSizeClass = 'w-5 h-5',
  buttonPaddingClass = 'p-1.5',
  containerClass = 'flex items-center gap-2 flex-grow min-w-0',
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(initialTitle);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null); // To display potential save errors
  const inputRef = useRef<HTMLInputElement>(null);

  // Update internal state if initialTitle prop changes externally
  useEffect(() => {
    if (!isEditing) {
      setEditedTitle(initialTitle);
    }
  }, [initialTitle, isEditing]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select(); // Select the text
    }
  }, [isEditing]);

  const handleEditClick = () => {
    setEditedTitle(initialTitle); // Reset edit field to current title when starting edit
    setIsEditing(true);
    setError(null); // Clear previous errors
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedTitle(initialTitle); // Revert changes
    setError(null);
  };

  const handleSave = async () => {
    const trimmedTitle = editedTitle.trim();
    if (!trimmedTitle || trimmedTitle === initialTitle) {
      setIsEditing(false); // No changes or empty title, just close
      setError(null);
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave(trimmedTitle); // Call the parent save handler
      setIsEditing(false); // Close edit mode on successful save
    } catch (err) {
      console.error("Error saving title:", err);
      setError(t('errors.failedToSaveTitle')); // Set user-friendly error message
      // Keep editing mode open so user can retry or cancel
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div className={containerClass}>
      {isEditing ? (
        <div className="flex items-center gap-2 w-full">
          <input
            ref={inputRef}
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            className={`flex-grow px-2 py-1 font-bold border rounded bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 ${inputSizeClass} ${error ? 'border-red-500 focus:ring-red-500' : 'border-blue-500 focus:ring-blue-500'}`}
            disabled={isSaving}
            aria-label={t('common.editTitleInput')}
            aria-invalid={!!error}
            aria-describedby={error ? "title-error" : undefined}
          />
          <button
            onClick={handleSave}
            className={`${buttonPaddingClass} text-green-600 hover:bg-green-100 dark:hover:bg-gray-600 rounded-full disabled:opacity-50`}
            disabled={isSaving}
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
            disabled={isSaving}
            title={t('common.cancel')}
          >
            <XMarkIcon className={buttonSizeClass} />
          </button>
          {error && <p id="title-error" className="text-red-500 text-xs ml-2">{error}</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2 group min-w-0">
           <h1 className={`${textSizeClass} font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent break-words flex-shrink min-w-0`}>
            {editedTitle} {/* Display editedTitle which reflects initialTitle */}
          </h1>
          <button
            onClick={handleEditClick}
            className={`${buttonPaddingClass} text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full`}
            title={t('common.edit')}
          >
            <PencilIcon className={`w-4 h-4 sm:${buttonSizeClass.replace('w-','').replace('h-','w-').replace('w-','h-')}`} /> {/* Adjusted pencil icon size slightly */} 
          </button>
        </div>
      )}
    </div>
  );
};

export default EditableTitle; 