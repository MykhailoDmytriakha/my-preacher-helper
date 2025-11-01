// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React from 'react';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import type { Sermon } from '@/models/models';
import { updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import { useTranslation } from 'react-i18next';
import { ScrollText } from 'lucide-react';

export interface SermonHeaderProps {
  sermon: Sermon;
  onUpdate?: (updatedSermon: Sermon) => void; // Callback for successful update
  uiMode?: 'classic' | 'prep';
  onToggleMode?: () => void;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon, onUpdate }) => {
  const { t } = useTranslation();
  const formattedDate = formatDate(sermon.date);

  const handleStartPreaching = () => {
    window.location.href = `/sermons/${sermon.id}/plan?planView=preaching`;
  };
  
  
  // Removed legacy mode switch (framework/content)

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

  // Handler passed to EditableVerse
  const handleSaveSermonVerse = async (newVerse: string) => {
    const updatedSermonData = { ...sermon, verse: newVerse };
    try {
      const updatedResult = await updateSermon(updatedSermonData);
      if (updatedResult && onUpdate) {
        onUpdate(updatedResult);
      }
    } catch (error) {
      console.error("Error saving sermon verse:", error);
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
        <div className="mt-2">
          <EditableVerse 
            initialVerse={sermon.verse || ''}
            onSave={handleSaveSermonVerse}
          />
        </div>
      </div>

      {/* Right side: Preach Button and Export Buttons */}
      <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0">
        <button
          onClick={handleStartPreaching}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          title={t('plan.preachButton') || 'Preach'}
        >
          <ScrollText className="h-4 w-4" />
          <span className="hidden sm:inline">{t('plan.preachButton') || 'Preach'}</span>
        </button>
        <ExportButtons
            sermonId={sermon.id}
            getExportContent={generateExportContent}
            getPdfContent={getPdfContent} // Pass the PDF content function
            title={sermon.title || "Sermon Details"}
            disabledFormats={['pdf']} // Disable PDF export here
        />
        {/* Mode toggle moved to global DashboardNav */}
      </div>
    </div>
  );
};

export default SermonHeader;