"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import TextareaAutosize from 'react-textarea-autosize';
import { getContrastColor } from '@utils/color';
import { Thought, OutlinePoint, Outline } from '@/models/models';
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { isStructureTag, getStructureIcon, getTagStyle } from "@utils/tagUtils";

interface EditThoughtModalProps {
  thoughtId?: string;
  initialText: string;
  initialTags: string[];
  initialOutlinePointId?: string;
  allowedTags: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: Outline;
  containerSection?: string;
  onSave: (updatedText: string, updatedTags: string[], outlinePointId?: string) => void;
  onClose: () => void;
}

export default function EditThoughtModal({ 
  thoughtId, 
  initialText, 
  initialTags, 
  initialOutlinePointId,
  allowedTags, 
  sermonOutline,
  containerSection,
  onSave, 
  onClose 
}: EditThoughtModalProps) {
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedOutlinePointId, setSelectedOutlinePointId] = useState<string | undefined>(initialOutlinePointId);
  const isChanged = text !== initialText || 
                    tags.length !== initialTags.length || 
                    tags.some((tag, index) => tag !== initialTags[index]) ||
                    selectedOutlinePointId !== initialOutlinePointId;
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleSave = () => {
    setIsSubmitting(true);
    try {
      onSave(text, tags, selectedOutlinePointId);
      onClose();
    } catch (error) {
      console.error("Error saving thought:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Create a flat array of all outline points with section information
  const allOutlinePoints: { id: string; text: string; section: string }[] = [];
  
  if (sermonOutline) {
    // Add null checks for each section before using forEach
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

  // Determine which outline points to show based on containerSection
  let filteredOutlinePoints: Record<string, OutlinePoint[]> = {};
  
  if (sermonOutline) {
    if (containerSection === 'introduction' || containerSection === 'main' || containerSection === 'conclusion') {
      // Only show points from current section
      const sectionPoints = sermonOutline[containerSection as keyof Outline];
      if (sectionPoints && Array.isArray(sectionPoints)) {
        filteredOutlinePoints = {
          [containerSection]: sectionPoints
        };
      }
    } else {
      // If in ambiguous section or containerSection is unknown, show all points
      filteredOutlinePoints = {
        introduction: Array.isArray(sermonOutline.introduction) ? sermonOutline.introduction : [],
        main: Array.isArray(sermonOutline.main) ? sermonOutline.main : [],
        conclusion: Array.isArray(sermonOutline.conclusion) ? sermonOutline.conclusion : []
      };
    }
  }

  const availableTags = allowedTags.filter(t => !tags.includes(t.name));

  const modalContent = (
    <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-8 w-full max-w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t('editThought.editTitle')}</h2>
        <div className="mb-4 flex-grow overflow-auto">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.textLabel')}</label>
          <TextareaAutosize
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
            minRows={3}
            maxRows={16}
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
              {Object.entries(filteredOutlinePoints).map(([section, points]) => 
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
          <div className="flex flex-wrap gap-1.5 max-h-[20vh] overflow-auto">
            {tags.map((tag, idx) => {
              const tagInfo = allowedTags.find(t => t.name === tag);
              // Get display name (translated if available)
              let displayName = tag;
              const structureTagStatus = isStructureTag(tag);
              
              if (tagInfo?.translationKey) {
                displayName = t(tagInfo.translationKey);
              } else if (tag.toLowerCase() === "intro" || tag.toLowerCase() === "вступление") {
                displayName = t('tags.introduction');
              } else if (tag.toLowerCase() === "main" || tag.toLowerCase() === "основная часть") {
                displayName = t('tags.mainPart');
              } else if (tag.toLowerCase() === "conclusion" || tag.toLowerCase() === "заключение") {
                displayName = t('tags.conclusion');
              }
              
              // Get styling from our utilities
              const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);
              const className = `cursor-pointer ${baseClassName}`;
              
              // Get the structure icon if applicable
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
          <div className="flex flex-wrap gap-1.5">
            {availableTags.map(tag => {
              // Get display name (translated if available)
              let displayName = tag.name;
              const structureTagStatus = isStructureTag(tag.name);
              
              if (tag.translationKey) {
                displayName = t(tag.translationKey);
              } else if (tag.name.toLowerCase() === "intro" || tag.name.toLowerCase() === "вступление") {
                displayName = t('tags.introduction');
              } else if (tag.name.toLowerCase() === "main" || tag.name.toLowerCase() === "основная часть") {
                displayName = t('tags.mainPart');
              } else if (tag.name.toLowerCase() === "conclusion" || tag.name.toLowerCase() === "заключение") {
                displayName = t('tags.conclusion');
              }
              
              // Get styling from our utilities
              const { className: baseClassName, style } = getTagStyle(tag.name, tag.color);
              const className = `cursor-pointer ${baseClassName}`;
              
              // Get the structure icon if applicable
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
        <div className="flex justify-end gap-3 mt-auto">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </button>
          <button 
            type="button" 
            disabled={!isChanged || isSubmitting} 
            onClick={handleSave} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
          >
            {isSubmitting ? t('buttons.saving') : t('buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
} 