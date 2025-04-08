// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import ExportButtons from '@components/ExportButtons';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@/utils/exportContent';
import { useTranslation } from 'react-i18next';
import type { Sermon } from '@/models/models';
import useSermonValidator from '@/hooks/useSermonValidator';

export interface SermonHeaderProps {
  sermon: Sermon;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon }) => {
  const formattedDate = formatDate(sermon.date);
  const { t } = useTranslation();
  const hasPlan = !!sermon.plan;
  const { isPlanAccessible } = useSermonValidator(sermon);
  const [mode, setMode] = useState('framework');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [showTxtModal, setShowTxtModal] = useState(false);

  // Check if all thoughts are assigned to outline points
  const areAllThoughtsAssignedToOutlinePoints = sermon.thoughts?.every(thought => thought.outlinePointId) || false;

  const generateExportContent = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => {
    return getExportContent(sermon, undefined, { 
      format, 
      includeTags: options?.includeTags 
    });
  };

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

  const handleExportTxt = () => {
    setShowTxtModal(true);
    setMenuOpen(false);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
      <div className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent break-words">
            {sermon.title}
          </h1>
          <div className="mt-3 sm:mt-0 relative" ref={menuRef}>
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
                  <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium px-3 py-1">
                      {t('export.exportTo')}
                    </h3>
                    <button 
                      onClick={handleExportTxt}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md flex items-center text-blue-600 dark:text-blue-400"
                    >
                      <span>TXT</span>
                    </button>
                    <button 
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md flex items-center text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      disabled
                    >
                      <span>PDF</span>
                      <span className="ml-2 text-xs bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">
                        {t('export.soonAvailable')}
                      </span>
                    </button>
                    <button 
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md flex items-center text-gray-400 dark:text-gray-500 cursor-not-allowed"
                      disabled
                    >
                      <span>Word</span>
                      <span className="ml-2 text-xs bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded">
                        {t('export.soonAvailable')}
                      </span>
                    </button>
                  </div>
                  
                  <div className="mb-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-xs uppercase text-gray-500 dark:text-gray-400 font-medium px-3 py-1">
                      {t('sermon.outline')}
                    </h3>
                    <div className="flex px-3 py-2 gap-2">
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
                        setMenuOpen(false);
                      }}
                      className={`block w-full mt-2 px-3 py-2 text-sm text-center rounded-md text-white ${
                        mode === 'framework' 
                          ? (isPlanAccessible ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-400 cursor-not-allowed') 
                          : (areAllThoughtsAssignedToOutlinePoints ? 'bg-green-600 hover:bg-green-700' : 'bg-green-400 cursor-not-allowed')
                      }`}
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
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>
          <span className="text-xs bg-gray-200 text-gray-700 px-1 rounded dark:bg-gray-600 dark:text-gray-300">
            ID: {sermon.id}
          </span>
        </div>
        <div>
          {sermon.verse && (
            <p className="mt-2 text-gray-600 dark:text-gray-300 font-medium whitespace-pre-line">
              {sermon.verse}
            </p>
          )}
        </div>
        
        {/* TXT Export Modal */}
        {showTxtModal && (
          <ExportButtons 
            sermonId={sermon.id} 
            getExportContent={generateExportContent}
            showTxtModalDirectly={true}
            onTxtModalClose={() => setShowTxtModal(false)}
          />
        )}
      </div>
    </div>
  );
};

export default SermonHeader; 