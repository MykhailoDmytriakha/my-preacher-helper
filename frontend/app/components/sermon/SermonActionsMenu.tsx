'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
// Remove ExportButtons import if no longer needed after modal removal
// import ExportButtons from '@components/ExportButtons'; 
import { useTranslation } from 'react-i18next';
import type { Sermon } from '@/models/models';
import useSermonValidator from '@/hooks/useSermonValidator';

// Define the mode type and EXPORT it
export type SermonMode = 'framework' | 'content';

interface SermonActionsMenuProps {
  sermon: Sermon;
  mode: SermonMode; // State likely managed by parent page
  setMode: (mode: SermonMode) => void; // State setter from parent page
  // Remove generateExportContent prop
  // generateExportContent: (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => Promise<string>;
}

const SermonActionsMenu: React.FC<SermonActionsMenuProps> = ({
  sermon,
  mode,
  setMode,
  // Remove generateExportContent from destructuring
}) => {
  const { t } = useTranslation();
  const { isPlanAccessible } = useSermonValidator(sermon);
  const hasPlan = !!sermon.plan;
  const areAllThoughtsAssignedToOutlinePoints = sermon.thoughts?.every(thought => thought.outlinePointId) || false;

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Remove state related to TXT export modal
  // const [showTxtModal, setShowTxtModal] = useState(false);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Remove handlers for export modal
  // const handleExportTxt = () => { ... };
  // const handleCloseModal = () => { ... };

  return (
    <div className="mt-3 sm:mt-0 relative flex-shrink-0" ref={menuRef}>
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="px-3 py-1.5 text-xs sm:text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center"
      >
        <span>{t('common.actions')}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 ml-1 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute right-0 mt-2 w-60 bg-white dark:bg-gray-800 rounded-md shadow-lg z-50 border border-gray-200 dark:border-gray-700">
          <div className="p-2">
            {/* Remove Export Section */}
            {/* <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700"> ... </div> */}

            {/* Outline Mode Switch & Link Section */}
            <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium px-3 py-1">
                {t('sermon.outline')}
              </h3>
              <div className="flex px-3 py-2 gap-2">
                {/* ... Mode switch buttons ... */}
                <button
                  onClick={() => setMode('framework')}
                  className={`flex-1 px-2 py-1 text-xs rounded-md flex items-center justify-center ${
                    mode === 'framework'
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  <span className={`w-2 h-2 mr-1 rounded-full ${
                    mode === 'framework' ? 'bg-blue-600' : 'bg-gray-400'
                  }`}></span>
                  {t('sermon.draftMode')}
                </button>
                <button
                  onClick={() => setMode('content')}
                  className={`flex-1 px-2 py-1 text-xs rounded-md flex items-center justify-center ${
                    mode === 'content'
                      ? 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'
                  }`}
                >
                  <span className={`w-2 h-2 mr-1 rounded-full ${
                    mode === 'content' ? 'bg-green-600' : 'bg-gray-400'
                  }`}></span>
                  {t('sermon.pointMode')}
                </button>
              </div>
              <Link
                href={
                  mode === 'framework'
                    ? (isPlanAccessible ? `/sermons/${sermon.id}/outline` : '#')
                    : (areAllThoughtsAssignedToOutlinePoints ? `/sermons/${sermon.id}/plan` : '#')
                }
                onClick={(e) => {
                  if (mode === 'framework' && !isPlanAccessible) e.preventDefault();
                  if (mode === 'content' && !areAllThoughtsAssignedToOutlinePoints) e.preventDefault();
                  setMenuOpen(false); // Close menu on link click/navigation
                }}
                className={`block w-full mt-2 px-3 py-2 text-sm text-center rounded-md text-white ${
                  mode === 'framework'
                    ? (isPlanAccessible ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-400 cursor-not-allowed')
                    : (areAllThoughtsAssignedToOutlinePoints ? 'bg-green-600 hover:bg-green-700' : 'bg-green-400 cursor-not-allowed')
                }`}
                title={
                    mode === 'framework' && !isPlanAccessible ? t('sermon.createOutlineTooltip') :
                    mode === 'content' && !areAllThoughtsAssignedToOutlinePoints ? t('sermon.assignThoughtsTooltip') : ''
                }
              >
                {mode === 'framework'
                  ? (hasPlan ? t('sermon.viewOutline') : t('sermon.createOutline'))
                  : (hasPlan ? t('sermon.viewPlan') : t('sermon.createPlan'))}
                <span className="ml-1">→</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
    // Remove conditional rendering of ExportButtons modal container
    // {showTxtModal && ( ... )}
  );
};

export default SermonActionsMenu; 