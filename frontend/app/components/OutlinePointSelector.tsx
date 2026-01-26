'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown } from 'lucide-react';
import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Thought, SermonOutline, SermonPoint } from '@/models/models';
import { normalizeStructureTag, CANONICAL_TO_SECTION, isStructureTag } from "@utils/tagUtils";

interface SermonPointSelectorProps {
  thought: Thought;
  sermonOutline?: SermonOutline;
  onSermonPointChange: (outlinePointId: string | undefined) => Promise<void>;
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

  const findSermonPoint = useCallback((): { text: string; section: string } | undefined => {
    if (!thought.outlinePointId || !sermonOutline) return undefined;

    const introPoint = sermonOutline.introduction?.find(p => p.id === thought.outlinePointId);
    if (introPoint) return { text: introPoint.text, section: 'introduction' };

    const mainPoint = sermonOutline.main?.find(p => p.id === thought.outlinePointId);
    if (mainPoint) return { text: mainPoint.text, section: 'main' };

    const conclPoint = sermonOutline.conclusion?.find(p => p.id === thought.outlinePointId);
    if (conclPoint) return { text: conclPoint.text, section: 'conclusion' };

    return undefined;
  }, [thought.outlinePointId, sermonOutline]);

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

  const outlinePoint = useMemo(() => findSermonPoint(), [findSermonPoint]);

  const handleSermonPointSelect = async (outlinePointId: string) => {
    if (isUpdating || disabled) return;

    setIsUpdating(true);
    try {
      await onSermonPointChange(outlinePointId === '' ? undefined : outlinePointId);
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

  if (outlinePoint) {
    return (
      <div className="mt-3 relative inline-block" ref={dropdownRef}>
        <button
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled || isUpdating}
          className="text-left text-sm inline-flex items-center gap-2 rounded-full px-3 py-1.5 bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/50 dark:text-blue-200 dark:border-blue-800 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/70 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>
            {getSectionName(outlinePoint.section)}: {outlinePoint.text}
          </span>
          <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 mt-2 min-w-[250px] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              <button
                onClick={() => handleSermonPointSelect('')}
                disabled={isUpdating}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {t('editThought.noSermonPoint')}
              </button>

              {Object.entries(filteredSermonPoints).map(([section, points]) =>
                points.length > 0 ? (
                  <div key={section}>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900">
                      {t(`outline.${section === 'main' ? 'mainPoints' : section}`)}
                    </div>
                    {points.map((point: SermonPoint) => (
                      <button
                        key={point.id}
                        onClick={() => handleSermonPointSelect(point.id)}
                        disabled={isUpdating}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors disabled:opacity-50 ${thought.outlinePointId === point.id
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                          }`}
                      >
                        {point.text}
                      </button>
                    ))}
                  </div>
                ) : null
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="mt-3 relative inline-block" ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled || isUpdating}
        className="text-left text-sm inline-flex items-center gap-2 rounded-full px-3 py-1.5 border-2 border-dashed border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span>
          {t('editThought.noSermonPointAssigned')}
        </span>
        <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 mt-2 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto"
          >
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900">
              {t('editThought.selectSermonPoint')}
            </div>

            {Object.entries(filteredSermonPoints).map(([section, points]) =>
              points.length > 0 ? (
                <div key={section}>
                  <div className="px-4 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900">
                    {t(`outline.${section === 'main' ? 'mainPoints' : section}`)}
                  </div>
                  {points.map((point: SermonPoint) => (
                    <button
                      key={point.id}
                      onClick={() => handleSermonPointSelect(point.id)}
                      disabled={isUpdating}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
                    >
                      {point.text}
                    </button>
                  ))}
                </div>
              ) : null
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
