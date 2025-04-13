"use client";

import { formatDate } from "@utils/dateFormatter";
import { TrashIcon, EditIcon } from "@components/Icons";
import { Thought, Outline } from "@/models/models";
import { useCallback, useMemo, memo } from "react";
import { getContrastColor } from "@utils/color";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { isStructureTag, getDefaultTagStyling, getStructureIcon, getTagStyle } from "@utils/tagUtils";
import { useState, useRef, useEffect } from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";

// Types
type TagInfo = { 
  name: string; 
  color: string; 
  translationKey?: string 
};

type OutlinePointInfo = { 
  text: string; 
  section: string 
};

// Constants
const STRUCTURE_SECTIONS: Record<string, string> = {
  'introduction': 'Вступление',
  'main': 'Основная часть',
  'conclusion': 'Заключение'
};

// Props for the main component and sub-components
interface ThoughtCardProps {
  thought: Thought;
  index: number;
  allowedTags: TagInfo[];
  sermonOutline?: Outline;
  onDelete: (index: number, thoughtId: string) => void;
  onEditStart: (thought: Thought, index: number) => void;
}

interface TagsDisplayProps {
  tags: string[];
  allowedTags: TagInfo[];
  compact?: boolean;
}

interface OutlinePointDisplayProps {
  outlinePoint: OutlinePointInfo | undefined;
}

interface WarningMessageProps {
  type: 'inconsistentSection' | 'multipleStructureTags' | 'missingSectionTag';
  sectionName?: string;
  actualTag?: string;
}

