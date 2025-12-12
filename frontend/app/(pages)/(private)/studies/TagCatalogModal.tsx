'use client';

import { XMarkIcon, MagnifyingGlassIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { STUDIES_INPUT_SHARED_CLASSES } from './constants';

interface TagCatalogModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** All available tags to show in catalog */
  availableTags: string[];
  /** Currently selected tags */
  selectedTags: string[];
  /** Callback when a tag is toggled (added/removed) */
  onToggleTag: (tag: string) => void;
}

/**
 * Modal dialog for browsing and selecting tags from a catalog.
 * Features real-time toggle - clicking a tag immediately adds/removes it.
 * Includes search/filter functionality for quick tag discovery.
 */
export default function TagCatalogModal({
  isOpen,
  onClose,
  availableTags,
  selectedTags,
  onToggleTag,
}: TagCatalogModalProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter tags based on search query
  const filteredTags = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return availableTags;
    return availableTags.filter((tag) => tag.toLowerCase().includes(query));
  }, [availableTags, searchQuery]);

  // Check if a tag is selected
  const isSelected = useCallback(
    (tag: string) => selectedTags.includes(tag),
    [selectedTags]
  );

  // Focus search input when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    } else {
      // Reset search when modal closes
      setSearchQuery('');
    }
  }, [isOpen]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        ref={modalRef}
        className="relative z-10 w-full max-w-md mx-4 rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-800"
        role="dialog"
        aria-modal="true"
        aria-label={t('studiesWorkspace.tagCatalog.title')}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
            {t('studiesWorkspace.tagCatalog.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200 transition-colors"
            aria-label={t('common.close')}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('studiesWorkspace.tagCatalog.searchPlaceholder')}
              className={`w-full pl-10 ${STUDIES_INPUT_SHARED_CLASSES}`}
            />
          </div>
        </div>

        {/* Tags grid */}
        <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
          {filteredTags.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {searchQuery
                ? t('studiesWorkspace.tagCatalog.noResults')
                : t('studiesWorkspace.tagCatalog.noTags')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {filteredTags.map((tag) => {
                const selected = isSelected(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => onToggleTag(tag)}
                    className={`
                      inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium
                      transition-all duration-150 ease-in-out
                      ${
                        selected
                          ? 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600'
                      }
                    `}
                    aria-pressed={selected}
                  >
                    {selected && <CheckIcon className="h-4 w-4" />}
                    {tag}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with selected summary */}
        <div className="border-t border-gray-200 px-5 py-4 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-600 dark:text-gray-300">
              {selectedTags.length > 0 ? (
                <span>
                  {t('studiesWorkspace.tagCatalog.selected')}: {' '}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                    {selectedTags.length}
                  </span>
                </span>
              ) : (
                <span className="text-gray-400 dark:text-gray-500">
                  {t('studiesWorkspace.tagCatalog.noneSelected')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition-colors"
            >
              {t('studiesWorkspace.tagCatalog.done')}
            </button>
          </div>

          {/* Selected tags preview */}
          {selectedTags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selectedTags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

