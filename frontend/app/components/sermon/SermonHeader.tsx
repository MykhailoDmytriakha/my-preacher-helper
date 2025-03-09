// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React from 'react';
import ExportButtons from '@components/ExportButtons';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@/utils/exportContent';
import type { Sermon } from '@/models/models';

interface SermonHeaderProps {
  sermon: Sermon;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon }) => {
  const formattedDate = formatDate(sermon.date);

  const generateExportContent = async () => {
    return getExportContent(sermon);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
      <div className="w-full">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent break-words">
            {sermon.title}
          </h1>
          <div className="mt-2 sm:mt-0">
            <ExportButtons sermonId={sermon.id} getExportContent={generateExportContent} />
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