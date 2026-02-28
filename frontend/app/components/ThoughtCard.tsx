"use client";

import { ArrowPathIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { AnimatePresence, motion } from "framer-motion";
import React, { memo, useCallback, useMemo } from "react";
import { useTranslation } from 'react-i18next';
import "@locales/i18n";

// Utils imports
import MarkdownDisplay from '@components/MarkdownDisplay';
import { formatDate } from "@utils/dateFormatter";
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag, CanonicalStructureId } from "@utils/tagUtils";

// Components
import SermonPointSelector from './SermonPointSelector';
import { ThoughtOptionsMenu } from './ThoughtOptionsMenu';
import ConfirmModal from './ui/ConfirmModal';

// Type imports
import type { SermonOutline, Thought } from "@/models/models";
import type { OptimisticEntitySyncState } from "@/models/optimisticEntities";

// Types
type TagInfo = {
  name: string;
  color: string;
  translationKey?: string
};

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
  onThoughtOutlinePointChange?: (thought: Thought, outlinePointId?: string) => Promise<void> | void;
  syncState?: OptimisticEntitySyncState;
  onRetrySync?: (thoughtId: string) => void;
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

const toSectionKey = (canonical: CanonicalStructureId | null): 'introduction' | 'main' | 'conclusion' | undefined => {
  if (canonical === 'intro') return 'introduction';
  if (canonical === 'main') return 'main';
  if (canonical === 'conclusion') return 'conclusion';
  return undefined;
};

