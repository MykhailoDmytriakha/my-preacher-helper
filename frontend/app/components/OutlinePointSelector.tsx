'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { OutlinePointOptions } from '@/components/thought/OutlinePointOptions';
import { Thought, SermonOutline } from '@/models/models';
import { resolveThoughtOutlineLocation } from '@/utils/subPoints';
import { normalizeStructureTag, CANONICAL_TO_SECTION, isStructureTag } from "@utils/tagUtils";

interface SermonPointSelectorProps {
  thought: Thought;
  sermonOutline?: SermonOutline;
  onSermonPointChange: (outlinePointId: string | null | undefined, subPointId?: string | null) => Promise<void>;
  disabled?: boolean;
}

export default function SermonPointSelector({
  thought,
  sermonOutline,
  onSermonPointChange,
  disabled = false
}: SermonPointSelectorProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const getSectionName = useCallback((sectionKey?: string) => {
    if (!sectionKey) return '';
    const mapping: Record<string, string> = {
      'introduction': t('tags.introduction', 'Introduction'),
      'main': t('tags.mainPart', 'Main Part'),
      'conclusion': t('tags.conclusion', 'Conclusion')
    };
    return mapping[sectionKey] || sectionKey;
  }, [t]);

  const getThoughtSection = useCallback((): string | undefined => {
    // Current approach: detect the first structure-related tag
    const foundTag = thought.tags.find(tag => isStructureTag(tag));
    if (!foundTag) return undefined;

    const canonical = normalizeStructureTag(foundTag);
    if (!canonical) return undefined;

    return CANONICAL_TO_SECTION[canonical];
  }, [thought.tags]);

  const filteredSermonPoints = useMemo(() => {
    if (!sermonOutline) return {};

    const thoughtSection = getThoughtSection();

    // Check if there are multiple structure tags (ambiguous case)
    const structureTagsCount = thought.tags.filter(tag => isStructureTag(tag)).length;

    if (!thoughtSection || structureTagsCount > 1) {
      return {
        introduction: sermonOutline.introduction || [],
        main: sermonOutline.main || [],
        conclusion: sermonOutline.conclusion || []
      };
    }

    return {
      [thoughtSection]: sermonOutline[thoughtSection as keyof SermonOutline] || []
    };
  }, [sermonOutline, getThoughtSection, thought.tags]);

  const location = useMemo(
    () => resolveThoughtOutlineLocation(sermonOutline, thought.outlinePointId, thought.subPointId),
    [sermonOutline, thought.outlinePointId, thought.subPointId]
  );
  const outlinePoint = location
    ? { text: location.outlinePoint.text, section: location.section }
    : undefined;
  const subPointChipText = location?.subPoint?.text ?? null;

  const handleSermonPointSelect = async (outlinePointId: string | null, subPointId?: string | null) => {
    if (isUpdating || disabled) return;

    setIsUpdating(true);
    try {
      await onSermonPointChange(outlinePointId, subPointId ?? null);
      setIsOpen(false);
    } catch (error) {
      console.error('Failed to update outline point:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!sermonOutline) return null;

  const hasSermonPoints = Object.values(filteredSermonPoints).some(points => points.length > 0);

  if (!hasSermonPoints) return null;

  const triggerClass = outlinePoint
    ? 'max-w-full overflow-hidden border border-blue-200 bg-blue-50 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-200 dark:hover:bg-blue-900/70'
    : 'border-2 border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500 dark:hover:text-gray-300';
  return (
    <div className="relative mt-3 inline-block" ref={dropdownRef}>
      <button type="button" onClick={() => !disabled && setIsOpen(!isOpen)} disabled={disabled || isUpdating} aria-expanded={isOpen}
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${triggerClass}`}>
        <span className="min-w-0 truncate">{outlinePoint ? `${getSectionName(outlinePoint.section)}: ${outlinePoint.text}` : t('editThought.noSermonPointAssigned')}</span>
        {subPointChipText && <span className="inline-flex min-w-0 max-w-[180px] items-center rounded-full border border-blue-200/80 bg-white/80 px-2 py-0.5 text-[11px] font-medium leading-4 text-blue-700 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-200">
          <span className="truncate">{subPointChipText}</span>
        </span>}
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.15 }}
          className={`absolute z-50 mt-2 max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 ${outlinePoint ? 'min-w-[250px]' : 'w-full'}`}>
          {!outlinePoint && <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-500 dark:bg-gray-900 dark:text-gray-400">{t('editThought.selectSermonPoint')}</div>}
          <OutlinePointOptions groups={filteredSermonPoints} outlinePointId={thought.outlinePointId} subPointId={thought.subPointId} onSelect={handleSermonPointSelect} disabled={isUpdating || disabled} allowClear={Boolean(outlinePoint)} />
        </motion.div>}
      </AnimatePresence>
    </div>
  );
}
