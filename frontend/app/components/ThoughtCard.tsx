"use client";

import { formatDate } from "@utils/dateFormatter";
import { TrashIcon, EditIcon } from "@components/Icons";
import { Thought, Outline } from "@/models/models";
import { useCallback, useMemo, memo } from "react";
import { getContrastColor } from "@utils/color";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";
import { isStructureTag, getDefaultTagStyling, getStructureIcon, getTagStyle } from "@utils/tagUtils";

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
  currentTag: string;
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
  currentTag,
  sermonOutline,
  onDelete,
  onEditStart
}: ThoughtCardProps) => {
  const { t } = useTranslation();

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
    
    if (currentTag && thought.tags.includes(currentTag)) {
      return 'border border-blue-500 bg-blue-50 dark:bg-blue-900 dark:border-blue-500';
    }
    
    return 'bg-gray-50 dark:bg-gray-700';
  }, [hasInconsistentSection, hasMultipleStructureTags, needsSectionTag, currentTag, thought.tags]);

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
      <ThoughtHeader 
        thought={thought}
        index={index}
        onDelete={onDelete}
        onEditStart={onEditStart}
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
  index, 
  onDelete, 
  onEditStart,
  allowedTags 
}: { 
  thought: Thought; 
  index: number; 
  onDelete: (index: number, thoughtId: string) => void; 
  onEditStart: (thought: Thought, index: number) => void;
  allowedTags: TagInfo[]; 
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start mb-2 gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {formatDate(thought.date)}
        </span>
        <button
          onClick={() => onDelete(index, thought.id)}
          className="text-gray-500 hover:text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 p-1 rounded-full transition-colors"
          aria-label="Delete thought"
        >
          <TrashIcon/>
        </button>
        <button
          onClick={() => onEditStart(thought, index)}
          className="text-gray-500 hover:text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-900/30 p-1.5 rounded-full transition-colors"
          aria-label="Edit thought"
        >
          <EditIcon className="w-5 h-5" />
        </button>
        <span className="text-xs bg-gray-200 text-gray-700 px-1 rounded dark:bg-gray-600 dark:text-gray-300">
          ID: {thought.id}
        </span>
      </div>

      {thought.tags && thought.tags.length > 0 && (
        <TagsDisplay tags={thought.tags} allowedTags={allowedTags} />
      )}
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

function WarningMessage({ type, sectionName, actualTag, getSectionName }: WarningMessageWithHelperProps) {
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
          intro: t('tags.introduction'),
          main: t('tags.mainPart'), 
          conclusion: t('tags.conclusion')
        })}
      </p>
    );
  }
  
  return null;
}

export default memo(ThoughtCard);