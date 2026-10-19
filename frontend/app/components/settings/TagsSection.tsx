'use client';

import { User } from 'firebase/auth';
import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import ConfirmModal from '@/components/ui/ConfirmModal';
import { useTags } from '@/hooks/useTags';
import { Tag } from '@/models/models';
import { awaitWriteOperation, refusedWrite, type WriteOperation } from '@/utils/recoverableWrite';
import ColorPickerModal from '@components/ColorPickerModal';
import { useTranslation } from '@locales/useTranslation';

import AddTagForm from './AddTagForm';
import TagList from './TagList';


const TAG_SAVE_ERROR = 'common.saveError';

type TagSelection = { owner: string; tag: Tag };
type TagAction = { owner: string; kind: 'color' | 'delete' };

interface TagsSectionProps {
  user: User | null;
}

const TagsSection: React.FC<TagsSectionProps> = ({ user }) => {
  const { t } = useTranslation();
  const [colorSelection, setColorSelection] = useState<TagSelection | null>(null);
  const [deleteSelection, setDeleteSelection] = useState<TagSelection | null>(null);
  const [pendingAction, setPendingAction] = useState<TagAction | null>(null);
  const pendingActionRef = useRef<TagAction | null>(null);
  const { tags, addCustomTag, removeCustomTag, updateTag } = useTags(user?.uid);
  const ownerRef = useRef(user?.uid);
  ownerRef.current = user?.uid;
  const customTagsRef = useRef(tags.customTags);
  customTagsRef.current = tags.customTags;

  const currentTagBeingEdited = colorSelection && colorSelection.owner === user?.uid ? colorSelection.tag : null;
  const pendingDelete = deleteSelection && deleteSelection.owner === user?.uid ? deleteSelection.tag : null;
  const isSavingColor = pendingAction?.owner === user?.uid && pendingAction?.kind === 'color';
  const isDeleting = pendingAction?.owner === user?.uid && pendingAction?.kind === 'delete';

  useEffect(() => {
    setColorSelection(null);
    setDeleteSelection(null);
  }, [user?.uid]);

  // Pending UI belongs to one owner/run; an old completion cannot unlock a later action.
  const beginAction = (kind: TagAction['kind']): TagAction | null => {
    const owner = user?.uid;
    if (!owner || pendingActionRef.current?.owner === owner) return null;
    const action = { owner, kind };
    pendingActionRef.current = action;
    setPendingAction(action);
    return action;
  };
  const finishAction = (action: TagAction) => {
    if (pendingActionRef.current !== action) return;
    pendingActionRef.current = null;
    setPendingAction(current => current === action ? null : current);
  };

  const handleAddTag = (name: string, color: string): WriteOperation => {
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
    
    // This owner explains a failed capture; the form retains the name and colour.
    const reportFailure = (error: unknown) => {
      console.error('Error adding tag:', error);
      const key = (error as { message?: string } | null)?.message === 'Reserved tag name'
        ? 'errors.reservedTagName' : TAG_SAVE_ERROR;
      toast.error(t(key));
    };
    const submission = addCustomTag(newTagObj);
    void awaitWriteOperation(submission, reportFailure).catch(reportFailure);
    return submission;
  };

  const handleRemoveTag = (tagName: string) => {
    const owner = user?.uid;
    const tag = tags.customTags.find(candidate => candidate.name === tagName);
    if (!owner || !tag || pendingActionRef.current?.owner === owner) return;
    setDeleteSelection({ owner, tag });
  };

  const confirmDelete = async () => {
    const selection = deleteSelection;
    if (!selection || selection.owner !== user?.uid) return;
    const latest = customTagsRef.current.find(tag => tag.id === selection.tag.id && tag.name === selection.tag.name);
    if (!latest) { setDeleteSelection(null); return; }
    const action = beginAction('delete');
    if (!action) return;
    const reportFailure = (error: unknown) => {
      if (ownerRef.current !== action.owner) return;
      console.error('Error removing tag:', error);
      toast.error(t(TAG_SAVE_ERROR));
    };
    try {
      await awaitWriteOperation(removeCustomTag(latest.name), reportFailure);
      if (ownerRef.current === action.owner) {
        setDeleteSelection(current => current === selection ? null : current);
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction(action);
    }
  };

  const openColorPicker = (tag: Tag) => {
    const owner = user?.uid;
    if (owner && pendingActionRef.current?.owner !== owner) setColorSelection({ owner, tag });
  };

  const handleUpdateColor = async (newColor: string) => {
    const selection = colorSelection;
    if (!selection || selection.owner !== user?.uid) return;
    const action = beginAction('color');
    if (!action) return;
    const reportFailure = (error: unknown) => {
      if (ownerRef.current !== action.owner) return;
      console.error('Error updating tag color:', error);
      toast.error(t(TAG_SAVE_ERROR));
    };
    try {
      await awaitWriteOperation(updateTag({ ...selection.tag, color: newColor }), reportFailure);
      if (ownerRef.current === action.owner) {
        setColorSelection(current => current === selection ? null : current);
      }
    } catch (error) {
      reportFailure(error);
    } finally {
      finishAction(action);
    }
  };

  const handleCancelColorUpdate = () => {
    if (!isSavingColor) setColorSelection(null);
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
          key={`${user?.uid}:${currentTagBeingEdited.id}`}
          isSaving={isSavingColor}
          tagName={currentTagBeingEdited.name}
          initialColor={currentTagBeingEdited.color}
          onOk={handleUpdateColor}
          onCancel={handleCancelColorUpdate}
        />
      )}
      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => { if (!isDeleting) setDeleteSelection(null); }}
        onConfirm={confirmDelete}
        title={t('common.deleteItem.title')}
        description={t('common.deleteItem.description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        isDeleting={isDeleting}
      />
    </div>
  );
};

export default TagsSection;
