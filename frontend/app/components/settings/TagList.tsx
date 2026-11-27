'use client';

import React, { useState, useEffect } from 'react';

import hoverActions from '@/components/ui/HoverActions.module.css';
import { Tag } from '@/models/models';
import { TrashIcon, PencilIcon } from '@components/Icons';
import { useTranslation } from '@locales/useTranslation';

interface TagListProps {
  tags: Tag[];
  editable?: boolean;
  onEditColor?: (tag: Tag) => void;
  renderDetails?: (tag: Tag) => React.ReactNode;
  onRemoveTag?: (tagId: string) => void;
}

const TagList: React.FC<TagListProps> = ({ 
  tags, 
  editable = false, 
  onEditColor,
  renderDetails,
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
          key={tag.id}
          className={`flex items-center rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition-colors
                   hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-750 ${hoverActions.row}`}
        >
          <div 
            data-testid="tag-color-preview"
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
          
          <div className="min-w-0 flex-1">
            <h3 className="text-gray-800 dark:text-gray-200 font-medium [overflow-wrap:anywhere]">
              {tag.translationKey ? t(tag.translationKey) : tag.name}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">{tag.color}</p>
            {renderDetails?.(tag)}
          </div>
          
          {editable && onRemoveTag && (
            <button
              onClick={() => onRemoveTag(tag.id)}
              className={`ml-auto shrink-0 rounded-full p-2 text-red-600 transition-colors hover:bg-gray-200
                       hover:text-red-700 dark:text-red-400 dark:hover:bg-gray-600 dark:hover:text-red-300 ${hoverActions.actions}`}
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