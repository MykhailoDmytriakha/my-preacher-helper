'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

interface AddTagFormProps {
  onAddTag: (name: string, color: string) => void;
}

const AddTagForm: React.FC<AddTagFormProps> = ({ onAddTag }) => {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState({ 
    name: '', 
    color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') 
  });
  const [placeholder, setPlaceholder] = useState('');

  useEffect(() => {
    // Set placeholder on the client side to avoid hydration mismatch
    setPlaceholder(t('settings.tagNamePlaceholder'));
  }, [t]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newTag.name.trim()) {
      onAddTag(newTag.name.trim(), newTag.color);
      setNewTag({ 
        name: '', 
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0') 
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-4 mb-6">
      <div className="flex-1 flex flex-col">
        <label htmlFor="tagName" className="text-sm text-gray-600 dark:text-gray-400 mb-1">
          <span suppressHydrationWarning={true}>{t('settings.tagName')}</span>
        </label>
        <input
          id="tagName"
          type="text"
          value={newTag.name}
          onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
          placeholder={placeholder}
          className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      
      <div className="flex items-end gap-3">
        <div className="flex flex-col">
          <label htmlFor="tagColor" className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            <span suppressHydrationWarning={true}>{t('settings.tagColor')}</span>
          </label>
          <input
            id="tagColor"
            type="color"
            value={newTag.color}
            onChange={(e) => setNewTag({ ...newTag, color: e.target.value })}
            className="w-14 h-10 p-1 border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer"
          />
        </div>
        
        <button
          type="submit"
          className="h-10 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:hover:bg-gray-400 disabled:dark:bg-gray-600 transition-colors"
          disabled={!newTag.name.trim()}
        >
          <span suppressHydrationWarning={true}>{t('settings.addTag')}</span>
        </button>
      </div>
    </form>
  );
};

export default AddTagForm; 