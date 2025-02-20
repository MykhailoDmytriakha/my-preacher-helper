"use client";

import { formatDate } from "@utils/dateFormatter";
import { TrashIcon, EditIcon } from "@components/Icons";
import { Thought } from "@/models/models";
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
  onDelete: (index: number) => void;
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
              padding: '0.25rem 0.5rem',
              borderRadius: '9999px',
              fontSize: '0.875rem',
              color: getContrastColor(tagInfo.color)
            }}
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
            className={`text-sm px-2 py-1 rounded-full ${bgClass} ${textClass}`}
          >
            {tag}
          </span>
        );
      }
    });
  };

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
          <p className="font-medium">{t('thought.tagsLabel')}</p>
          <div className="flex flex-wrap gap-2 mt-1">
            {editingTags.map((tag, idx) => {
              const tagInfo = allowedTags.find(t => t.name === tag);
              return (
                <div
                  key={`${tag}-${idx}`}
                  className="cursor-pointer flex items-center px-2 py-1 rounded-full"
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
          <div className="flex flex-wrap gap-2">
            {allowedTags
              .filter((t) => !editingTags.includes(t.name))
              .map((t) => (
                <div
                  key={t.name}
                  className="cursor-pointer flex items-center px-2 py-1 rounded-full"
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
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {formatDate(thought.date)}
            </span>
            {/* Delete Button */}
            <button
              onClick={() => onDelete(index)}
              className="hover:bg-red-200 text-white p-2 rounded"
              style={{ marginLeft: "2px" }}
            >
              <TrashIcon className="w-4 h-4" fill="gray" />
            </button>
            {/* Edit Button */}
            <button
              onClick={() => onEditStart(thought, index)}
              className="hover:bg-blue-200 text-white p-2 rounded"
              style={{ marginLeft: "2px" }}
            >
              <EditIcon className="w-4 h-4" fill="gray" />
            </button>
          </div>
          {/* Tags */}
          {thought.tags && thought.tags.length > 0 && (
            <div className="flex gap-2">
              {renderTags(thought.tags)}
            </div>
          )}
        </div>
        {/* Thought Text */}
        <p className="text-gray-800 dark:text-gray-200">{thought.text}</p>

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