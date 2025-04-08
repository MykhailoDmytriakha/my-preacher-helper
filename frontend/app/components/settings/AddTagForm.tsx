'use client';

import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import ColorPickerModal from '@components/ColorPickerModal';

interface AddTagFormProps {
  onAddTag: (name: string, color: string) => void;
}

// Predefined colors for quick selection
const defaultColors = [
  '#FF6B6B', '#FF9F43', '#FECA57', '#1DD1A1',
  '#54A0FF', '#5F27CD', '#FF9FF3', '#808E9B',
];

const AddTagForm: React.FC<AddTagFormProps> = ({ onAddTag }) => {
  const { t } = useTranslation();
  const [newTag, setNewTag] = useState({ 
    name: '', 
    color: defaultColors[Math.floor(Math.random() * defaultColors.length)]
  });
  const [placeholder, setPlaceholder] = useState('');
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

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
        color: defaultColors[Math.floor(Math.random() * defaultColors.length)]
      });
    }
  };

  const handleColorSelect = (color: string) => {
    setNewTag({ ...newTag, color });
    setIsColorPickerOpen(false);
  };

  return (
    <>
      <form 
        data-testid="add-tag-form-element"
        onSubmit={handleSubmit} 
        className="flex flex-col sm:flex-row gap-4 mb-6 p-5 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm"
      >
        <div className="flex-1 flex flex-col">
          <label htmlFor="tagName" className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            <span suppressHydrationWarning={true}>{t('settings.tagName')}</span>
          </label>
          <input
            id="tagName"
            type="text"
            value={newTag.name}
            onChange={(e) => setNewTag({ ...newTag, name: e.target.value })}
            placeholder={placeholder}
            className="p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 
                      focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200"
          />
        </div>
        
        <div className="flex items-end gap-3">
          <div className="flex flex-col">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              <span suppressHydrationWarning={true}>{t('settings.tagColor')}</span>
            </label>
            <button
              type="button"
              onClick={() => setIsColorPickerOpen(true)}
              className="w-14 h-10 rounded-lg cursor-pointer border border-gray-300 dark:border-gray-600 shadow-sm
                        hover:shadow-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              style={{ backgroundColor: newTag.color }}
              aria-label={t('settings.selectColor')}
            />
          </div>
          
          <button
            type="submit"
            className="h-10 px-4 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
                      disabled:bg-gray-400 disabled:hover:bg-gray-400 disabled:dark:bg-gray-600 transition-colors"
            disabled={!newTag.name.trim()}
          >
            <span suppressHydrationWarning={true}>{t('settings.addTag')}</span>
          </button>
        </div>
      </form>

      {isColorPickerOpen && (
        <ColorPickerModal 
          tagName={newTag.name || t('settings.newTag')}
          initialColor={newTag.color}
          onOk={handleColorSelect}
          onCancel={() => setIsColorPickerOpen(false)}
        />
      )}
    </>
  );
};

export default AddTagForm; 