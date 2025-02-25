// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React from 'react';
import ExportButtons from '@components/ExportButtons';
import { formatDate } from '@utils/dateFormatter';
import { exportSermonContent } from '@/utils/exportContent';
import type { Sermon } from '@/models/models';

interface SermonHeaderProps {
  sermon: Sermon;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon }) => {
  const formattedDate = formatDate(sermon.date);

  const generateExportContent = async () => {
    return exportSermonContent(sermon);
  };

  return (
    <div className="flex justify-between items-start">
      <div>
        <div className="flex items-center gap-4">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            {sermon.title}
          </h1>
          <ExportButtons sermonId={sermon.id} getExportContent={generateExportContent} />
        </div>
        <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>
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