'use client';

import { User } from 'firebase/auth';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useTags } from '@/hooks/useTags';
import { Tag } from '@/models/models';
import { awaitAcceptance, refusedWrite, type WriteSubmission } from '@/utils/recoverableWrite';
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

  const handleAddTag = (name: string, color: string): WriteSubmission => {
    // No signed-in user means nothing holds this tag name — refuse, so the form keeps it
    // instead of clearing over a write that never existed.
    if (!user?.uid) return refusedWrite('unauthenticated', 'No signed-in user for this write', t('writeRecovery.refused'));
    
    const newTagObj: Tag = {
      id: '',
      userId: user.uid,
      name: name,
      color: color,
      required: false,
    };
    
    /**
     * Only the case this form alone can explain. A reserved name is not a write that
     * failed — it is input this app will not accept, and the person needs to know THAT
     * rather than "could not save". Everything else is reported by the recovery
     * descriptor in `useTags`, which carries the tag name and follows the person off
     * this page; announcing both showed one failed write as two failures.
     */
    const reportFailure = (error: unknown) => {
      console.error('Error adding tag:', error);
      if ((error as { message?: string } | null)?.message === 'Reserved tag name') {
        toast.error(t('errors.reservedTagName'));
      }
    };

    const submission = addCustomTag(newTagObj);
    // The form awaits ACCEPTANCE itself and keeps the draft when it rejects; this only
    // adds the one explanation the form alone can give.
    void submission.acceptance.catch(reportFailure);
    return submission;
  };

  const handleRemoveTag = async (tagName: string) => {
    // Reported by the remove descriptor in useTags — see the note above.
    const reportFailure = (error: unknown) => {
      console.error('Error removing tag:', error);
    };

    try {
      if (user?.uid) {
        await awaitAcceptance(removeCustomTag(tagName), reportFailure);
      }
    } catch (error) {
      reportFailure(error);
    }
  };

  const openColorPicker = (tag: Tag) => {
    setCurrentTagBeingEdited(tag);
  };

  const handleUpdateColor = async (newColor: string) => {
    if (!currentTagBeingEdited || !user?.uid) return;
    const updatedTag = { ...currentTagBeingEdited, color: newColor };
    // Queued acceptance means a refused colour change comes back LATE; without a
    // reporter there the tag keeps the new colour and nobody is told.
    // Reported by the update descriptor in useTags — see the note above.
    const reportColorFailure = (error: unknown) => {
      console.error("Error updating tag color:", error);
    };

    try {
      await awaitAcceptance(updateTag(updatedTag), reportColorFailure);
    } catch (error) {
      reportColorFailure(error);
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
