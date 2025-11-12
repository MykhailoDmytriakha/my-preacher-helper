// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import React, { useState } from 'react';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import type { Sermon, Series } from '@/models/models';
import { updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import { useTranslation } from 'react-i18next';
import { EllipsisVerticalIcon, PlusIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ScrollText } from 'lucide-react';
import { Menu, Transition } from '@headlessui/react';
import SeriesSelector from '@/components/series/SeriesSelector';
import Link from 'next/link';

export interface SermonHeaderProps {
  sermon: Sermon;
  series?: Series[]; // Series data for displaying badge
  onUpdate?: (updatedSermon: Sermon) => void; // Callback for successful update
  uiMode?: 'classic' | 'prep';
  onToggleMode?: () => void;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon, series = [], onUpdate }) => {
  const { t } = useTranslation();
  const formattedDate = formatDate(sermon.date);
  const [showSeriesSelector, setShowSeriesSelector] = useState(false);

  const handleStartPreaching = () => {
    window.location.href = `/sermons/${sermon.id}/plan?planView=preaching`;
  };
  
  const handleAddToSeries = () => {
    setShowSeriesSelector(true);
  };

  const handleChangeSeries = () => {
    setShowSeriesSelector(true);
  };

  const handleRemoveFromSeries = async () => {
    if (window.confirm('Remove this sermon from its series?')) {
      // TODO: Implement remove from series
      console.log('Remove sermon from series:', sermon.id);
    }
  };

  const handleSeriesSelected = async (seriesId: string) => {
    // TODO: Implement add/change series logic
    console.log('Selected series:', seriesId, 'for sermon:', sermon.id);
    setShowSeriesSelector(false);
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

  // Find series for this sermon
  const sermonSeries = (() => {
    // First, check if sermon has seriesId
    if (sermon.seriesId && sermon.seriesId.trim()) {
      const found = series.find(s => s.id === sermon.seriesId);
      if (found) return found;
    }
    
    // Fallback: check if sermon is in any series' sermonIds
    return series.find(s => s.sermonIds?.includes(sermon.id));
  })();

  return (
    <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-4">
      {/* Left side: Title, Date, Series Badge, Verse */}
      <div className="flex-grow">
        <EditableTitle 
          initialTitle={sermon.title}
          onSave={handleSaveSermonTitle}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>
          
          {/* Series Badge */}
          {sermonSeries && (
            <Link
              href={`/series/${sermonSeries.id}`}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:opacity-80 inline-flex items-center gap-1.5 ${
                sermonSeries.color ? '' : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
              }`}
              style={sermonSeries.color ? {
                backgroundColor: sermonSeries.color,
                color: '#ffffff',
                border: '1px solid rgba(255, 255, 255, 0.2)'
              } : {}}
              title={`${t('workspaces.series.badges.partOfSeries')}: ${sermonSeries.title}`}
            >
              <svg 
                className="w-3 h-3" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path 
                  strokeLinecap="round" 
                  strokeLinejoin="round" 
                  strokeWidth={2} 
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" 
                />
              </svg>
              <span>{sermonSeries.title}</span>
            </Link>
          )}
        </div>
        <div className="mt-2">
          <EditableVerse 
            initialVerse={sermon.verse || ''}
            onSave={handleSaveSermonVerse}
          />
        </div>
      </div>

      {/* Right side: Preach Button, Series Menu, and Export Buttons */}
      <div className="flex items-center gap-2 mt-2 sm:mt-0 flex-shrink-0">
        <button
          onClick={handleStartPreaching}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          title={t('plan.preachButton') || 'Preach'}
        >
          <ScrollText className="h-4 w-4" />
          <span className="hidden sm:inline">{t('plan.preachButton') || 'Preach'}</span>
        </button>

        {/* Series Management Dropdown */}
        <Menu as="div" className="relative">
          <Menu.Button className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <EllipsisVerticalIcon className="h-5 w-5 text-gray-500 dark:text-gray-400" />
          </Menu.Button>
          <Transition
            enter="transition ease-out duration-100"
            enterFrom="transform opacity-0 scale-95"
            enterTo="transform opacity-100 scale-100"
            leave="transition ease-in duration-75"
            leaveFrom="transform opacity-100 scale-100"
            leaveTo="transform opacity-0 scale-95"
          >
            <Menu.Items className="absolute right-0 z-10 mt-2 w-48 origin-top-right rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800 dark:ring-gray-700">
              {sermon.seriesId ? (
                <>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={handleChangeSeries}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-sm ${
                          active ? 'bg-gray-100 dark:bg-gray-700' : ''
                        }`}
                      >
                        <ArrowPathIcon className="h-4 w-4" />
                        {t('workspaces.series.actions.editSeries')}
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        onClick={handleRemoveFromSeries}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 ${
                          active ? 'bg-red-50 dark:bg-red-950' : ''
                        }`}
                      >
                        <XMarkIcon className="h-4 w-4" />
                        {t('workspaces.series.actions.removeFromSeries')}
                      </button>
                    )}
                  </Menu.Item>
                </>
              ) : (
                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={handleAddToSeries}
                      className={`flex w-full items-center gap-2 px-4 py-2 text-sm ${
                        active ? 'bg-gray-100 dark:bg-gray-700' : ''
                      }`}
                    >
                      <PlusIcon className="h-4 w-4" />
                      {t('workspaces.series.actions.addSermon')}
                    </button>
                  )}
                </Menu.Item>
              )}
            </Menu.Items>
          </Transition>
        </Menu>

        <ExportButtons
            sermonId={sermon.id}
            getExportContent={generateExportContent}
            getPdfContent={getPdfContent} // Pass the PDF content function
            title={sermon.title || "Sermon Details"}
            disabledFormats={['pdf']} // Disable PDF export here
        />
        {/* Mode toggle moved to global DashboardNav */}
      </div>

      {/* Series Selector Modal */}
      {showSeriesSelector && (
        <SeriesSelector
          onClose={() => setShowSeriesSelector(false)}
          onSelect={handleSeriesSelected}
          currentSeriesId={sermon.seriesId}
        />
      )}
    </div>
  );
};

export default SermonHeader;