const ThoughtCard = ({
  thought,
  index,
  allowedTags,
  sermonOutline,
  onDelete,
  onEditStart
}: ThoughtCardProps) => {
  const { t } = useTranslation();
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const optionsMenuRef = useRef<HTMLDivElement>(null);

  // Close dropdown if clicked outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(event.target as Node)) {
        setIsOptionsOpen(false);
      }
    }
    if (isOptionsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOptionsOpen]);

  // Shared translation helper
  const getSectionName = useCallback((sectionKey?: string) => {
    if (!sectionKey) return '';
    const mapping: Record<string, string> = {
      'introduction': t('tags.introduction', 'Introduction'),
      'main': t('tags.mainPart', 'Main Part'),
      'conclusion': t('tags.conclusion', 'Conclusion')
    };
    return mapping[sectionKey] || sectionKey;
  }, [t]);

  // Helper Functions
  const findOutlinePoint = useCallback((): OutlinePointInfo | undefined => {
    if (!thought.outlinePointId || !sermonOutline) return undefined;
    
    const introPoint = sermonOutline.introduction.find(p => p.id === thought.outlinePointId);
    if (introPoint) return { text: introPoint.text, section: 'introduction' };
    
    const mainPoint = sermonOutline.main.find(p => p.id === thought.outlinePointId);
    if (mainPoint) return { text: mainPoint.text, section: 'main' };
    
    const conclPoint = sermonOutline.conclusion.find(p => p.id === thought.outlinePointId);
    if (conclPoint) return { text: conclPoint.text, section: 'conclusion' };
    
    return undefined;
  }, [thought.outlinePointId, sermonOutline]);

  const checkSectionTagAndOutlineConsistency = useCallback((tags: string[], outlinePointSection?: string): boolean => {
    if (!outlinePointSection) return true;
    
    const expectedTag = STRUCTURE_SECTIONS[outlinePointSection];
    if (!expectedTag) return true;
    
    const hasExpectedTag = tags.includes(expectedTag);
    const hasOtherSectionTags = Object.values(STRUCTURE_SECTIONS)
      .filter(tag => tag !== expectedTag)
      .some(tag => tags.includes(tag));
    
    return !hasOtherSectionTags || hasExpectedTag;
  }, []);

  // Memoize computed values
  const outlinePoint = useMemo(() => findOutlinePoint(), [findOutlinePoint]);
  const structureTags = useMemo(() => Object.values(STRUCTURE_SECTIONS), []);
  const hasRequiredTag = useMemo(() => thought.tags.some(tag => structureTags.includes(tag)), [thought.tags, structureTags]);
  const hasInconsistentSection = useMemo(() => 
    !checkSectionTagAndOutlineConsistency(thought.tags, outlinePoint?.section),
    [thought.tags, outlinePoint, checkSectionTagAndOutlineConsistency]
  );
  const hasMultipleStructureTags = useMemo(() => 
    thought.tags.filter(tag => structureTags.includes(tag)).length > 1,
    [thought.tags, structureTags]
  );
  const needsSectionTag = useMemo(() => !hasRequiredTag, [hasRequiredTag]);

  // Determine card style based on status
  const cardStyle = useMemo(() => {
    if (hasInconsistentSection || hasMultipleStructureTags || needsSectionTag) {
      return 'border border-red-500 bg-red-50 dark:bg-red-900 dark:border-red-500';
    }
    
    return 'bg-gray-50 dark:bg-gray-700';
  }, [hasInconsistentSection, hasMultipleStructureTags, needsSectionTag, thought.tags]);

  // Get warning messages if any issues exist
  const getWarningMessages = useCallback(() => {
    const warnings = [];
    
    if (hasInconsistentSection && outlinePoint?.section) {
      const expectedTag = STRUCTURE_SECTIONS[outlinePoint.section];
      const actualSectionTags = thought.tags.filter(tag => 
        Object.values(STRUCTURE_SECTIONS).includes(tag) && tag !== expectedTag
      );
      
      if (actualSectionTags.length > 0) {
        warnings.push(
          <WarningMessage 
            key="inconsistent" 
            type="inconsistentSection" 
            sectionName={outlinePoint.section}
            actualTag={actualSectionTags[0]}
            getSectionName={getSectionName}
          />
        );
      }
    }
    
    if (hasMultipleStructureTags) {
      warnings.push(<WarningMessage key="multiple" type="multipleStructureTags" getSectionName={getSectionName} />);
    }
    
    if (needsSectionTag) {
      warnings.push(<WarningMessage key="missing" type="missingSectionTag" getSectionName={getSectionName} />);
    }
    
    return warnings;
  }, [hasInconsistentSection, hasMultipleStructureTags, needsSectionTag, outlinePoint, thought.tags, getSectionName]);

  return (
    <div className={`relative p-4 rounded-lg ${cardStyle}`} role="article" aria-labelledby={`thought-${thought.id}-text`}>
      <div ref={optionsMenuRef} className="absolute top-4 right-4 z-10">
        <button
          onClick={() => setIsOptionsOpen(!isOptionsOpen)}
          className="p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-full transition-colors"
          aria-label={t('thought.optionsMenuLabel', 'Thought options')}
          aria-haspopup="true"
          aria-expanded={isOptionsOpen}
        >
          <EllipsisVerticalIcon className="w-5 h-5" />
        </button>

        {isOptionsOpen && (
          <div
            className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-md shadow-lg py-1 border border-gray-200 dark:border-gray-700 z-20"
            role="menu"
            aria-orientation="vertical"
            aria-labelledby="options-menu"
          >
            <button
              onClick={() => {
                onEditStart(thought, index);
                setIsOptionsOpen(false);
              }}
              className="w-full flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              role="menuitem"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 flex-shrink-0">
                <EditIcon className="w-4 h-4" />
              </span>
              {t('common.edit', 'Edit')}
            </button>
            <button
              onClick={() => {
                onDelete(index, thought.id);
                setIsOptionsOpen(false);
              }}
              className="w-full flex items-center px-4 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-gray-700"
              role="menuitem"
            >
              <span className="inline-flex items-center justify-center w-5 h-5 mr-2 flex-shrink-0">
                <TrashIcon className="w-4 h-4" />
              </span>
              {t('common.delete', 'Delete')}
            </button>
          </div>
        )}
      </div>

      <ThoughtHeader 
        thought={thought}
        allowedTags={allowedTags}
      />
      
      {getWarningMessages()}
      
      <p 
        id={`thought-${thought.id}-text`}
        className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words"
      >
        {thought.text}
      </p>

      {outlinePoint && <OutlinePointDisplay outlinePoint={outlinePoint} getSectionName={getSectionName} />}
    </div>
  );
};

