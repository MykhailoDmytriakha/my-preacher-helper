// This is the SermonHeader component created to refactor the header UI from the sermon page
'use client';

import { Church, ScrollText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import ActionButton, { ACTION_BUTTON_SLOT_CLASS } from '@/components/common/ActionButton';
import OptionMenu from '@/components/dashboard/OptionMenu';
import ExportButtons from '@/components/ExportButtons'; // Import ExportButtons
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import SourceNoteChips from '@/components/sermon/SourceNoteChips';
import { useAuth } from '@/hooks/useAuth';
import { usePersistedConflict } from '@/hooks/usePersistedConflict';
import { useUserSettings } from '@/hooks/useUserSettings';
import { isOfflineQueuedError, isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { getSermonById, updateSermon } from '@/services/sermon.service'; // Import updateSermon service
import { SERMON_CORE_AGGREGATE } from "@/services/sermons.client";
import EditableTitle from '@components/common/EditableTitle'; // Import the new component
import EditableVerse from '@components/common/EditableVerse'; // Import the new verse component
import { buildChipClasses } from '@utils/chipClasses';
import { getContrastColor } from '@utils/color';
import { formatDate } from '@utils/dateFormatter';
import { getExportContent } from '@utils/exportContent';
import { getSeriesForRef } from '@utils/seriesMembership';
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

  /**
   * A refused save, held so the person can decide what happens to it.
   *
   * It MUST be held here. `EditableTitle`/`EditableVerse` treat a resolved
   * `onSave` as success: they close the editor and an effect resets the field to
   * the server value. So the moment a refusal is swallowed, the typed words are
   * gone from the screen — and unlike the note, these fields have no durable
   * draft behind them. A toast claiming "your text is still here" was false.
   */
  const [conflict, setConflict] = usePersistedConflict<{ field: 'title' | 'verse'; value: string }>(
    sermon.userId,
    sermon.id,
    SERMON_CORE_AGGREGATE
  );
  const [resolvingConflict, setResolvingConflict] = React.useState(false);

  /**
   * @param statedRevision which revision this write claims to be built from.
   *   Normally the one this component was rendered with; after the person chooses
   *   "keep mine" it is the server's CURRENT one, making the overwrite deliberate.
   */
  const saveCoreField = async (
    field: 'title' | 'verse',
    value: string,
    statedRevision: number,
    /**
     * What this field held when the edit started — see `expectedBaseline` on the
     * guard. `null` means "do not check the content": used for a deliberate
     * overwrite, where the person has SEEN the other version and chose to replace
     * it.
     */
    baseValue: string | null
  ) => {
    const patch = field === 'title' ? { title: value } : { verse: value };
    // The ONE field being replaced, as it looked when the edit started. The guard
    // hashes it itself, so there is a single definition of "what we started from".
    const baseline = baseValue === null ? undefined : { [field]: baseValue };
    const updatedSermonData = { ...sermon, [field]: value };
    try {
      // State the revision this edit was built from, so a save from a stale tab is
      // refused instead of replacing what another device stored.
      const updatedResult = await updateSermon(updatedSermonData, patch, statedRevision, baseline);
      // NAME the sermon this commit resolves — see usePersistedConflict.
      setConflict(null, sermon.id);
      if (updatedResult && onUpdate) {
        onUpdate(updatedResult);
      }
    } catch (error) {
      if (isStaleWriteError(error)) {
        // REFUSED, not failed: the server holds a newer version. Hold the text and
        // hand the choice to the person instead of reporting a generic glitch.
        setConflict({ payload: { field, value }, actualRevision: error.actualRevision });
        toast.error(t('freshness.staleSaveToast'));
        return;
      }
      if (isOfflineQueuedError(error)) {
        // QUEUED, not failed. Reporting a red error here made people press save
        // again, and each press queued another intent with the same base revision
        // — so on reconnect the first landed and the rest came back as "changed on
        // another device", against their own save moments earlier.
        // This is durable ownership, not persistence. Keep the honest existing
        // wording but use a neutral notice: green success styling would say the
        // sermon is saved even though the server has not accepted it yet.
        toast.message(t('freshness.queuedPending', { count: 1 }));
        return;
      }
      console.error(`Error saving sermon ${field}:`, error);
      throw error;
    }
  };

  const currentCoreRevision = sermon.rev?.[SERMON_CORE_AGGREGATE] ?? 0;

  // Handler passed to EditableTitle
  const handleSaveSermonTitle = async (newTitle: string) => {
    if (isReadOnly) return;
    await saveCoreField('title', newTitle, currentCoreRevision, sermon.title ?? '');
  };

  // Handler passed to EditableVerse
  const handleSaveSermonVerse = async (newVerse: string) => {
    if (isReadOnly) return;
    await saveCoreField('verse', newVerse, currentCoreRevision, sermon.verse ?? '');
  };

  const handleKeepMine = async () => {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Adopt the server's revision AS SEEN AT REFUSAL: the person has now seen the
      // conflict, so this overwrite is deliberate. Resending the old revision would
      // be refused again — a button that promises an action it never performs.
      // NOTHING is re-read here. Proven live with a probe: immediately after the
      // transaction commits, `getDoc` still answers from the local replica, which
      // has not caught up — it returned the OTHER device's text, and publishing
      // that put stale data back on screen after a correct save. The write path
      // itself now returns what it committed, so `saveCoreField` already published
      // the right thing.
      // Deliberate overwrite: no fingerprint — the person has SEEN the other
      // version and chose to replace it, so content differing is the point.
      await saveCoreField(
        conflict.payload.field,
        conflict.payload.value,
        conflict.actualRevision,
        null
      );
    } finally {
      setResolvingConflict(false);
    }
  };

  const handleTakeTheirs = async () => {
    if (!conflict || resolvingConflict) return;
    setResolvingConflict(true);
    try {
      // Pull what the other device stored, so the closed editor re-syncs to it.
      const fresh = await getSermonById(sermon.id);
      if (fresh && onUpdate) onUpdate(fresh);
      setConflict(null, sermon.id);
    } catch (error) {
      console.error('Error loading the newer sermon version:', error);
      toast.error(t('errors.failedToLoadSermon'));
    } finally {
      setResolvingConflict(false);
    }
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
      {/* A save was TURNED AWAY. The editor has already closed and reverted, so the
          refused text lives here — shown, not just promised — until it is resolved. */}
      {conflict && (
        <SaveConflictBanner
          entityKey="entitySermon"
          pendingText={conflict.payload.value}
          onKeepMine={handleKeepMine}
          onTakeTheirs={handleTakeTheirs}
          busy={resolvingConflict}
        />
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-2 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
      {/* Title and identity share the top row with the actions on wide screens. */}
      <div className="min-w-0">
        <EditableTitle
          initialTitle={sermon.title}
          onSave={handleSaveSermonTitle}
          disabled={isReadOnly}
        />
        <div className="flex flex-wrap items-center gap-2 mt-1">
          <span className="text-sm text-gray-500 dark:text-gray-400">{formattedDate}</span>

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
            initialVerse={sermon.verse || ''}
            onSave={handleSaveSermonVerse}
            disabled={isReadOnly}
          />
      </div>

      {/* Right side: Preach Button and Export Buttons */}
      <div className="order-2 flex w-full flex-wrap items-center gap-2 mt-4 lg:order-1 lg:mt-0 lg:w-auto">
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
            away (we're ON the sermon being deleted), rather than refreshing a dead page.
            REPLACE, not push: pushing left this very page in history, so a swipe back
            re-opened a full editor over a sermon that no longer exists — BUG-20260905. */}
        <OptionMenu
          sermon={sermon}
          series={series}
          onUpdate={onUpdate}
          onDelete={() => router.replace('/sermons')}
        />
        {/* Mode toggle moved to global DashboardNav */}
      </div>
      </div>
    </div>
  );
};

export default SermonHeader;
