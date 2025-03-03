'use client';

import React, { useState, useEffect } from 'react';
import { Tag } from '@/models/models';
import { useTranslation } from 'react-i18next';
import { TrashIcon } from '@components/Icons';

interface TagListProps {
  tags: Tag[];
  editable?: boolean;
  onEditColor?: (tag: Tag) => void;
  onRemoveTag?: (tagName: string) => void;
}

const TagList: React.FC<TagListProps> = ({ 
  tags, 
  editable = false, 
  onEditColor, 
  onRemoveTag 
}) => {
  const { t } = useTranslation();
  const [deleteTitle, setDeleteTitle] = useState('');

  useEffect(() => {
    // Set title on the client side to avoid hydration mismatch
    setDeleteTitle(t('settings.deleteTag'));
  }, [t]);

  if (tags.length === 0) {
    return (
      <div className="text-gray-500 dark:text-gray-400 italic mb-4">
        <span suppressHydrationWarning={true}>
          {editable 
            ? t('settings.noCustomTags') 
            : t('settings.noRequiredTags')}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-3 mb-6">
      {tags.map((tag) => (
        <div
          key={tag.name}
          className="flex items-center p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-750 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <div
            className="w-6 h-6 rounded-full mr-3 flex-shrink-0 shadow-sm"
            style={{ backgroundColor: tag.color }}
          />
          <span className="text-gray-800 dark:text-gray-200 font-medium">{tag.name}</span>
          
          {editable && onEditColor && (
            <button
              onClick={() => onEditColor(tag)}
              className="ml-4 px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <span suppressHydrationWarning={true}>{t('settings.editColor')}</span>
            </button>
          )}
          
          {editable && onRemoveTag && (
            <button
              onClick={() => onRemoveTag(tag.name)}
              className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 p-1.5 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={deleteTitle}
            >
              <TrashIcon className="w-5 h-5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default TagList; 