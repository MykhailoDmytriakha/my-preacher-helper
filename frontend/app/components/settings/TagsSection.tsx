'use client';

import { User } from 'firebase/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useTags } from '@/hooks/useTags';
import { Tag } from '@/models/models';
import ColorPickerModal from '@components/ColorPickerModal';

import AddTagForm from './AddTagForm';
import TagList from './TagList';


interface TagsSectionProps {
  user: User | null;
}

const TagsSection: React.FC<TagsSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const [currentTagBeingEdited, setCurrentTagBeingEdited] = useState<Tag | null>(null);
  const { tags, addCustomTag, removeCustomTag, updateTag } = useTags(user?.uid);

  const handleAddTag = async (name: string, color: string) => {
    if (!user?.uid) return;
    
    const newTagObj: Tag = {
      id: '',
      userId: user.uid,
      name: name,
      color: color,
      required: false,
    };
    
    try {
      await addCustomTag(newTagObj);
    } catch (error: unknown) {
      const err = error as { message?: string } | null;
      const message = err?.message === 'Reserved tag name'
        ? t('errors.reservedTagName')
        : (t('errors.savingError') || 'Error saving');
      toast.error(message);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    try {
      if (user?.uid) {
        const result = await removeCustomTag(tagName);
        if (result?.affectedThoughts != null) {
          const count = result.affectedThoughts as number;
          if (count > 0) {
            toast.success(`${count} ${t('structure.thoughts')} ${t('actions.remove').toLowerCase()}`);
          }
        }
      }
    } catch (error) {
      console.error('Error removing tag:', error);
      toast.error(t('errors.removingError') || 'Error removing');
    }
  };

  const openColorPicker = (tag: Tag) => {
    setCurrentTagBeingEdited(tag);
  };

  const handleUpdateColor = async (newColor: string) => {
    if (!currentTagBeingEdited || !user?.uid) return;
    const updatedTag = { ...currentTagBeingEdited, color: newColor };
    try {
      await updateTag(updatedTag);
    } catch (error) {
      console.error("Error updating tag color:", error);
    } finally {
      setCurrentTagBeingEdited(null);
    }
  };

  const handleCancelColorUpdate = () => {
    setCurrentTagBeingEdited(null);
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      <h2 className="text-lg md:text-xl font-semibold mb-4 md:mb-6">
        <span suppressHydrationWarning={true}>{t('settings.manageTags')}</span>
      </h2>
      
      <div className="max-w-3xl">
        {/* Required Tags */}
        <div className="mb-6 md:mb-8">
          <h3 className="text-base md:text-lg font-medium mb-3 md:mb-4 text-gray-700 dark:text-gray-300">
            <span suppressHydrationWarning={true}>{t('settings.requiredTags')}</span>
          </h3>
          <TagList tags={tags.requiredTags} />
        </div>

        {/* Custom Tags */}
        <div>
          <h3 className="text-base md:text-lg font-medium mb-3 md:mb-4 text-gray-700 dark:text-gray-300">
            <span suppressHydrationWarning={true}>{t('settings.customTags')}</span>
          </h3>
          
          {/* Add New Tag Form */}
          <AddTagForm onAddTag={handleAddTag} />

          {/* Custom Tags List */}
          <TagList 
            tags={tags.customTags}
            editable={true}
            onEditColor={openColorPicker}
            onRemoveTag={handleRemoveTag}
          />
        </div>
      </div>
      
      {/* Render ColorPickerModal when a tag is being edited */}
      {currentTagBeingEdited && (
        <ColorPickerModal
          tagName={currentTagBeingEdited.name}
          initialColor={currentTagBeingEdited.color}
          onOk={handleUpdateColor}
          onCancel={handleCancelColorUpdate}
        />
      )}
    </div>
  );
};

export default TagsSection; 