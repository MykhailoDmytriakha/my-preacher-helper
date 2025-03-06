"use client";

import { formatDate } from "@utils/dateFormatter";
import { TrashIcon, EditIcon, DocumentIcon } from "@components/Icons";
import { Thought, Outline, OutlinePoint } from "@/models/models";
import { useEffect, useRef } from "react";
import { getContrastColor } from "@utils/color";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

interface ThoughtCardProps {
  thought: Thought;
  index: number;
  editingIndex: number | null;
  editingText: string;
  editingTags: string[];
  hasRequiredTag: boolean;
  allowedTags: { name: string; color: string }[];
  currentTag: string;
  sermonOutline?: Outline;
  onDelete: (index: number, thoughtId: string) => void;
  onEditStart: (thought: Thought, index: number) => void;
  onEditCancel: () => void;
  onEditSave: () => void;
  onTextChange: (value: string) => void;
  onRemoveTag: (tagIndex: number) => void;
  onAddTag: (tag: string) => void;
  onTagSelectorChange: (value: string) => void;
  setCurrentTag: (value: string) => void;
}

export default function ThoughtCard({
  thought,
  index,
  editingIndex,
  editingText,
  editingTags,
  hasRequiredTag,
  allowedTags,
  currentTag,
  sermonOutline,
  onDelete,
  onEditStart,
  onEditCancel,
  onEditSave,
  onTextChange,
  onRemoveTag,
  onAddTag,
  onTagSelectorChange,
  setCurrentTag
}: ThoughtCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (editingIndex === index && textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editingText, editingIndex, index]);

  // Renders each tag with its styling
  const renderTags = (tags: string[]) => {
    return tags.map((tag) => {
      const tagInfo = allowedTags.find(t => t.name === tag);
      if (tagInfo && tagInfo.color) {
        return (
          <span
            key={tag}
            style={{
              backgroundColor: tagInfo.color,
              color: getContrastColor(tagInfo.color)
            }}
            className="text-xs px-2 py-0.5 rounded-full inline-flex items-center"
          >
            {tag}
          </span>
        );
      } else {
        let bgClass, textClass;
        if (tag === "Вступление") {
          bgClass = "bg-blue-100 dark:bg-blue-900";
          textClass = "text-blue-800 dark:text-blue-200";
        } else if (tag === "Основная часть") {
          bgClass = "bg-purple-100 dark:bg-purple-900";
          textClass = "text-purple-800 dark:text-purple-200";
        } else if (tag === "Заключение") {
          bgClass = "bg-green-100 dark:bg-green-900";
          textClass = "text-green-800 dark:text-green-200";
        } else {
          bgClass = "bg-indigo-100 dark:bg-indigo-900";
          textClass = "text-indigo-800 dark:text-indigo-200";
        }
        return (
          <span
            key={tag}
            className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center ${bgClass} ${textClass}`}
          >
            {tag}
          </span>
        );
      }
    });
  };

  // Find the associated outline point, if any
  const findOutlinePoint = (): { text: string; section: string } | undefined => {
    if (!thought.outlinePointId || !sermonOutline) return undefined;
    
    // Check in each section
    const introPoint = sermonOutline.introduction.find(p => p.id === thought.outlinePointId);
    if (introPoint) return { text: introPoint.text, section: t('outline.introduction') || 'Introduction' };
    
    const mainPoint = sermonOutline.main.find(p => p.id === thought.outlinePointId);
    if (mainPoint) return { text: mainPoint.text, section: t('outline.mainPoints') || 'Main Points' };
    
    const conclPoint = sermonOutline.conclusion.find(p => p.id === thought.outlinePointId);
    if (conclPoint) return { text: conclPoint.text, section: t('outline.conclusion') || 'Conclusion' };
    
    return undefined;
  };

  const outlinePoint = findOutlinePoint();

  if (editingIndex === index) {
    // Edit Mode
    return (
      <div
        className={`relative p-4 rounded-lg ${
          hasRequiredTag
            ? "bg-gray-50 dark:bg-gray-700"
            : "border border-red-500 bg-red-50 dark:bg-red-900"
        }`}
      >
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(thought.date)}
            </span>
            <span className="text-xs bg-gray-200 text-gray-700 px-1 rounded dark:bg-gray-600 dark:text-gray-300">
              ID: {thought.id.substring(0, 8)}...
            </span>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={editingText}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full p-2 border rounded mb-2 dark:bg-gray-800 dark:text-gray-200"
        />
        {/* Tags editing section */}
        <div className="mb-2">
          <p className="font-medium text-sm">{t('thought.tagsLabel')}</p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {editingTags.map((tag, idx) => {
              const tagInfo = allowedTags.find(t => t.name === tag);
              return (
                <div
                  key={`${tag}-${idx}`}
                  className="cursor-pointer flex items-center text-xs px-2 py-0.5 rounded-full"
                  onClick={() => onRemoveTag(idx)}
                  style={{ backgroundColor: tagInfo ? tagInfo.color : '#e0e0e0', color: getContrastColor(tagInfo ? tagInfo.color : '#e0e0e0') }}
                >
                  <span>{tag}</span>
                  <span className="ml-1">×</span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-500 mt-2 mb-1">{t('thought.availableTags')}</p>
          <div className="flex flex-wrap gap-1.5">
            {allowedTags
              .filter((t) => !editingTags.includes(t.name))
              .map((t) => (
                <div
                  key={t.name}
                  className="cursor-pointer flex items-center text-xs px-2 py-0.5 rounded-full"
                  onClick={() => onAddTag(t.name)}
                  style={{ backgroundColor: t.color, color: getContrastColor(t.color) }}
                >
                  <span>{t.name}</span>
                </div>
              ))
            }
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {t('thought.missingTags', { 
              link: `<a href="/settings" className="text-blue-600 hover:underline">${t('settings.title')}</a>`
            })}
          </p>
        </div>
        {/* Save/Cancel Buttons */}
        <div className="flex gap-2">
          <button
            onClick={onEditSave}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            {t('buttons.save')}
          </button>
          <button
            onClick={onEditCancel}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t('buttons.cancel')}
          </button>
        </div>
      </div>
    );
  } else {
    // View Mode
    return (
      <div
        className={`relative p-4 rounded-lg ${
          hasRequiredTag
            ? "bg-gray-50 dark:bg-gray-700"
            : "border border-red-500 bg-red-50 dark:bg-red-900"
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(thought.date)}
            </span>
            {/* Delete Button */}
            <button
              onClick={() => onDelete(index, thought.id)}
              className="text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 p-1 rounded-full transition-colors"
            >
              <TrashIcon/>
            </button>
            {/* Edit Button */}
            <button
              onClick={() => {
                onEditStart(thought, index);
              }}
              className="text-gray-500 hover:text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 p-1.5 rounded-full transition-colors"
            >
              <EditIcon className="w-5 h-5" />
            </button>
            {/* Show thought ID for debugging */}
            <span className="text-xs bg-gray-200 text-gray-700 px-1 rounded dark:bg-gray-600 dark:text-gray-300">
              ID: {thought.id}
            </span>
          </div>
          {/* Tags */}
          {thought.tags && thought.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {renderTags(thought.tags)}
            </div>
          )}
        </div>

        <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
          {thought.text}
        </p>

        {/* Display associated outline point if available */}
        {outlinePoint && (
          <div className="mt-3">
            <span className="text-sm inline-block rounded-md px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800">
              {outlinePoint.section}: {outlinePoint.text}
            </span>
          </div>
        )}

        {/* Warning if no required tag */}
        {!hasRequiredTag && (
          <p className="text-red-500 text-sm mt-2">
            {t('thought.missingRequiredTag', {
              intro: t('tags.introduction'),
              main: t('tags.mainPart'), 
              conclusion: t('tags.conclusion')
            })}
          </p>
        )}
      </div>
    );
  }
}