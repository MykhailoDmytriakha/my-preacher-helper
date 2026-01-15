"use client";

import { AnimatePresence, motion } from "framer-motion";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

// Utils imports
import MarkdownDisplay from '@components/MarkdownDisplay';
import { formatDate } from "@utils/dateFormatter";
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag } from "@utils/tagUtils";

// Components
import SermonPointSelector from './SermonPointSelector';
import { ThoughtOptionsMenu } from './ThoughtOptionsMenu';

// Type imports
import type { SermonOutline, Thought } from "@/models/models";

// Icons imports

// Types
type TagInfo = {
  name: string;
  color: string;
  translationKey?: string
};

// Constants
const STRUCTURE_SECTIONS: Record<string, string> = {
  'introduction': 'Вступление',
  'main': 'Основная часть',
  'conclusion': 'Заключение'
} as const;

// Props for the main component and sub-components
interface ThoughtCardProps {
  thought: Thought;
  index: number;
  allowedTags: TagInfo[];
  sermonOutline?: SermonOutline;
  sermonId?: string;
  onDelete: (index: number, thoughtId: string) => void;
  onEditStart: (thought: Thought, index: number) => void;
  onThoughtUpdate?: (updatedThought: Thought) => void;
  isReadOnly?: boolean;
}

interface TagsDisplayProps {
  tags: string[];
  allowedTags: TagInfo[];
  compact?: boolean;
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
  sermonId,
  onDelete,
  onEditStart,
  onThoughtUpdate,
  isReadOnly = false
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
  const findSermonPoint = useCallback((): { text: string; section: string } | undefined => {
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
  const outlinePoint = useMemo(() => findSermonPoint(), [findSermonPoint]);
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

  // Determine card style based on status with improved visual hierarchy
  const cardStyle = useMemo(() => {
    const baseStyle = 'relative p-4 rounded-lg transition-all duration-200 hover:shadow-md';

    if (hasInconsistentSection || hasMultipleStructureTags || needsSectionTag) {
      return `${baseStyle} border border-red-500 bg-red-50/50 dark:bg-red-900/50 dark:border-red-500 hover:bg-red-50 dark:hover:bg-red-900`;
    }

    return `${baseStyle} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600`;
  }, [hasInconsistentSection, hasMultipleStructureTags, needsSectionTag]);

  const handleSermonPointChange = useCallback(async (outlinePointId: string | undefined) => {
    if (isReadOnly) return;
    if (!sermonId || !onThoughtUpdate) return;

    const updatedThought: Thought = {
      ...thought,
      outlinePointId
    };

    try {
      const { updateThought } = await import('@/services/thought.service');
      const savedThought = await updateThought(sermonId, updatedThought);
      onThoughtUpdate(savedThought);
    } catch (error) {
      console.error('Failed to update outline point:', error);
      throw error;
    }
  }, [isReadOnly, sermonId, thought, onThoughtUpdate]);

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
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.2 }}
      className={cardStyle}
      role="article"
      aria-labelledby={`thought-${thought.id}-text`}
    >
      <div className="absolute top-4 right-4 z-10">
        <ThoughtOptionsMenu
          thoughtText={thought.text}
          onEdit={() => onEditStart(thought, index)}
          onDelete={() => onDelete(index, thought.id)}
          isReadOnly={isReadOnly}
        />
      </div>

      <ThoughtHeader
        thought={thought}
        allowedTags={allowedTags}
      />

      <AnimatePresence>
        {getWarningMessages().map((warning, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
          >
            {warning}
          </motion.div>
        ))}
      </AnimatePresence>

      <motion.div
        id={`thought-${thought.id}-text`}
        className="mt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <MarkdownDisplay content={thought.text} className="text-gray-800 dark:text-gray-200" />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <SermonPointSelector
          thought={thought}
          sermonOutline={sermonOutline}
          onSermonPointChange={handleSermonPointChange}
          disabled={isReadOnly || !sermonId || !onThoughtUpdate}
        />
      </motion.div>
    </motion.div>
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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-y-2 mb-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 order-first">
        <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
          {formatDate(thought.date)}
        </span>
        {thought.tags && thought.tags.length > 0 && (
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
    <div className="flex flex-wrap gap-1.5 overflow-x-hidden" role="list" aria-label="Tags">
      {tags.map((tag) => {
        const tagInfo = allowedTags.find(t => t.name === tag);
        let displayName = tag;
        const structureTagStatus = isStructureTag(tag);

        // Determine if this is a structure tag via normalization
        const canonical = normalizeStructureTag(tag);
        if (canonical === 'intro') displayName = t('tags.introduction');
        else if (canonical === 'main') displayName = t('tags.mainPart');
        else if (canonical === 'conclusion') displayName = t('tags.conclusion');

        // Get styling from our utilities
        const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);

        // Enhanced tag styling without hover scale
        const className = `
          ${baseClassName} 
          ${compact ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'} 
          rounded-full font-medium
          transition-shadow duration-200
          hover:shadow-sm
        `;

        const iconInfo = structureTagStatus ? getStructureIcon(tag) : null;

        return (
          <span
            key={tag}
            style={style}
            className={className}
            role="listitem"
          >
            {iconInfo && (
              <span className={`${iconInfo.className} mr-1`} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
            )}
            {tagInfo?.translationKey ? t(tagInfo.translationKey) : displayName}
          </span>
        );
      })}
    </div>
  );
});

TagsDisplay.displayName = "TagsDisplay";

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

  const getWarningStyle = () => {
    const baseStyle = "text-xs font-medium mb-2 flex items-center gap-1.5 px-3 py-2 rounded-lg";

    switch (type) {
      case 'inconsistentSection':
        return `${baseStyle} bg-red-50 text-red-700 dark:bg-red-900/50 dark:text-red-200 border border-red-200 dark:border-red-800`;
      case 'multipleStructureTags':
        return `${baseStyle} bg-orange-50 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200 border border-orange-200 dark:border-orange-800`;
      case 'missingSectionTag':
        return `${baseStyle} bg-yellow-50 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-200 border border-yellow-200 dark:border-yellow-800`;
      default:
        return baseStyle;
    }
  };

  if (type === 'inconsistentSection') {
    return (
      <div className={getWarningStyle()} role="alert">
        <span className="flex-shrink-0">⚠️</span>
        <span>
          {t('thought.inconsistentSection', 'Inconsistency: thought has tag "{{actualTag}}" but assigned to {{expectedSection}} outline point', {
            actualTag,
            expectedSection: getSectionName(sectionName)
          })}
        </span>
      </div>
    );
  }

  if (type === 'multipleStructureTags') {
    return (
      <div className={getWarningStyle()} role="alert">
        <span className="flex-shrink-0">⚠️</span>
        <span>
          {t('thought.multipleStructureTags', 'Multiple structure tags detected. A thought should only have one structure tag.')}
        </span>
      </div>
    );
  }

  if (type === 'missingSectionTag') {
    return (
      <div className={getWarningStyle()} role="alert">
        <span className="flex-shrink-0">ℹ️</span>
        <span>
          {t('thought.missingRequiredTag', {
            intro: getSectionName('introduction'),
            main: getSectionName('main'),
            conclusion: getSectionName('conclusion')
          })}
        </span>
      </div>
    );
  }

  return null;
}

export default memo(ThoughtCard);