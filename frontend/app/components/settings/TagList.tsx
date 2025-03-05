'use client';

import React, { useState, useEffect } from 'react';
import { Tag } from '@/models/models';
import { useTranslation } from 'react-i18next';
import { TrashIcon, PencilIcon } from '@components/Icons';

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
  const [editTitle, setEditTitle] = useState('');

  useEffect(() => {
    // Set titles on the client side to avoid hydration mismatch
    setDeleteTitle(t('settings.deleteTag'));
    setEditTitle(t('settings.editColor'));
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
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
      {tags.map((tag) => (
        <div
          key={tag.name}
          className="flex items-center p-4 border border-gray-200 dark:border-gray-700 rounded-lg 
                   bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750 
                   transition-colors shadow-sm"
        >
          <div 
            className={`
              relative flex-shrink-0 w-12 h-12 rounded-lg mr-4 shadow-sm
              ${editable && onEditColor ? 'cursor-pointer group' : ''}
            `}
            style={{ backgroundColor: tag.color }}
            onClick={editable && onEditColor ? () => onEditColor(tag) : undefined}
            title={editable && onEditColor ? editTitle : undefined}
          >
            {/* Color edit overlay that appears on hover */}
            {editable && onEditColor && (
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 
                            rounded-lg flex items-center justify-center transition-all duration-200">
                <PencilIcon className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
          </div>
          
          <div className="flex-1">
            <h3 className="text-gray-800 dark:text-gray-200 font-medium">{tag.name}</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">{tag.color}</p>
          </div>
          
          {editable && onRemoveTag && (
            <button
              onClick={() => onRemoveTag(tag.name)}
              className="ml-auto text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 
                       p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={deleteTitle}
              aria-label={`${t('settings.deleteTag')} ${tag.name}`}
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