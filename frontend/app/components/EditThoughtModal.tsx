"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { getContrastColor } from '@utils/color';
import { Thought } from '@/models/models';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface EditThoughtModalProps {
  initialText: string;
  initialTags: string[];
  allowedTags: { name: string; color: string }[];
  onSave: (updatedText: string, updatedTags: string[]) => void;
  onClose: () => void;
}

export default function EditThoughtModal({ initialText, initialTags, allowedTags, onSave, onClose }: EditThoughtModalProps) {
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const isChanged = text !== initialText || tags.length !== initialTags.length || tags.some((tag, index) => tag !== initialTags[index]);
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    setIsSubmitting(true);
    try {
      onSave(text, tags);
      onClose();
    } catch (error) {
      console.error("Error saving thought:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const availableTags = allowedTags.filter(t => !tags.includes(t.name));

  const modalContent = (
    <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px]">
        <h2 className="text-2xl font-bold mb-6">{t('editThought.editTitle')}</h2>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.textLabel')}</label>
          <TextareaAutosize
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200"
            minRows={3}
          />
        </div>
        <div className="mb-4">
          <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('thought.tagsLabel')}</p>
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, idx) => {
              const tagInfo = allowedTags.find(t => t.name === tag);
              return (
                <div
                  key={tag + idx}
                  onClick={() => handleRemoveTag(idx)}
                  className="cursor-pointer flex items-center px-2 py-1 rounded-full"
                  style={{ backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0', color: tagInfo ? getContrastColor(tagInfo.color) : '#000' }}
                >
                  <span>{tag}</span>
                  <span className="ml-1">×</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2 mb-1">{t('editThought.availableTags')}</p>
          <div className="flex flex-wrap gap-2">
            {availableTags.map(t => (
              <div
                key={t.name}
                onClick={() => handleAddTag(t.name)}
                className="cursor-pointer flex items-center px-2 py-1 rounded-full"
                style={{ backgroundColor: t.color, color: getContrastColor(t.color) }}
              >
                {t.name}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </button>
          <button 
            type="button" 
            disabled={!isChanged || isSubmitting} 
            onClick={handleSave} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
          >
            {isSubmitting ? t('buttons.saving') : t('buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
} 