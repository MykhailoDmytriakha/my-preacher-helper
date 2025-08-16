import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { ViewFilter, StructureFilter, SortOrder } from '@hooks/useThoughtFiltering';
import { STRUCTURE_TAGS } from '@lib/constants';

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

  // Handle clicks outside the filter dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isOpen && 
        filterRef.current && 
        !filterRef.current.contains(event.target as Node) &&
        buttonRef.current && // Check button ref as well
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [filterRef, buttonRef, isOpen, setIsOpen]); // Include buttonRef and setIsOpen

  if (!isOpen) return null;

  return (
    <div 
      ref={filterRef}
      onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
      className="absolute right-0 mt-2 w-64 rounded-md shadow-lg bg-white dark:bg-gray-800 ring-1 ring-black ring-opacity-5 z-10"
      style={{ maxWidth: 'calc(100vw - 32px)' }}
      data-testid="thought-filter-controls"
    >
      <div className="py-1 divide-y divide-gray-200 dark:divide-gray-700">
        {/* View options */}
        <div className="px-4 py-2">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-medium">{t('filters.viewOptions')}</h3>
            <button 
              onClick={resetFilters}
              className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
            >
              {t('filters.reset')}
            </button>
          </div>
          <div className="mt-2 space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="viewFilter"
                value="all"
                checked={viewFilter === 'all'}
                onChange={() => setViewFilter('all')}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.all')}</span>
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name="viewFilter"
                value="missingTags"
                checked={viewFilter === 'missingTags'}
                onChange={() => setViewFilter('missingTags')}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.missingTags')}</span>
            </label>
          </div>
        </div>
        
        {/* Structure filter */}
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
            <label className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="radio"
                name="structureFilter"
                value="all"
                checked={structureFilter === 'all'}
                onChange={() => setStructureFilter('all')}
                className="h-4 w-4 text-blue-600"
                disabled={!hasStructureTags}
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.allStructure')}</span>
            </label>
            {/* Use STRUCTURE_TAGS constants */}
            {[STRUCTURE_TAGS.INTRODUCTION, STRUCTURE_TAGS.MAIN_BODY, STRUCTURE_TAGS.CONCLUSION].map(tag => (
              <label key={tag} className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
                <input
                  type="radio"
                  name="structureFilter"
                  value={tag}
                  checked={structureFilter === tag}
                  onChange={() => setStructureFilter(tag)}
                  className="h-4 w-4 text-blue-600"
                  disabled={!hasStructureTags}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t(`tags.${tag.toLowerCase().replace(/\s+/g, '_')}`)}</span> {/* Adjust translation key if needed */}
              </label>
            ))}
          </div>
        </div>
        
        {/* Sort order */}
        <div className="px-4 py-2">
          <h3 className="text-sm font-medium">{t('filters.sortOrder') || 'Sort Order'}</h3>
          <div className="mt-2 space-y-2">
            <label className="flex items-center">
              <input
                type="radio"
                name="sortOrder"
                value="date"
                checked={sortOrder === 'date'}
                onChange={() => setSortOrder('date')}
                className="h-4 w-4 text-blue-600"
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">{t('filters.sortByDate') || 'By Date (Newest First)'}</span>
            </label>
            <label className={`flex items-center ${!hasStructureTags ? 'opacity-50 cursor-not-allowed' : ''}`}>
              <input
                type="radio"
                name="sortOrder"
                value="structure"
                checked={sortOrder === 'structure'}
                onChange={() => setSortOrder('structure')}
                className="h-4 w-4 text-blue-600"
                disabled={!hasStructureTags}
              />
              <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">
                {t('filters.sortByStructure') || 'By Structure (Intro → Main → Conclusion)'}
                {!hasStructureTags && (
                  <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                    ({t('filters.requiresStructureTags') || 'Requires structure tags'})
                  </span>
                )}
              </span>
            </label>
          </div>
        </div>
        
        {/* Tag filter */}
        <div className="px-4 py-2">
          <h3 className="text-sm font-medium">{t('filters.byTags')}</h3>
          <div className="mt-2 space-y-2 max-h-48 overflow-y-auto">
            {allowedTags.map(tag => (
              <label key={tag.name} className="flex items-center">
                <input
                  type="checkbox"
                  checked={tagFilters.includes(tag.name)}
                  onChange={() => toggleTagFilter(tag.name)}
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