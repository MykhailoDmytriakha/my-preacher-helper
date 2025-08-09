"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { Thought, Outline } from '@/models/models';
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
}

export default function AddThoughtManual({ sermonId, onNewThought }: AddThoughtManualProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [selectedOutlinePointId, setSelectedOutlinePointId] = useState<string | undefined>();
  const [sermonOutline, setSermonOutline] = useState<Outline | undefined>();
  const [allowedTags, setAllowedTags] = useState<{ name: string; color: string; translationKey?: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load sermon data and tags when modal opens
  const loadSermonData = useCallback(async () => {
    setLoading(true);
    try {
      // Load sermon to get outline and userId
      const sermon = await getSermonById(sermonId);
      if (sermon) {
        setSermonOutline(sermon.outline);
        
        // Load tags using sermon's userId
        const tagsData = await getTags(sermon.userId);
        const allTags = [
          ...(tagsData.requiredTags || []),
          ...(tagsData.customTags || [])
        ];
        setAllowedTags(allTags);
      }
    } catch (error) {
      console.error("Error loading sermon data:", error);
      toast.error(t('errors.loadDataError') || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, [sermonId, t]);

  useEffect(() => {
    if (open) {
      loadSermonData();
    }
  }, [open, loadSermonData]);

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleOutlinePointChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedOutlinePointId(value === "" ? undefined : value);
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
      outlinePointId: selectedOutlinePointId
    };

    try {
      setIsSubmitting(true);
      const savedThought = await createManualThought(sermonId, newThought);
      onNewThought(savedThought);
      toast.success(t('manualThought.addedSuccess'));
      setText("");
      setTags([]);
      setSelectedOutlinePointId(undefined);
      setOpen(false);
    } catch (error) {
      console.error("Error adding thought manually:", error);
      toast.error(t('errors.addThoughtError') || 'Failed to add thought. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create a flat array of all outline points with section information
  const allOutlinePoints: { id: string; text: string; section: string }[] = [];
  
  if (sermonOutline) {
    if (sermonOutline.introduction && Array.isArray(sermonOutline.introduction)) {
      sermonOutline.introduction.forEach(point => {
        allOutlinePoints.push({ ...point, section: t('outline.introduction') });
      });
    }
    
    if (sermonOutline.main && Array.isArray(sermonOutline.main)) {
      sermonOutline.main.forEach(point => {
        allOutlinePoints.push({ ...point, section: t('outline.mainPoints') });
      });
    }
    
    if (sermonOutline.conclusion && Array.isArray(sermonOutline.conclusion)) {
      sermonOutline.conclusion.forEach(point => {
        allOutlinePoints.push({ ...point, section: t('outline.conclusion') });
      });
    }
  }

  // Find the selected outline point text for display
  const selectedPointInfo = allOutlinePoints.find(point => point.id === selectedOutlinePointId);

  const availableTags = allowedTags.filter(t => !tags.includes(t.name));

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 flex items-center gap-2"
      >
        <PlusIcon className="w-5 h-5" />
        {t('manualThought.addManual')}
      </button>
      {open && (
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
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              </div>
            ) : (
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

                  {sermonOutline && (
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.outlinePointLabel') || 'Outline Point'}</label>
                      <select
                        value={selectedOutlinePointId || ""}
                        onChange={handleOutlinePointChange}
                        className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200"
                      >
                        <option value="">{t('editThought.noOutlinePoint') || 'No outline point selected'}</option>
                        
                        {/* Group outline points by section */}
                        {Object.entries({
                          introduction: sermonOutline.introduction || [],
                          main: sermonOutline.main || [],
                          conclusion: sermonOutline.conclusion || []
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
                          {t('editThought.selectedOutlinePoint', { section: selectedPointInfo.section }) || `Selected outline point from ${selectedPointInfo.section}`}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="mb-4">
                    <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('thought.tagsLabel')}</p>
                    <div className="flex flex-wrap gap-1.5 max-h-[20vh] overflow-auto overflow-x-hidden">
                      {tags.map((tag, idx) => {
                        const tagInfo = allowedTags.find(t => t.name === tag);
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
                    disabled={isSubmitting || !text.trim()}
                  >
                    {isSubmitting ? t('buttons.saving') : t('buttons.save')}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
} 