function ThoughtSyncBanner({
  syncState,
  onRetrySync,
}: {
  syncState?: OptimisticEntitySyncState;
  onRetrySync?: () => void;
}) {
  const { t } = useTranslation();

  if (!syncState) return null;

  const isPending = syncState.status === "pending";
  const isError = syncState.status === "error";
  const isSuccess = syncState.status === "success";
  const isDeleting = syncState.operation === "delete";

  if (isPending) {
    return (
      <div className={`mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${
        isDeleting
          ? "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
          : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
      }`}>
        {!isDeleting && <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />}
        <span>{isDeleting ? t("buttons.deleting") : t("buttons.saving")}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mb-3 flex items-center gap-2 text-xs font-medium text-red-700 dark:text-red-300">
        <span>{syncState.lastError || t("errors.savingError")}</span>
        {onRetrySync && (
          <button
            type="button"
            onClick={onRetrySync}
            className="rounded-full border border-red-200 px-2 py-0.5 text-red-700 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/30"
          >
            {t("buttons.retry")}
          </button>
        )}
      </div>
    );
  }

  if (isSuccess && !isDeleting) {
    return (
      <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-200">
        <CheckCircleIcon className="h-3.5 w-3.5" />
        <span>{t("buttons.saved")}</span>
      </div>
    );
  }

  return null;
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
  onThoughtOutlinePointChange,
  syncState,
  onRetrySync,
  isReadOnly = false
}: ThoughtCardProps) => {
  const { t } = useTranslation();
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const isPending = syncState?.status === "pending";
  const isError = syncState?.status === "error";
  const isSuccess = syncState?.status === "success";
  const isDeleting = syncState?.operation === "delete";

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

    // Get canonical ID for the section the outline point belongs to
    // section values: 'introduction' | 'main' | 'conclusion'
    let expectedCanonical: CanonicalStructureId | null = null;
    if (outlinePointSection === 'introduction') expectedCanonical = 'intro';
    else if (outlinePointSection === 'main') expectedCanonical = 'main';
    else if (outlinePointSection === 'conclusion') expectedCanonical = 'conclusion';

    if (!expectedCanonical) return true;

    const normalizedTags = tags
      .map(t => normalizeStructureTag(t))
      .filter((t): t is CanonicalStructureId => t !== null);

    const hasExpectedTag = normalizedTags.includes(expectedCanonical);
    const hasOtherSectionTags = normalizedTags.some(tag => tag !== expectedCanonical);

    return !hasOtherSectionTags || hasExpectedTag;
  }, []);

  // Memoize computed values
  const outlinePoint = useMemo(() => findSermonPoint(), [findSermonPoint]);
  const hasRequiredTag = useMemo(() => thought.tags.some(tag => isStructureTag(tag)), [thought.tags]);
  const hasInconsistentSection = useMemo(() =>
    !checkSectionTagAndOutlineConsistency(thought.tags, outlinePoint?.section),
    [thought.tags, outlinePoint, checkSectionTagAndOutlineConsistency]
  );
  const hasMultipleStructureTags = useMemo(() => {
    const structuralCanonicalTags = new Set(
      thought.tags
        .map(tag => normalizeStructureTag(tag))
        .filter((t): t is CanonicalStructureId => t !== null)
    );
    return structuralCanonicalTags.size > 1;
  }, [thought.tags]);
  const needsSectionTag = useMemo(() => !hasRequiredTag, [hasRequiredTag]);

  // Determine card style based on status with improved visual hierarchy
  const cardStyle = useMemo(() => {
    const baseStyle = 'relative p-4 rounded-lg transition-all duration-200 hover:shadow-md';

    if (isDeleting && isPending) {
      return `${baseStyle} bg-gray-100 dark:bg-gray-800/60 border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 opacity-70`;
    }

    if (isError) {
      return `${baseStyle} bg-white dark:bg-gray-800 border border-red-300 dark:border-red-700 ring-1 ring-red-200/70 dark:ring-red-900/40`;
    }

    if (isPending) {
      return `${baseStyle} bg-white dark:bg-gray-800 border border-amber-300 dark:border-amber-600 ring-1 ring-amber-200/70 dark:ring-amber-900/40`;
    }

    if (isSuccess) {
      return `${baseStyle} bg-white dark:bg-gray-800 border border-green-300 dark:border-green-700`;
    }

    if (hasInconsistentSection || hasMultipleStructureTags || needsSectionTag) {
      return `${baseStyle} border border-red-500 bg-red-50/50 dark:bg-red-900/50 dark:border-red-500 hover:bg-red-50 dark:hover:bg-red-900`;
    }

    return `${baseStyle} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600`;
  }, [hasInconsistentSection, hasMultipleStructureTags, isDeleting, isError, isPending, isSuccess, needsSectionTag]);

  const handleSermonPointChange = useCallback(async (outlinePointId: string | undefined) => {
    if (isReadOnly) return;
    if (!sermonId || !onThoughtUpdate || !onThoughtOutlinePointChange) return;
    await onThoughtOutlinePointChange(thought, outlinePointId);
  }, [isReadOnly, onThoughtOutlinePointChange, onThoughtUpdate, sermonId, thought]);

  // Get warning messages if any issues exist
  const getWarningMessages = useCallback(() => {
    const warnings = [];

    if (hasInconsistentSection && outlinePoint?.section) {
      const expectedCanonical = normalizeStructureTag(outlinePoint.section);
      const actualSectionTags = thought.tags.filter(tag => {
        const canonical = normalizeStructureTag(tag);
        return canonical !== null && canonical !== expectedCanonical;
      });

      if (actualSectionTags.length > 0) {
        const rawTag = actualSectionTags[0];
        const canonical = normalizeStructureTag(rawTag);
        const sectionKey = toSectionKey(canonical);
        const displayTag = sectionKey ? getSectionName(sectionKey) : rawTag;
        warnings.push(
          <WarningMessage
            key="inconsistent"
            type="inconsistentSection"
            sectionName={outlinePoint.section}
            actualTag={displayTag}
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
          onDelete={() => setDeleteConfirmOpen(true)}
          isReadOnly={isReadOnly || (isDeleting && isPending)}
        />
      </div>

      <ConfirmModal
        isOpen={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false);
          onDelete(index, thought.id);
        }}
        title={t('common.delete', 'Delete')}
        description={t('sermon.deleteThoughtConfirm', {
          text: thought.text.length > 100 ? thought.text.slice(0, 100) + '…' : thought.text,
        })}
        confirmText={t('common.delete', 'Delete')}
      />

      <ThoughtHeader
        thought={thought}
        allowedTags={allowedTags}
      />

      <ThoughtSyncBanner
        syncState={syncState}
        onRetrySync={onRetrySync ? () => onRetrySync(thought.id) : undefined}
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
          disabled={isReadOnly || !sermonId || !onThoughtUpdate || !onThoughtOutlinePointChange || (isDeleting && isPending)}
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
