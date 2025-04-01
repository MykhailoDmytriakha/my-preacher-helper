// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React from 'react';
import Link from 'next/link';
import ExportButtons from '@components/ExportButtons';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@/utils/exportContent';
import { useTranslation } from 'react-i18next';
import type { Sermon } from '@/models/models';

interface SermonHeaderProps {
  sermon: Sermon;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon }) => {
  const formattedDate = formatDate(sermon.date);
  const { t } = useTranslation();
  const hasPlan = !!sermon.plan;

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
            <Link 
              href={`/sermons/${sermon.id}/outline`} 
              className="px-4 py-2 text-center text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors"
            >
              {hasPlan ? t('sermon.viewOutline') : t('sermon.createOutline')}
            </Link>
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