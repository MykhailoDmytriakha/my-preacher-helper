// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import ExportButtons from '@components/ExportButtons';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@/utils/exportContent';
import { useTranslation } from 'react-i18next';
import type { Sermon } from '@/models/models';
import useSermonValidator from '@/hooks/useSermonValidator';

interface SermonHeaderProps {
  sermon: Sermon;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon }) => {
  const formattedDate = formatDate(sermon.date);
  const { t } = useTranslation();
  const hasPlan = !!sermon.plan;
  const { isPlanAccessible } = useSermonValidator(sermon);
  const [mode, setMode] = useState('framework');

  // Check if all thoughts are assigned to outline points
  const areAllThoughtsAssignedToOutlinePoints = sermon.thoughts?.every(thought => thought.outlinePointId) || false;

  const generateExportContent = async (format: 'plain' | 'markdown') => {
    return getExportContent(sermon, undefined, { format });
  };

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
      <div className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent break-words">
            {sermon.title}
          </h1>
          <div className="mt-3 sm:mt-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
            <ExportButtons sermonId={sermon.id} getExportContent={generateExportContent} />
            <div className="relative">
              <div className="flex items-center bg-white dark:bg-gray-800 border rounded-md overflow-hidden">
                <button 
                  onClick={() => setMode('framework')}
                  className={`flex items-center px-3 py-2 ${
                    mode === 'framework' ? 'bg-blue-100 dark:bg-blue-900' : ''
                  }`}
                >
                  <span className={`w-4 h-4 mr-2 rounded-full ${
                    mode === 'framework' ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}></span>
                  <span className={mode === 'framework' ? 'font-medium' : ''}>{t('sermon.draftMode')}</span>
                </button>
                <div className="h-10 w-px bg-gray-300 dark:bg-gray-600"></div>
                <button 
                  onClick={() => setMode('content')}
                  className={`flex items-center px-3 py-2 ${
                    mode === 'content' ? 'bg-green-100 dark:bg-green-900' : ''
                  }`}
                >
                  <span className={`w-4 h-4 mr-2 rounded-full ${
                    mode === 'content' ? 'bg-green-600' : 'bg-gray-300 dark:bg-gray-600'
                  }`}></span>
                  <span className={mode === 'content' ? 'font-medium' : ''}>{t('sermon.pointMode')}</span>
                </button>
                <div className="h-10 w-px bg-gray-300 dark:bg-gray-600"></div>
                <Link 
                  href={
                    mode === 'framework' 
                      ? (isPlanAccessible ? `/sermons/${sermon.id}/outline` : '#') 
                      : (areAllThoughtsAssignedToOutlinePoints ? `/sermons/${sermon.id}/plan` : '#')
                  }
                  onClick={(e) => {
                    if (mode === 'framework' && !isPlanAccessible) e.preventDefault();
                    if (mode === 'content' && !areAllThoughtsAssignedToOutlinePoints) e.preventDefault();
                  }}
                  className={`px-4 py-2 text-white transition-colors ${
                    mode === 'framework' 
                      ? (isPlanAccessible ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-400 cursor-not-allowed')
                      : (areAllThoughtsAssignedToOutlinePoints ? 'bg-green-600 hover:bg-green-700' : 'bg-green-400 cursor-not-allowed')
                  } group relative`}
                >
                  {mode === 'framework' 
                    ? (hasPlan ? t('sermon.viewOutline') : t('sermon.createOutline'))
                    : (hasPlan ? t('sermon.viewPlan') : t('sermon.createPlan'))}
                  <span className="ml-1">→</span>
                  
                  {/* Tooltips */}
                  {mode === 'framework' && !isPlanAccessible && (
                    <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-12 w-64 p-2 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      {t('structure.linkThoughtsWarning')}
                    </div>
                  )}
                  {mode === 'content' && !areAllThoughtsAssignedToOutlinePoints && (
                    <div className="absolute left-1/2 transform -translate-x-1/2 -bottom-12 w-64 p-2 bg-gray-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity z-50">
                      {t('plan.assignThoughtsFirst')}
                    </div>
                  )}
                </Link>
              </div>
            </div>
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
      </div>
    </div>
  );
};

export default SermonHeader; 