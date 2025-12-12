// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import { Menu, Transition } from '@headlessui/react';
import { EllipsisVerticalIcon, PlusIcon, ArrowPathIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import SeriesSelector from '@/components/series/SeriesSelector';
import { addSermonToSeries, removeSermonFromSeries } from '@/services/series.service';
import { updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';

import type { Sermon, Series } from '@/models/models';




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
  const [seriesSelectorMode, setSeriesSelectorMode] = useState<'add' | 'change'>('add');
  const [isProcessing, setIsProcessing] = useState(false);

  // Use direct translation calls to avoid duplicate string warnings
  const removeFromSeriesTranslationKey = 'workspaces.series.actions.removeFromSeries';
  const processingButtonClasses = 'opacity-50 cursor-not-allowed';

  const handleStartPreaching = () => {
    window.location.href = `/sermons/${sermon.id}/plan?planView=preaching`;
  };
  
  const handleAddToSeries = () => {
    setSeriesSelectorMode('add');
    setShowSeriesSelector(true);
  };

  const handleChangeSeries = () => {
    setSeriesSelectorMode('change');
    setShowSeriesSelector(true);
  };

  const handleRemoveFromSeries = async () => {
    if (window.confirm(t(removeFromSeriesTranslationKey) + '?')) {
      setIsProcessing(true);
      try {
        if (sermon.seriesId) {
          await removeSermonFromSeries(sermon.seriesId, sermon.id);

          // Update sermon locally to reflect the change
          const updatedSermon = { ...sermon, seriesId: undefined, seriesPosition: undefined };
          if (onUpdate) {
            onUpdate(updatedSermon);
          }
        }
      } catch (error) {
        console.error('Error removing sermon from series:', error);
        toast.error(t('workspaces.series.errors.removeSermonFailed'));
      } finally {
        setIsProcessing(false);
      }
    }
  };

  const handleSeriesSelected = async (seriesId: string) => {
    setIsProcessing(true);
    try {
      if (seriesSelectorMode === 'change' && sermon.seriesId) {
        // For change mode: first remove from old series, then add to new
        await removeSermonFromSeries(sermon.seriesId, sermon.id);
      }

      // Add sermon to the selected series
      await addSermonToSeries(seriesId, sermon.id);

      // Update sermon locally to reflect the change
      const updatedSermon = { ...sermon, seriesId };
      if (onUpdate) {
        onUpdate(updatedSermon);
      }

      setShowSeriesSelector(false);
    } catch (error) {
      console.error('Error updating sermon series:', error);
      toast.error(seriesSelectorMode === 'add'
        ? t('workspaces.series.errors.addSermonFailed')
        : t('workspaces.series.errors.addSermonFailed')
      );
    } finally {
      setIsProcessing(false);
    }
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
    // Only check if sermon has seriesId (no fallback to avoid stale data)
    if (sermon.seriesId && sermon.seriesId.trim()) {
      const found = series.find(s => s.id === sermon.seriesId);
      if (found) return found;
    }

    return undefined;
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
            <div className="flex items-center gap-1">
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

              {/* Series Management Dropdown - moved next to badge */}
              <Menu as="div" className="relative">
                <Menu.Button className="flex items-center justify-center w-6 h-6 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ml-1">
                  <EllipsisVerticalIcon className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                </Menu.Button>
                <Transition
                  enter="transition ease-out duration-100"
                  enterFrom="transform opacity-0 scale-95"
                  enterTo="transform opacity-100 scale-100"
                  leave="transition ease-in duration-75"
                  leaveFrom="transform opacity-100 scale-100"
                  leaveTo="transform opacity-0 scale-95"
                >
                  <Menu.Items className="absolute left-0 z-10 mt-1 w-56 origin-top-left rounded-md bg-white py-1 shadow-lg ring-1 ring-black ring-opacity-5 dark:bg-gray-800 dark:ring-gray-700">
                    {sermon.seriesId ? (
                      <>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={handleChangeSeries}
                              disabled={isProcessing}
                              title={t('workspaces.series.actions.moveToDifferentSeries')}
                              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm ${
                                active ? 'bg-gray-100 dark:bg-gray-700' : ''
                              } ${isProcessing ? processingButtonClasses : ''}`}
                            >
                              <ArrowPathIcon className="h-4 w-4" />
                              {t('workspaces.series.actions.moveToDifferentSeries')}
                            </button>
                          )}
                        </Menu.Item>
                        <Menu.Item>
                          {({ active }) => (
                            <button
                              onClick={handleRemoveFromSeries}
                              disabled={isProcessing}
                              title={t(removeFromSeriesTranslationKey)}
                              className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 dark:text-red-400 ${
                                active ? 'bg-red-50 dark:bg-red-950' : ''
                              } ${isProcessing ? processingButtonClasses : ''}`}
                            >
                              <XMarkIcon className="h-4 w-4" />
                              {t(removeFromSeriesTranslationKey)}
                            </button>
                          )}
                        </Menu.Item>
                      </>
                    ) : (
                      <Menu.Item>
                        {({ active }) => (
                          <button
                            onClick={handleAddToSeries}
                            disabled={isProcessing}
                            title={t('workspaces.series.actions.addToSeries')}
                            className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm ${
                              active ? 'bg-gray-100 dark:bg-gray-700' : ''
                            } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
                          >
                            <PlusIcon className="h-4 w-4" />
                            {t('workspaces.series.actions.addToSeries')}
                          </button>
                        )}
                      </Menu.Item>
                    )}
                  </Menu.Items>
                </Transition>
              </Menu>
            </div>
          )}
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

      {/* Series Selector Modal */}
      {showSeriesSelector && (
        <SeriesSelector
          onClose={() => setShowSeriesSelector(false)}
          onSelect={handleSeriesSelected}
          currentSeriesId={sermon.seriesId}
          mode={seriesSelectorMode}
        />
      )}
    </div>
  );
};

export default SermonHeader;