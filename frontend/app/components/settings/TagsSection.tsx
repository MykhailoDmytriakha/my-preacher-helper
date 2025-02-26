'use client';

import React, { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { Tag } from '@/models/models';
import { getTags, addCustomTag, removeCustomTag, updateTag } from '@/services/tag.service';
import TagList from './TagList';
import AddTagForm from './AddTagForm';
import ColorPickerModal from '@components/ColorPickerModal';
import { useTranslation } from 'react-i18next';

interface TagsSectionProps {
  user: User | null;
}

const TagsSection: React.FC<TagsSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState<{ requiredTags: Tag[]; customTags: Tag[] }>({ requiredTags: [], customTags: [] });
  const [currentTagBeingEdited, setCurrentTagBeingEdited] = useState<Tag | null>(null);

  useEffect(() => {
    async function fetchTags() {
      try {
        if (user?.uid) {
          const tagsData = await getTags(user.uid);
          setTags(tagsData);
        }
      } catch (error) {
        console.error('Error fetching tags:', error);
      }
    }
    fetchTags();
  }, [user]);

  const handleAddTag = async (name: string, color: string) => {
    if (!user?.uid) return;
    
    const newTagObj: Tag = {
      id: '',
      userId: user.uid,
      name: name,
      color: color,
      required: false,
    };
    
    await addCustomTag(newTagObj);
    try {
      const tagsData = await getTags(user.uid);
      setTags(tagsData);
    } catch (error) {
      console.error('Error updating tags:', error);
    }
  };

  const handleRemoveTag = async (tagName: string) => {
    try {
      if (user?.uid) {
        await removeCustomTag(user.uid, tagName);
        const tagsData = await getTags(user.uid);
        setTags(tagsData);
      }
    } catch (error) {
      console.error('Error removing tag:', error);
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
      const tagsData = await getTags(user.uid);
      setTags(tagsData);
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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-xl font-semibold mb-6">
        <span suppressHydrationWarning={true}>{t('settings.manageTags')}</span>
      </h2>
      
      <div className="max-w-3xl">
        {/* Required Tags */}
        <div className="mb-8">
          <h3 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">
            <span suppressHydrationWarning={true}>{t('settings.requiredTags')}</span>
          </h3>
          <TagList tags={tags.requiredTags} />
        </div>

        {/* Custom Tags */}
        <div>
          <h3 className="text-lg font-medium mb-4 text-gray-700 dark:text-gray-300">
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