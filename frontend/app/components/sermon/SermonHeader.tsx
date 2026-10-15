// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import { Church, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useTranslation } from 'react-i18next';

import ActionButton, { ACTION_BUTTON_SLOT_CLASS } from '@/components/common/ActionButton';
import OptionMenu from '@/components/dashboard/OptionMenu';
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import { SermonStatusChip, getSermonStatusDateTexts } from '@/components/sermon/SermonStatusChip';
import SourceNoteChips from '@/components/sermon/SourceNoteChips';
import { DataSyncStatus } from '@/data-engine/DataSyncStatus';
import { useAppLocale } from '@/hooks/useAppLocale';
import { useAuth } from '@/hooks/useAuth';
import { useUserSettings } from '@/hooks/useUserSettings';
import { leadingReference } from '@/utils/bibleLink';
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import { buildChipClasses } from '@utils/chipClasses';
import { getContrastColor } from '@utils/color';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import { getSeriesForRef } from '@utils/seriesMembership';
import { getSermonPlanData } from '@utils/sermonPlanAccess';

import type { ManualTextBinding } from '@/components/common/manualTextBinding';
import type { SyncStatus } from '@/data-engine/status';
import type { Sermon, Series } from '@/models/models';




export interface SermonHeaderEditor {
  /** What its sync block speaks about: the document's `recoveryIdentity`. */
  subject: unknown;
  values: Pick<Sermon, 'title' | 'verse'>;
  isReadOnly: boolean;
  status: SyncStatus | null;
  error?: string | null;
  titleForm: ManualTextBinding;
  verseForm: ManualTextBinding;
  keepLocal: () => Promise<void>;
  acceptRemote: () => Promise<void>;
  retry: () => Promise<void>;
}

export interface SermonHeaderProps {
  sermon: Sermon;
  series?: Series[]; // Series data for displaying badge
  uiMode?: 'classic' | 'prep';
  onToggleMode?: () => void;
  /** The engine document's draft values and commands. */
  editor: SermonHeaderEditor;
}

const SermonHeader: React.FC<SermonHeaderProps> = ({ sermon, series = [], editor }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { locale } = useAppLocale();
  const { user } = useAuth();
  const { settings } = useUserSettings(user?.uid);
  const formattedDate = formatDate(sermon.date);
  const { formattedPreachedDate, formattedPlannedDate } = getSermonStatusDateTexts(sermon);
  const isReadOnly = Boolean(editor.isReadOnly || editor.status?.phase === 'deleted');

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

  // Which series is this sermon in — DERIVED from the loaded series list
  // (series.items is the sole truth; the deprecated sermon.seriesId is ignored).
  const sermonSeries = getSeriesForRef(sermon.id, series);

  const sermonSeriesBadgeColor = sermonSeries?.color;
  const sermonSeriesTextColor = sermonSeriesBadgeColor ? getContrastColor(sermonSeriesBadgeColor) : undefined;
  const sermonSeriesBorderColor = sermonSeriesTextColor === '#000'
    ? 'rgba(0, 0, 0, 0.15)'
    : 'rgba(255, 255, 255, 0.2)';

  return (
    <div className="flex flex-col gap-4">
      {/* The document's delivery and any choice it needs (keep mine / take theirs) speak here. */}
      <DataSyncStatus subject={editor.subject} status={editor.status} error={editor.error}
        onKeepLocal={editor.keepLocal} onAcceptRemote={editor.acceptRemote} onRetry={editor.retry} />
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      {/* Title and identity share the top row with the actions on wide screens. */}
      <div className="min-w-0">
        <EditableTitle
          initialTitle={editor.values.title}
          onSave={editor.titleForm.save}
          manual={editor.titleForm}
          disabled={isReadOnly}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>

          {/* Same status chip the dashboard card shows: preached date, else planned date. */}
          <SermonStatusChip formattedPreachedDate={formattedPreachedDate} formattedPlannedDate={formattedPlannedDate} />

          {/* WHO THIS SERMON IS BEING PREPARED FOR. Stated at creation and often known
              long before any date, so it is shown next to the date rather than inside the
              calendar — see `Sermon.church`. Silent when nobody named a congregation. */}
          {sermon.church?.name && (
            <span
              className={`${buildChipClasses({ tone: 'cyan', size: 'sm' })} gap-1.5`}
              title={t('calendar.church')}
            >
              <Church className="h-3 w-3" aria-hidden="true" />
              <span className="truncate">
                {sermon.church.name}
                {sermon.church.city ? `, ${sermon.church.city}` : ''}
              </span>
            </span>
          )}

          {/* Series Badge - only when sermon is in a series */}
          {sermonSeries && (
            <div className="flex items-center gap-1">
              <Link
                href={`/series/${sermonSeries.id}`}
                className={`${buildChipClasses({ tone: sermonSeries.color ? 'custom' : 'blue', size: 'sm' })} gap-1.5 hover:opacity-80`}
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

          {/* Where this sermon came FROM. Same identity row as the series badge, quieter
              styling, and each chip opens the note it names. */}
          <SourceNoteChips sermon={sermon} />
        </div>
      </div>

      {/* Scripture uses both columns; on small screens it stays before the actions. */}
      <div className="order-1 min-w-0 text-base md:text-lg lg:order-2 lg:col-span-2">
          <EditableVerse
            initialVerse={editor.values.verse || ''}
            openingReference={leadingReference(editor.values.verse || '', { locale, from: `/sermons/${sermon.id}` })}
            onOpenReference={(href) => router.push(href)}
            onSave={editor.verseForm.save}
            manual={editor.verseForm}
            disabled={isReadOnly}
          />
      </div>

      {/* Right side: Preach Button and Export Buttons */}
      <div className="order-2 flex w-full flex-wrap items-center gap-2 mt-4 lg:order-1 lg:mt-0 lg:w-auto">
        <ExportButtons
          sermonId={sermon.id}
          getExportContent={generateExportContent}
          getPdfContent={getPdfContent} // Pass the PDF content function
          title={sermon.title || t('dashboardHome.sections.sermons.untitled')}
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
                title={t('plan.preachButton')}
              >
                <ScrollText className="h-4 w-4 flex-shrink-0" />
                <span className="hidden sm:inline">{t('plan.preachButton')}</span>
              </ActionButton>
            </div>
          }
        />
        {/* Sermon-level actions (mark preached / edit date & church / delete) — reuses the
            dashboard OptionMenu so the lifecycle logic lives in ONE place. Delete navigates
            away (we're ON the sermon being deleted), rather than refreshing a dead page.
            REPLACE, not push: pushing left this very page in history, so a swipe back
            re-opened a full editor over a sermon that no longer exists — BUG-20260905. */}
        {!editor.isReadOnly && <OptionMenu
          sermon={sermon}
          series={series}
          onDelete={() => router.replace('/sermons')}
        />}
        {/* Mode toggle moved to global DashboardNav */}
      </div>
      </div>
    </div>
  );
};

export default SermonHeader;
