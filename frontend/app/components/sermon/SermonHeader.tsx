// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import { ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useTranslation } from 'react-i18next';

import ActionButton, { ACTION_BUTTON_SLOT_CLASS } from '@/components/common/ActionButton';
import OptionMenu from '@/components/dashboard/OptionMenu';
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import { getContrastColor } from '@utils/color';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import { getSermonPlanData } from '@utils/sermonPlanAccess';

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
  const router = useRouter();
  const { user } = useAuth();
  const { settings } = useUserSettings(user?.uid);
  const formattedDate = formatDate(sermon.date);
  const isReadOnly = false; // Always allow local edits

  const enableAudio = settings?.enableAudioGeneration || false;

  const handleStartPreaching = () => {
    window.location.href = `/sermons/${sermon.id}/plan?planView=preaching`;
  };

  // Removed legacy mode switch (framework/content)

  const generateExportContent = async (format: 'plain' | 'markdown', options?: { includeTags?: boolean; type?: 'thoughts' | 'plan' }) => {
    return getExportContent(sermon, undefined, {
      format,
      includeTags: options?.includeTags,
      type: options?.type
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
    if (isReadOnly) return;
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
    if (isReadOnly) return;
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

  const sermonSeriesBadgeColor = sermonSeries?.color;
  const sermonSeriesTextColor = sermonSeriesBadgeColor ? getContrastColor(sermonSeriesBadgeColor) : undefined;
  const sermonSeriesBorderColor = sermonSeriesTextColor === '#000'
    ? 'rgba(0, 0, 0, 0.15)'
    : 'rgba(255, 255, 255, 0.2)';

  return (
    <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
      {/* Left side: Title, Date, Series Badge, Verse */}
      <div className="flex-grow min-w-0">
        <EditableTitle
          initialTitle={sermon.title}
          onSave={handleSaveSermonTitle}
          disabled={isReadOnly}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>

          {/* Series Badge - only when sermon is in a series */}
          {sermonSeries && (
            <div className="flex items-center gap-1">
              <Link
                href={`/series/${sermonSeries.id}`}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-all hover:opacity-80 inline-flex items-center gap-1.5 ${sermonSeries.color ? '' : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  }`}
                style={sermonSeries.color ? {
                  backgroundColor: sermonSeries.color,
                  color: sermonSeriesTextColor,
                  border: `1px solid ${sermonSeriesBorderColor}`
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
            </div>
          )}
        </div>
        <div className="mt-2 text-base md:text-lg">
          <EditableVerse
            initialVerse={sermon.verse || ''}
            onSave={handleSaveSermonVerse}
            disabled={isReadOnly}
          />
        </div>
      </div>

      {/* Right side: Preach Button and Export Buttons */}
      <div className="flex flex-wrap items-center gap-2 mt-4 lg:mt-0 flex-shrink-0 w-full lg:w-auto">
        <ExportButtons
          sermonId={sermon.id}
          getExportContent={generateExportContent}
          getPdfContent={getPdfContent} // Pass the PDF content function
          title={sermon.title || "Sermon Details"}
          disabledFormats={['pdf']} // Disable PDF export here
          enableAudio={enableAudio}
          sermonTitle={sermon.title}
          slotClassName={ACTION_BUTTON_SLOT_CLASS}
          className="w-full sm:w-auto"
          planData={getSermonPlanData(sermon)}
          extraButtons={
            <div className={`${ACTION_BUTTON_SLOT_CLASS} sm:min-w-[150px]`}>
              <ActionButton
                onClick={handleStartPreaching}
                className="bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 font-medium"
                title={t('plan.preachButton') || 'Preach'}
              >
                <ScrollText className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">{t('plan.preachButton') || 'Preach'}</span>
              </ActionButton>
            </div>
          }
        />
        {/* Sermon-level actions (mark preached / edit date & church / delete) — reuses the
            dashboard OptionMenu so the lifecycle logic lives in ONE place. Delete navigates
            away (we're ON the sermon being deleted), rather than refreshing a dead page. */}
        <OptionMenu
          sermon={sermon}
          series={series}
          onUpdate={onUpdate}
          onDelete={() => router.push('/sermons')}
        />
        {/* Mode toggle moved to global DashboardNav */}
      </div>
    </div>
  );
};

export default SermonHeader;
