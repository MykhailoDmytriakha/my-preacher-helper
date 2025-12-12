"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import "@locales/i18n";

import { Sermon } from '@/models/models';
import { updateSermon } from '@services/sermon.service';

interface EditSermonModalProps {
  sermon: Sermon;
  onClose: () => void;
  onUpdate: (updatedSermon: Sermon) => void;
}

export default function EditSermonModal({ sermon, onClose, onUpdate }: EditSermonModalProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(sermon.title);
  const [verse, setVerse] = useState(sermon.verse);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mounted, setMounted] = useState(false);
  const hasChanges = title !== sermon.title || verse !== sermon.verse;

  // При монтировании устанавливаем флаг, чтобы использовать портал
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const data = await updateSermon({
        ...sermon,
        title,
        verse
      });

      if (!data) {
        throw new Error('Failed to update sermon');
      }

      onUpdate(data);
      onClose();
    } catch (error) {
      console.error("Error updating sermon:", error);
      alert(t('editSermon.updateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    // Останавливаем всплытие кликов, чтобы они не доходили до родительских элементов
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden"
      >
        <h2 className="text-2xl font-bold mb-6">{t('editSermon.editSermon')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.titleLabel')}
            </label>
            <TextareaAutosize 
              id="title" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('editSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
              minRows={1}
              maxRows={6}
              required
            />
          </div>
          <div className="mb-6 flex-grow overflow-auto">
            <label htmlFor="verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('editSermon.verseLabel')}
            </label>
            <TextareaAutosize 
              id="verse"
              value={verse}
              onChange={e => setVerse(e.target.value)}
              placeholder={t('editSermon.versePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
              minRows={3}
              maxRows={16}
              required
            />
          </div>
          <div className="flex justify-end gap-3 mt-auto">
            <button 
              type="button" 
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
            >
              {t('buttons.cancel')}
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting || !hasChanges}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              {isSubmitting ? t('buttons.saving') : t('buttons.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (mounted) {
    return createPortal(modalContent, document.body);
  }
  return null;
}
