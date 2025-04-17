// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import { useTranslation } from 'react-i18next';
import type { Sermon } from '@/models/models';
import type { SermonMode } from './SermonActionsMenu';
import useSermonValidator from '@/hooks/useSermonValidator';
import { updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import SermonActionsMenu from './SermonActionsMenu'; // Import the new actions menu component
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons

export interface SermonHeaderProps {
  sermon: Sermon;
  onUpdate?: (updatedSermon: Sermon) => void; // Callback for successful update
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon, onUpdate }) => {
  const formattedDate = formatDate(sermon.date);
  const { t } = useTranslation();
  
  // Re-introduce mode state here, as SermonActionsMenu expects it as a prop
  const [mode, setMode] = useState<SermonMode>('content'); 

  const generateExportContent = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean }) => {
    return getExportContent(sermon, undefined, { 
      format, 
      includeTags: options?.includeTags 
    });
  };
  
  // Placeholder for PDF content generation (adjust as needed)
  const getPdfContent = async (): Promise<React.ReactNode> => {
    // This function should return the React node structure for PDF rendering
    // Similar to how it might be implemented in the plan page
    // For now, return a simple placeholder
    return (
      <div>
        <h1>{sermon.title}</h1>
        <p>{sermon.verse}</p>
        {/* Add more content structure here */}
      </div>
    );
  };

  // Handler passed to EditableTitle
  const handleSaveSermonTitle = async (newTitle: string) => {
    const updatedSermonData = { ...sermon, title: newTitle };
    try {
      const updatedResult = await updateSermon(updatedSermonData);
      if (updatedResult && onUpdate) {
        onUpdate(updatedResult);
      }
    } catch (error) {
      console.error("Error saving sermon title:", error);
      throw error; 
    }
  };

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
      {/* Left side: Title, Date, Verse */}
      <div className="flex-grow">
        <EditableTitle 
          initialTitle={sermon.title}
          onSave={handleSaveSermonTitle}
        />
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

      {/* Right side: Export Buttons and Actions Menu */}
      <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0">
        <ExportButtons
            sermonId={sermon.id}
            getExportContent={generateExportContent}
            getPdfContent={getPdfContent} // Pass the PDF content function
            title={sermon.title || "Sermon Details"}
            disabledFormats={['pdf']} // Disable PDF export here
        />
        <SermonActionsMenu 
            sermon={sermon}
            mode={mode} 
            setMode={setMode} 
            // Remove generateExportContent prop from here
        />
      </div>
    </div>
  );
};

export default SermonHeader;