// Sub-components
const ThoughtHeader = memo(({
  thought,
  allowedTags
}: {
  thought: Thought;
  allowedTags: TagInfo[];
}) => {
  return (
    // Main container: col on mobile, row with space-between on sm
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-2 mb-2">

      {/* Left Group: Date, ID, Tags (wraps internally) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 order-first">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(thought.date)}
        </span>
        <span className="text-xs bg-gray-200 text-gray-700 px-1 rounded dark:bg-gray-600 dark:text-gray-300">
          ID: {thought.id}
        </span>
        {thought.tags && thought.tags.length > 0 && (
          // Use 'contents' so TagsDisplay's internal flex items integrate with this group's flex layout
          <div className="contents">
            <TagsDisplay tags={thought.tags} allowedTags={allowedTags} />
          </div>
        )}
      </div>
    </div>
  );
});

ThoughtHeader.displayName = "ThoughtHeader";

const TagsDisplay = memo(({ tags, allowedTags, compact = false }: TagsDisplayProps) => {
  const { t } = useTranslation();
  
  return (
    <div className="flex flex-wrap gap-1.5" role="list" aria-label="Tags">
      {tags.map((tag) => {
        const tagInfo = allowedTags.find(t => t.name === tag);
        let displayName = tag;
        const structureTagStatus = isStructureTag(tag);
        
        // Determine if this is a structure tag
        if (tag.toLowerCase() === "intro" || tag.toLowerCase() === "вступление") {
          displayName = t('tags.introduction');
        } else if (tag.toLowerCase() === "main" || tag.toLowerCase() === "основная часть") {
          displayName = t('tags.mainPart');
        } else if (tag.toLowerCase() === "conclusion" || tag.toLowerCase() === "заключение") {
          displayName = t('tags.conclusion');
        }
        
        // Get styling from our utilities
        const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);
        
        // Add size classes
        const className = `${baseClassName} ${compact ? 'text-xs' : 'text-sm'}`;
        
        // Get the structure icon if applicable
        const iconInfo = structureTagStatus ? getStructureIcon(tag) : null;
        
        return (
          <span
            key={tag}
            style={style}
            className={className}
            role="listitem"
          >
            {iconInfo && (
              <span className={iconInfo.className} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
            )}
            {tagInfo?.translationKey ? t(tagInfo.translationKey) : displayName}
          </span>
        );
      })}
    </div>
  );
});

TagsDisplay.displayName = "TagsDisplay";

const OutlinePointDisplay = memo(({ outlinePoint, getSectionName }: OutlinePointDisplayProps & { getSectionName: (section?: string) => string }) => {
  if (!outlinePoint) return null;
  
  return (
    <div className="mt-3">
      <span className="text-sm inline-block rounded-md px-3 py-1 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900 dark:text-blue-200 dark:border-blue-800">
        {getSectionName(outlinePoint.section)}: {outlinePoint.text}
      </span>
    </div>
  );
});

OutlinePointDisplay.displayName = "OutlinePointDisplay";

interface WarningMessageWithHelperProps extends WarningMessageProps {
  getSectionName: (section?: string) => string;
}

function WarningMessage({ 
  type, 
  sectionName, 
  actualTag, 
  getSectionName 
}: WarningMessageWithHelperProps) {
  const { t } = useTranslation();

  if (type === 'inconsistentSection') {
    return (
      <div className="text-red-600 text-xs font-medium mb-2" role="alert">
        <span className="inline-block mr-1">⚠️</span>
        {t('thought.inconsistentSection', 'Inconsistency: thought has tag "{{actualTag}}" but assigned to {{expectedSection}} outline point', {
          actualTag,
          expectedSection: getSectionName(sectionName)
        })}
      </div>
    );
  }
  
  if (type === 'multipleStructureTags') {
    return (
      <div className="text-red-600 text-xs font-medium mb-2" role="alert">
        <span className="inline-block mr-1">⚠️</span>
        {t('thought.multipleStructureTags', 'Multiple structure tags detected. A thought should only have one structure tag.')}
      </div>
    );
  }
  
  if (type === 'missingSectionTag') {
    return (
      <p className="text-red-500 text-sm mt-2" role="alert">
        {t('thought.missingRequiredTag', {
          intro: getSectionName('introduction'), 
          main: getSectionName('main'), 
          conclusion: getSectionName('conclusion')
        })}
      </p>
    );
  }
  
  return null;
}

export default memo(ThoughtCard);