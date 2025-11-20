"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Thought, SermonOutline } from '@/models/models';
import { createManualThought } from '@services/thought.service';
import { getSermonById } from '@services/sermon.service';
import { getTags } from '@services/tag.service';
import { PlusIcon } from '@components/Icons';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import "@locales/i18n";
import { toast } from 'sonner';
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag } from "@utils/tagUtils";

interface AddThoughtManualProps {
  sermonId: string;
  onNewThought: (thought: Thought) => void;
  // Optional preloaded data to avoid fetching on open
  allowedTags?: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
}

export default function AddThoughtManual({ sermonId, onNewThought, allowedTags: allowedTagsProp, sermonOutline: sermonOutlineProp }: AddThoughtManualProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | undefined>();
  const [sermonOutlineState, setSermonOutlineState] = useState<SermonOutline | undefined>(sermonOutlineProp);
  const [allowedTagsState, setAllowedTagsState] = useState<{ name: string; color: string; translationKey?: string }[]>(allowedTagsProp || []);
  const [loading, setLoading] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load sermon data and tags early (on mount or when needed) if not provided via props
  const loadSermonData = useCallback(async () => {
    setLoading(true);
    try {
      // Skip fetching if props already have data
      if (sermonOutlineProp && (allowedTagsProp && allowedTagsProp.length > 0)) {
        return;
      }

      const sermon = await getSermonById(sermonId);
      if (!sermon) return;

      // SermonOutline
      if (!sermonOutlineProp) setSermonOutlineState(sermon.outline);

      // Tags using sermon's userId
      if (!allowedTagsProp || allowedTagsProp.length === 0) {
        const tagsData = await getTags(sermon.userId);
        const allTags = [
          ...(tagsData.requiredTags || []),
          ...(tagsData.customTags || [])
        ];
        setAllowedTagsState(allTags);
      }
    } catch (error) {
      console.error("Error loading sermon data:", error);
      toast.error(t('errors.loadDataError') || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [sermonId, t, allowedTagsProp, sermonOutlineProp]);

  // Preload on mount when data isn't provided
  useEffect(() => {
    if (!sermonOutlineProp || !allowedTagsProp || allowedTagsProp.length === 0) {
      loadSermonData();
    }
  }, [loadSermonData, sermonOutlineProp, allowedTagsProp]);

  // If user clicked the button before data finished loading, open once ready
  useEffect(() => {
    if (!loading && pendingOpen) {
      setOpen(true);
      setPendingOpen(false);
    }
  }, [loading, pendingOpen]);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleSermonPointChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSermonPointId(value === "" ? undefined : value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const newThought: Thought = {
      id: '',
      text: trimmedText,
      tags: tags,
      date: new Date().toISOString(),
      outlinePointId: selectedSermonPointId
    };

    try {
      setIsSubmitting(true);
      const savedThought = await createManualThought(sermonId, newThought);
      onNewThought(savedThought);
      toast.success(t('manualThought.addedSuccess'));
      setText("");
      setTags([]);
      setSelectedSermonPointId(undefined);
      setOpen(false);
    } catch (error) {
      console.error("Error adding thought manually:", error);
      toast.error(t('errors.addThoughtError') || 'Failed to add thought. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create a flat array of all outline points with section information
  const effectiveOutline: SermonOutline | undefined = useMemo(() => sermonOutlineProp || sermonOutlineState, [sermonOutlineProp, sermonOutlineState]);
  const effectiveAllowedTags = useMemo(() => allowedTagsProp && allowedTagsProp.length > 0 ? allowedTagsProp : allowedTagsState, [allowedTagsProp, allowedTagsState]);

  const allSermonPoints: { id: string; text: string; section: string }[] = [];
  
  if (effectiveOutline) {
    if (effectiveOutline.introduction && Array.isArray(effectiveOutline.introduction)) {
      effectiveOutline.introduction.forEach(point => {
        allSermonPoints.push({ ...point, section: t('outline.introduction') });
      });
    }
    
    if (effectiveOutline.main && Array.isArray(effectiveOutline.main)) {
      effectiveOutline.main.forEach(point => {
        allSermonPoints.push({ ...point, section: t('outline.mainPoints') });
      });
    }
    
    if (effectiveOutline.conclusion && Array.isArray(effectiveOutline.conclusion)) {
      effectiveOutline.conclusion.forEach(point => {
        allSermonPoints.push({ ...point, section: t('outline.conclusion') });
      });
    }
  }

  // Find the selected outline point text for display
  const selectedPointInfo = allSermonPoints.find(point => point.id === selectedSermonPointId);

  const availableTags = effectiveAllowedTags.filter(t => !tags.includes(t.name));

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="manual-thought-modal-title"
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="manual-thought-modal-title" className="text-2xl font-bold mb-6">{t('manualThought.addManual')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
            <div className="mb-6 flex-grow overflow-auto">
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.textLabel') || 'Text'}</label>
                <TextareaAutosize
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('manualThought.placeholder')}
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
                  minRows={3}
                  maxRows={16}
                  required
                />
              </div>

              {effectiveOutline && (
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.outlinePointLabel') || 'SermonOutline Point'}</label>
                  <select
                    value={selectedSermonPointId || ""}
                    onChange={handleSermonPointChange}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200"
                    disabled={loading}
                  >
                    <option value="">{t('editThought.noSermonPoint') || 'No outline point selected'}</option>
                    
                    {/* Group outline points by section */}
                    {Object.entries({
                      introduction: effectiveOutline.introduction || [],
                      main: effectiveOutline.main || [],
                      conclusion: effectiveOutline.conclusion || []
                    }).map(([section, points]) => 
                      points.length > 0 ? (
                        <optgroup key={section} label={t(`outline.${section === 'main' ? 'mainPoints' : section}`) || section}>
                          {points.map(point => (
                            <option key={point.id} value={point.id}>{point.text}</option>
                          ))}
                        </optgroup>
                      ) : null
                    )}
                  </select>
                  
                  {selectedPointInfo && (
                    <p className="mt-1 text-sm text-gray-500">
                      {t('editThought.selectedSermonPoint', { section: selectedPointInfo.section }) || `Selected outline point from ${selectedPointInfo.section}`}
                    </p>
                  )}
                </div>
              )}

              <div className="mb-4">
                <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('thought.tagsLabel')}</p>
                <div className="flex flex-wrap gap-1.5 max-h-[20vh] overflow-auto overflow-x-hidden">
                  {tags.map((tag, idx) => {
                    const tagInfo = effectiveAllowedTags.find(t => t.name === tag);
                    let displayName = tag;
                    const structureTagStatus = isStructureTag(tag);
                    
                    if (tagInfo?.translationKey) {
                      displayName = t(tagInfo.translationKey);
                    } else {
                      const canonical = normalizeStructureTag(tag);
                      if (canonical === 'intro') displayName = t('tags.introduction');
                      else if (canonical === 'main') displayName = t('tags.mainPart');
                      else if (canonical === 'conclusion') displayName = t('tags.conclusion');
                    }
                    
                    const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);
                    const className = `cursor-pointer ${baseClassName}`;
                    const iconInfo = structureTagStatus ? getStructureIcon(tag) : null;
                    
                    return (
                      <div
                        key={tag + idx}
                        onClick={() => handleRemoveTag(idx)}
                        className={className}
                        style={style}
                        role="button"
                        aria-label={`Remove tag ${displayName}`}
                      >
                        {iconInfo && (
                          <span className={iconInfo.className} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
                        )}
                        <span>{displayName}</span>
                        <span className="ml-1">×</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2 mb-1">{t('editThought.availableTags')}</p>
                <div className="flex flex-wrap gap-1.5 overflow-x-hidden">
                  {availableTags.map(tag => {
                    let displayName = tag.name;
                    const structureTagStatus = isStructureTag(tag.name);
                    
                    if (tag.translationKey) {
                      displayName = t(tag.translationKey);
                    } else {
                      const canonical = normalizeStructureTag(tag.name);
                      if (canonical === 'intro') displayName = t('tags.introduction');
                      else if (canonical === 'main') displayName = t('tags.mainPart');
                      else if (canonical === 'conclusion') displayName = t('tags.conclusion');
                    }
                    
                    const { className: baseClassName, style } = getTagStyle(tag.name, tag.color);
                    const className = `cursor-pointer ${baseClassName}`;
                    const iconInfo = structureTagStatus ? getStructureIcon(tag.name) : null;
                    
                    return (
                      <div
                        key={tag.name}
                        onClick={() => handleAddTag(tag.name)}
                        className={className}
                        style={style}
                        role="button"
                        aria-label={`Add tag ${displayName}`}
                      >
                        {iconInfo && (
                          <span className={iconInfo.className} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
                        )}
                        <span>{displayName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-auto">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
                disabled={isSubmitting}
              >
                {t('buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                disabled={isSubmitting || !text.trim() || loading}
              >
                {isSubmitting ? t('buttons.saving') : t('buttons.save')}
              </button>
            </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => {
          const hasDataReady = (effectiveAllowedTags && effectiveAllowedTags.length > 0) && Boolean(effectiveOutline);
          if (hasDataReady) {
            setOpen(true);
          } else {
            setPendingOpen(true);
            if (!loading) loadSermonData();
          }
        }}
        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-2 disabled:opacity-70"
        disabled={loading}
      >
        <PlusIcon className="w-5 h-5" />
        {loading ? t('settings.loading') : t('manualThought.addManual')}
      </button>
      {open && createPortal(modalContent, document.body)}
    </>
  );
}
