import React, { useRef, useEffect, useId } from 'react';
import { useTranslation } from 'react-i18next';

import { getSectionLabel } from '@/lib/sections';
import { STRUCTURE_TAGS } from '@lib/constants';
import { normalizeStructureTag } from '@utils/tagUtils';

// CSS class constants to avoid duplicate strings
const DISABLED_LABEL_CLASSES = 'opacity-50 cursor-not-allowed';

import type { ViewFilter, StructureFilter, SortOrder } from '@hooks/useThoughtFiltering';

interface ThoughtFilterControlsProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  viewFilter: ViewFilter;
  setViewFilter: (filter: ViewFilter) => void;
  structureFilter: StructureFilter;
  setStructureFilter: (filter: StructureFilter) => void;
  tagFilters: string[];
  toggleTagFilter: (tag: string) => void;
  resetFilters: () => void;
  sortOrder: SortOrder;
  setSortOrder: (order: SortOrder) => void;
  allowedTags: { name: string; color: string }[];
  hasStructureTags: boolean;
  buttonRef: React.RefObject<HTMLButtonElement | null>; // Allow null for initial ref value
}

const ThoughtFilterControls: React.FC<ThoughtFilterControlsProps> = ({
  isOpen,
  setIsOpen,
  viewFilter,
  setViewFilter,
  structureFilter,
  setStructureFilter,
  tagFilters,
  toggleTagFilter,
  resetFilters,
  sortOrder,
  setSortOrder,
  allowedTags,
  hasStructureTags,
  buttonRef,
}) => {
  const { t } = useTranslation();
  const filterRef = useRef<HTMLDivElement>(null);
  const uid = useId(); // Unique per instance to isolate radio groups

  // Debug helper removed

  // Helper: resolve a proper localized label for structure-related tags
  const getStructureTagLabel = (tag: string) => {
    const canonical = normalizeStructureTag(tag);
    if (canonical === 'intro') return getSectionLabel(t, 'introduction');
    if (canonical === 'main') return getSectionLabel(t, 'main');
    if (canonical === 'conclusion') return getSectionLabel(t, 'conclusion');
    // Fallback to a best-effort translation key or raw tag
    return t(`tags.${tag.toLowerCase().replace(/\s+/g, '_')}`) || tag;
  };

  // Handle clicks outside the filter dropdown
  // Use pointerdown (capture) with composedPath to correctly detect clicks on labels/text
  // and avoid closing when interacting inside the menu.
  useEffect(() => {
    function isInside(event: Event): boolean {
      const path = event.composedPath?.() ?? [];
      const targetNode = event.target as Node | null;
      if (path.length) {
        const insideFilter = !!(filterRef.current && path.includes(filterRef.current));
        const insideButton = !!(buttonRef.current && path.includes(buttonRef.current));
        if (insideFilter || insideButton) return true;

        // NEW: If there are multiple filter menus mounted (e.g., due to slider),
        // treat clicks inside ANY of them as inside to prevent cross-closing.
        try {
          const allMenus = Array.from(document.querySelectorAll('[data-testid="thought-filter-controls"]')) as HTMLElement[];
          const allButtons = Array.from(document.querySelectorAll('[data-testid="thought-filter-button"]')) as HTMLElement[];
          const inAnyMenu = allMenus.some(el => path.includes(el) || (!!targetNode && el.contains(targetNode)));
          const inAnyButton = allButtons.some(el => path.includes(el) || (!!targetNode && el.contains(targetNode)));
          if (inAnyMenu || inAnyButton) return true;
        } catch {
          // swallow query errors silently
        }
      }
      if (!targetNode) return false;
      if (filterRef.current?.contains(targetNode)) return true;
      if (buttonRef.current?.contains(targetNode)) return true;
      return false;
    }

    function handlePointerDown(event: Event) {
      if (!isOpen) return;
      if (!isInside(event)) {
        setIsOpen(false);
      }
    }

    // Capture phase ensures reliable outside detection across browsers
    document.addEventListener('pointerdown', handlePointerDown, true);
    // Fallbacks for environments without Pointer Events
    document.addEventListener('mousedown', handlePointerDown, true);
    document.addEventListener('touchstart', handlePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('mousedown', handlePointerDown, true);
      document.removeEventListener('touchstart', handlePointerDown, true);
    };
  }, [filterRef, buttonRef, isOpen, setIsOpen]);

  // No runtime logging

  if (!isOpen) return null;

  return (
    <div
      ref={filterRef}
      // Stop pointer/touch in capture so global outside handlers don’t run.
      // Allow click to bubble so React onChange for radios/checkboxes fires.
      onPointerDownCapture={(e) => { e.stopPropagation(); }}
      onTouchStartCapture={(e) => { e.stopPropagation(); }}
      className="absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-50"
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      data-testid="thought-filter-controls"
    >
      <div className="py-1 divide-y divide-gray-200 dark:divide-gray-700">
        {/* Sort order */}
        <div className="px-4 py-2">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium">{t('filters.sortOrder') || 'Sort Order'}</h3>
            <button
              onClick={() => { resetFilters(); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
            >
              {t('filters.reset')}
            </button>
          </div>
          <div className="mt-2 space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name={`sortOrder-${uid}`}
                value="date"
                checked={sortOrder === 'date'}
                onChange={() => { setSortOrder('date'); }}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.sortByDate') || 'By Date (Newest First)'}</span>
            </label>
            <label className={`flex items-center ${!hasStructureTags ? DISABLED_LABEL_CLASSES : ''}`}>
              <input
                type="radio"
                name={`sortOrder-${uid}`}
                value="structure"
                checked={sortOrder === 'structure'}
                onChange={() => { setSortOrder('structure'); }}
                className="h-4 w-4 text-blue-600"
                disabled={!hasStructureTags}
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                {t('filters.sortByStructure') || 'By ThoughtsBySection (Intro → Main → Conclusion)'}
                {!hasStructureTags && (
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                    ({t('filters.requiresStructureTags') || 'Requires structure tags'})
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>

        {/* View options */}
        <div className="px-4 py-2">
          <h3 className="text-sm font-medium mb-2">{t('filters.viewOptions')}</h3>
          <div className="mt-2 space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name={`viewFilter-${uid}`}
                value="all"
                checked={viewFilter === 'all'}
                onChange={() => { setViewFilter('all'); }}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.all')}</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name={`viewFilter-${uid}`}
                value="missingTags"
                checked={viewFilter === 'missingTags'}
                onChange={() => { setViewFilter('missingTags'); }}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.missingTags')}</span>
            </label>
          </div>
        </div>

        {/* ThoughtsBySection filter */}
        <div className="px-4 py-2">
          <h3 className="text-sm font-medium">
            {t('filters.byStructure')}
            {!hasStructureTags && (
              <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                ({t('filters.noStructureTagsPresent') || 'No structure tags present'})
              </span>
            )}
          </h3>
          <div className="mt-2 space-y-2">
            <label className={`flex items-center ${!hasStructureTags ? DISABLED_LABEL_CLASSES : ''}`}>
              <input
                type="radio"
                name={`structureFilter-${uid}`}
                value="all"
                checked={structureFilter === 'all'}
                onChange={() => { setStructureFilter('all'); }}
                className="h-4 w-4 text-blue-600"
                disabled={!hasStructureTags}
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.allStructure')}</span>
            </label>
            {/* Use STRUCTURE_TAGS constants */}
            {[STRUCTURE_TAGS.INTRODUCTION, STRUCTURE_TAGS.MAIN_BODY, STRUCTURE_TAGS.CONCLUSION].map(tag => (
              <label key={tag} className={`flex items-center ${!hasStructureTags ? DISABLED_LABEL_CLASSES : ''}`}>
                <input
                  type="radio"
                  name={`structureFilter-${uid}`}
                  value={tag}
                  checked={structureFilter === tag}
                  onChange={() => { setStructureFilter(tag); }}
                  className="h-4 w-4 text-blue-600"
                  disabled={!hasStructureTags}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{getStructureTagLabel(tag)}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Tag filter */}
        <div className="px-4 py-2">
          <h3 className="text-sm font-medium">{t('filters.byTags')}</h3>
          <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
            {allowedTags
              // Hide structure tags here; they are controlled by the section above
              .filter(tag => normalizeStructureTag(tag.name) === null)
              .map(tag => (
                <label key={tag.name} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={tagFilters.includes(tag.name)}
                    onChange={() => { toggleTagFilter(tag.name); }}
                    className="h-4 w-4 text-blue-600"
                  />
                  <span className="ml-2 text-sm" style={{ color: tag.color }}>{tag.name}</span>
                </label>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThoughtFilterControls; 
