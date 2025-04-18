"use client";

import React, { useState } from 'react';
import { Thought } from '@/models/models';
import { createManualThought } from '@services/thought.service';
import { PlusIcon } from '@components/Icons';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import "@locales/i18n";
import { toast } from 'sonner';

interface AddThoughtManualProps {
  sermonId: string;
  onNewThought: (thought: Thought) => void;
}

export default function AddThoughtManual({ sermonId, onNewThought }: AddThoughtManualProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const newThought: Thought = {
      id: '',
      text: trimmedText,
      tags: [],
      date: new Date().toISOString()
    };

    try {
      setIsSubmitting(true);
      const savedThought = await createManualThought(sermonId, newThought);
      onNewThought(savedThought);
      toast.success(t('manualThought.addedSuccess'));
      setText("");
      setOpen(false);
    } catch (error) {
      console.error("Error adding thought manually:", error);
      toast.error(t('errors.addThoughtError') || 'Failed to add thought. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-2"
      >
        <PlusIcon className="w-5 h-5" />
        {t('manualThought.addManual')}
      </button>
      {open && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="manual-thought-modal-title"
            className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="manual-thought-modal-title" className="text-2xl font-bold mb-6">{t('manualThought.addManual')}</h2>
            <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
              <div className="mb-6 flex-grow overflow-auto">
                <TextareaAutosize
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('manualThought.placeholder')}
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
                  minRows={3}
                  maxRows={16}
                  required
                />
              </div>
              <div className="flex justify-end gap-3 mt-auto">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
                  disabled={isSubmitting}
                >
                  {t('buttons.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                  disabled={isSubmitting || !text.trim()}
                >
                  {isSubmitting ? t('buttons.saving') : t('buttons.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
} 