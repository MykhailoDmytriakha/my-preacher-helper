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
  allowedTags: { name: string; color: string; translationKey?: string }[];
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
      
      // Check if this is a required tag that should be translated
      let displayName = tag;
      if (tag.toLowerCase() === "intro" || tag.toLowerCase() === "вступление") {
        displayName = t('tags.introduction');
      } else if (tag.toLowerCase() === "main" || tag.toLowerCase() === "основная часть") {
        displayName = t('tags.mainPart');
      } else if (tag.toLowerCase() === "conclusion" || tag.toLowerCase() === "заключение") {
        displayName = t('tags.conclusion');
      }
      
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
            {tagInfo.translationKey ? t(tagInfo.translationKey) : displayName}
          </span>
        );
      } else {
        let bgClass, textClass;
        if (tag.toLowerCase() === "intro" || tag.toLowerCase() === "вступление") {
          bgClass = "bg-blue-100 dark:bg-blue-900";
          textClass = "text-blue-800 dark:text-blue-200";
        } else if (tag.toLowerCase() === "main" || tag.toLowerCase() === "основная часть") {
          bgClass = "bg-purple-100 dark:bg-purple-900";
          textClass = "text-purple-800 dark:text-purple-200";
        } else if (tag.toLowerCase() === "conclusion" || tag.toLowerCase() === "заключение") {
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
            {displayName}
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
    if (introPoint) return { text: introPoint.text, section: 'introduction' };
    
    const mainPoint = sermonOutline.main.find(p => p.id === thought.outlinePointId);
    if (mainPoint) return { text: mainPoint.text, section: 'main' };
    
    const conclPoint = sermonOutline.conclusion.find(p => p.id === thought.outlinePointId);
    if (conclPoint) return { text: conclPoint.text, section: 'conclusion' };
    
    return undefined;
  };

  const outlinePoint = findOutlinePoint();

  // Соответствие между секциями и тегами
  const sectionTagMapping: Record<string, string> = {
    'introduction': 'Вступление',
    'main': 'Основная часть',
    'conclusion': 'Заключение'
  };

  // Функция для проверки несогласованности между тегом секции и назначенным пунктом плана
  const checkSectionTagAndOutlineConsistency = (tags: string[], outlinePointSection?: string): boolean => {
    if (!outlinePointSection) return true; // Если нет назначенного пункта плана, нет и проблемы
    
    // Получаем ожидаемый тег для текущей секции
    const expectedTag = sectionTagMapping[outlinePointSection];
    if (!expectedTag) return true; // Если неизвестная секция, считаем что все в порядке
    
    // Проверяем, имеет ли мысль тег соответствующей секции
    const hasExpectedTag = tags.includes(expectedTag);
    
    // Проверяем, имеет ли мысль теги других секций
    const hasOtherSectionTags = Object.values(sectionTagMapping)
      .filter(tag => tag !== expectedTag)
      .some(tag => tags.includes(tag));
    
    // Несогласованность, если нет ожидаемого тега или есть теги других секций
    return !hasOtherSectionTags || hasExpectedTag;
  };

  // Проверяем, назначен ли пункт плана с другой секции
  const hasInconsistentSection = !checkSectionTagAndOutlineConsistency(thought.tags, outlinePoint?.section);
  
  // Список всех структурных тегов
  const structureTags = Object.values(sectionTagMapping);
  
  // Проверка наличия нескольких структурных тегов
  const hasMultipleStructureTags = thought.tags.filter(tag => structureTags.includes(tag)).length > 1;
  
  // Проверка на отсутствие обязательного тега
  const needsSectionTag = !hasRequiredTag;

  // Определяем стиль для карточки с учетом всех возможных проблем
  const cardStyle = (() => {
    // Если есть несогласованность между тегом секции и назначенным пунктом
    if (hasInconsistentSection) {
      return 'border border-red-500 bg-red-50 dark:bg-red-900 dark:border-red-500';
    }
    
    // Если имеется несколько структурных тегов
    if (hasMultipleStructureTags) {
      return 'border border-red-500 bg-red-50 dark:bg-red-900 dark:border-red-500';
    }
    
    // Если отсутствует обязательный тег секции
    if (needsSectionTag) {
      return 'border border-red-500 bg-red-50 dark:bg-red-900 dark:border-red-500';
    }
    
    // Если установлен текущий тег для фильтрации
    if (currentTag && thought.tags.includes(currentTag)) {
      return 'border border-blue-500 bg-blue-50 dark:bg-blue-900 dark:border-blue-500';
    }
    
    // Стандартный стиль
    return 'bg-gray-50 dark:bg-gray-700';
  })();

  // Получаем названия секций для предупреждения
  const getSectionName = (sectionKey?: string) => {
    if (!sectionKey) return '';
    const mapping: Record<string, string> = {
      'introduction': t('tags.introduction', 'Introduction'),
      'main': t('tags.mainPart', 'Main Part'),
      'conclusion': t('tags.conclusion', 'Conclusion')
    };
    return mapping[sectionKey] || sectionKey;
  };

  // Сообщение о несогласованности, если есть
  const inconsistencyWarning = (() => {
    if (hasInconsistentSection && outlinePoint?.section) {
      // Находим тег секции, который противоречит назначенному пункту плана
      const sectionMapping: Record<string, string> = {
        'introduction': 'Вступление',
        'main': 'Основная часть',
        'conclusion': 'Заключение'
      };
      
      // Ожидаемый тег для текущей секции пункта плана
      const expectedTag = sectionMapping[outlinePoint.section];
      
      // Найти фактический тег секции в мысли
      const actualSectionTags = thought.tags.filter(tag => 
        Object.values(sectionMapping).includes(tag) && tag !== expectedTag
      );
      
      if (actualSectionTags.length > 0) {
        const actualSectionTag = actualSectionTags[0];
        return (
          <div className="text-red-600 text-xs font-medium mb-2">
            <span className="inline-block mr-1">⚠️</span>
            {t('thought.inconsistentSection', 'Inconsistency: thought has tag "{{actualTag}}" but assigned to {{expectedSection}} outline point', {
              actualTag: actualSectionTag,
              expectedSection: getSectionName(outlinePoint.section)
            })}
          </div>
        );
      }
    }
    return null;
  })();

  // Сообщение о нескольких структурных тегах, если есть
  const multipleTagsWarning = hasMultipleStructureTags ? (
    <div className="text-red-600 text-xs font-medium mb-2">
      <span className="inline-block mr-1">⚠️</span>
      {t('thought.multipleStructureTags', 'Multiple structure tags detected. A thought should only have one structure tag.')}
    </div>
  ) : null;

  if (editingIndex === index) {
    // Edit Mode
    return (
      <div
        className={`relative p-4 rounded-lg ${cardStyle}`}
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
        
        {inconsistencyWarning}
        
        {multipleTagsWarning}
        
        <textarea
          ref={textareaRef}
          value={editingText}
          onChange={(e) => onTextChange(e.target.value)}
          className="w-full p-2 border rounded mb-2 dark:bg-gray-800 dark:text-gray-200"
        />

        {/* Tag Selection */}
        <div className="mb-3">
          <p data-testid="tags-section-header" className="text-sm font-medium mb-1">{t('thought.tags', 'Tags')}</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {editingTags.map((tag, tagIndex) => (
              <span
                key={tag}
                data-testid={`editing-tag-${tag}`}
                onClick={() => onRemoveTag(tagIndex)}
                className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded-full cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800"
              >
                {tag}
              </span>
            ))}
          </div>

          <p data-testid="available-tags-header" className="text-sm font-medium mb-1">{t('thought.availableTags', 'Available tags')}</p>
          <div className="flex flex-wrap gap-1.5">
            {allowedTags
              .filter(tag => !editingTags.includes(tag.name))
              .map(tag => (
                <span
                  key={tag.name}
                  data-testid={`available-tag-${tag.name}`}
                  onClick={() => onAddTag(tag.name)}
                  className="text-xs px-2 py-0.5 bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 rounded-full cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700"
                >
                  {tag.name}
                </span>
              ))}
          </div>
        </div>

        {/* Save/Cancel Buttons */}
        <div className="flex justify-end gap-2">
          <button
            data-testid="cancel-button"
            onClick={onEditCancel}
            className="px-3 py-1 text-sm bg-gray-200 text-gray-800 rounded hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
          >
            {t('thought.cancel', 'Cancel')}
          </button>
          <button
            data-testid="save-button"
            onClick={onEditSave}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-700 dark:hover:bg-blue-600"
          >
            {t('thought.save', 'Save')}
          </button>
        </div>
      </div>
    );
  } else {
    // View Mode
    return (
      <div
        className={`relative p-4 rounded-lg ${cardStyle}`}
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

        {inconsistencyWarning}
        
        {multipleTagsWarning}
        
        <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
          {thought.text}
        </p>

        {/* Display associated outline point if available */}
        {outlinePoint && (
          <div className="mt-3">
            <span className="text-sm inline-block rounded-md px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800">
              {getSectionName(outlinePoint.section)}: {outlinePoint.text}
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