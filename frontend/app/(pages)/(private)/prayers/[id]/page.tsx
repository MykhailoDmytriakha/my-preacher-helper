'use client';

import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import HighlightedText from '@/components/HighlightedText';
import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import PrayerStatusBadge from '@/components/prayer/PrayerStatusBadge';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { isStaleWriteError } from '@/services/conflictSafeUpdate.client';
import { PRAYER_CORE_AGGREGATE, PRAYER_STATUS_AGGREGATE } from '@/services/prayerRequests.client';
import '@locales/i18n';

const PRAYER_FOCUS_TYPES = new Set(['title', 'description', 'answer', 'tags']);

export default function PrayerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();

  const {
    prayerRequests,
    loading,
    updatePrayer,
    deletePrayer,
    addUpdate,
    setStatus,
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
    statusConflict,
    keepMineOnStatusConflict,
    takeTheirsOnStatusConflict,
  } =
    // The id makes a refused save durable — see usePrayerRequests.
    usePrayerRequests(user?.uid ?? null, typeof id === 'string' ? id : null);

  const prayer = prayerRequests.find((p) => p.id === id);

  // Does the server hold a newer version of THIS prayer request? Same shared layer
  // as the other detail pages: observe only, never swap what is on screen.
  // `answerText` and the updates' TEXT are watched, not just their count: two
  // devices can both answer a prayer, or edit an update, without changing any
  // length — and the screen would have called itself fresh while holding stale text.
  type PrayerWatched = {
    title: string;
    description: string;
    status: string;
    answerText: string;
    updates: string;
  };
  const knownPrayer = useMemo<PrayerWatched | null>(
    () =>
      prayer
        ? {
            title: prayer.title || '',
            description: prayer.description || '',
            status: prayer.status || '',
            answerText: prayer.answerText || '',
            updates: (prayer.updates ?? []).map((u) => `${u.id}:${u.text}`).join('\u0000'),
          }
        : null,
    [prayer]
  );
  const freshnessUid = useFreshnessUid(prayer?.userId);
  const prayerFreshness = useDocumentFreshness<PrayerWatched>({
    collection: 'prayerRequests',
    docId: prayer?.id ?? null,
    // The CURRENT signed-in owner, not the owner stored on the cached document.
    // A listener keyed by the document's own userId survives a logout: the cached
    // entity keeps the old owner, the prop never changes, so the effect never
    // cleans up. Requiring the two to match also refuses to listen to a foreign
    // document left in the cache.
    uid: freshnessUid,
    enabled: Boolean(prayer),
    known: knownPrayer,
    select: (data) => ({
      title: (data.title as string) || '',
      description: (data.description as string) || '',
      status: (data.status as string) || '',
      answerText: (data.answerText as string) || '',
      updates: (((data.updates as { id?: string; text?: string }[]) ?? []) || [])
        .map((u) => `${u.id ?? ''}:${u.text ?? ''}`)
        .join('\u0000'),
    }),
  });
  const [prayerFreshnessDismissed, setPrayerFreshnessDismissed] = useState(false);
  useEffect(() => {
    if (prayerFreshness.state === 'stale' || prayerFreshness.state === 'unknown') setPrayerFreshnessDismissed(false);
  }, [prayerFreshness.remote, prayerFreshness.state]);

  const [showEdit, setShowEdit] = useState(false);
  /**
   * The revision the edit form OPENED with — frozen, not read at save time.
   * A focus refetch can advance the page object while the modal still holds the
   * text it was opened with; pairing that fresh number with older text makes
   * compare-and-set approve exactly the overwrite it exists to refuse.
   */
  const [editBaseRevision, setEditBaseRevision] = useState<number | null>(null);
  /**
   * And the VALUES the form opened with. The number alone is not enough: any writer
   * that changes text without moving the counter leaves it truthful-looking, and
   * the service used to fill this in from a read taken moments before the write —
   * comparing the server with itself, which always agrees.
   */
  const [editBaseContent, setEditBaseContent] = useState<Record<string, unknown> | null>(null);
  const [showAddUpdate, setShowAddUpdate] = useState(false);
  const [showMarkAnswered, setShowMarkAnswered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const sortedUpdates = useMemo(
    () =>
      prayer
        ? [...prayer.updates].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        : [],
    [prayer]
  );

  const highlightQuery = searchParams.get('q')?.trim() ?? '';
  const focus = searchParams.get('focus') ?? '';
  const focusUpdateId = searchParams.get('updateId') ?? '';
  const focusTargetId = useMemo(() => {
    if (!highlightQuery) {
      return null;
    }

    if (focus === 'update' && focusUpdateId) {
      return `prayer-update-${focusUpdateId}`;
    }

    if (PRAYER_FOCUS_TYPES.has(focus)) {
      return `prayer-focus-${focus}`;
    }

    return null;
  }, [focus, focusUpdateId, highlightQuery]);

  useEffect(() => {
    if (!focusTargetId || !prayer || typeof window === 'undefined') {
      return;
    }

    let removeRingTimeoutId: number | undefined;
    const timeoutId = window.setTimeout(() => {
      const targetElement = document.getElementById(focusTargetId);
      if (!targetElement) {
        return;
      }

      const exactMatch = targetElement.querySelector('mark');
      const scrollTarget = exactMatch ?? targetElement;
      scrollTarget.scrollIntoView({ block: 'center', behavior: 'smooth' });

      targetElement.classList.add(
        'ring-2',
        'ring-rose-300',
        'ring-offset-2',
        'dark:ring-rose-700',
        'dark:ring-offset-gray-900'
      );
      removeRingTimeoutId = window.setTimeout(() => {
        targetElement.classList.remove(
          'ring-2',
          'ring-rose-300',
          'ring-offset-2',
          'dark:ring-rose-700',
          'dark:ring-offset-gray-900'
        );
      }, 2200);
    }, 50);

    return () => {
      window.clearTimeout(timeoutId);
      if (removeRingTimeoutId !== undefined) {
        window.clearTimeout(removeRingTimeoutId);
      }
    };
  }, [focusTargetId, prayer]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="h-8 w-32 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
        <div className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (!prayer) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-6 text-center text-gray-400 dark:text-gray-500">
        <p>Prayer request not found.</p>
        <Link href="/prayers" className="text-rose-500 text-sm mt-2 inline-block">← Back</Link>
      </div>
    );
  }

  const handleEdit = async (payload: Pick<PrayerRequest, 'title'> & Partial<Pick<PrayerRequest, 'description' | 'tags'>>) => {
    // State the revision this edit was built from, so a save from a tab that never
    // saw another device's change is refused rather than replacing it.
    await updatePrayer(
      prayer.id,
      payload,
      editBaseRevision ?? prayer.rev?.[PRAYER_CORE_AGGREGATE] ?? 0,
      editBaseContent
    );
    toast.success(t('prayer.toast.updated'));
    setShowEdit(false);
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    await deletePrayer(prayer.id);
    toast.success(t('prayer.toast.deleted'));
    router.push('/prayers');
  };

  const handleAddUpdate = async (text: string) => {
    await addUpdate(prayer.id, text);
    toast.success(t('prayer.toast.updateAdded'));
    setShowAddUpdate(false);
  };

  const handleSetStatus = async (status: PrayerStatus) => {
    if (status === 'answered') {
      setShowMarkAnswered(true);
      return;
    }
    await setStatus(prayer.id, status);
    toast.success(t('prayer.toast.statusChanged'));
  };

  const handleMarkAnswered = async (answerText?: string) => {
    // The answer is human text, so state the revision it was built from: two
    // devices answering the same prayer must not overwrite each other in silence.
    try {
      // The answer is human text, so state the revision it was built from: two
      // devices answering the same prayer must not overwrite each other.
      await setStatus(prayer.id, 'answered', answerText, prayer.rev?.[PRAYER_STATUS_AGGREGATE] ?? 0, {
        status: prayer.status,
        answerText: prayer.answerText ?? null,
      });
    } catch (error) {
      // REFUSED or failed — keep the modal OPEN. The typed answer lives nowhere
      // else, so closing here would destroy it while claiming success.
      toast.error(
        isStaleWriteError(error) ? t('freshness.staleSaveToast') : t('common.saveError')
      );
      // RETHROW — see the note on the list page: a fulfilled submit closes the modal
      // and takes the only copy of the typed answer with it.
      throw error;
    }
    toast.success(t('prayer.toast.statusChanged'));
    setShowMarkAnswered(false);
  };

  const isActive = prayer.status === 'active';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      {/* A save was TURNED AWAY. The optimistic cache was rolled back to the server's
          truth, so this banner holds the only remaining copy of what was typed. */}
      {saveConflict && (
        <SaveConflictBanner
          entityKey="entityRecord"
          pendingText={saveConflict.payload.updates.title ?? saveConflict.payload.updates.description ?? undefined}
          onKeepMine={keepMineOnConflict}
          onTakeTheirs={takeTheirsOnConflict}
          busy={resolvingConflict}
        />
      )}
      {/* The ANSWER was turned away. It is the longest text on this screen and it
          lived only inside the modal — the backdrop, the ✕ and a reload all took it.
          Its own aggregate, so its own banner: a refused title must not displace it. */}
      {statusConflict && (
        <SaveConflictBanner
          entityKey="entityRecord"
          pendingText={statusConflict.payload.answerText ?? undefined}
          onKeepMine={keepMineOnStatusConflict}
          onTakeTheirs={takeTheirsOnStatusConflict}
          busy={resolvingConflict}
        />
      )}
      {/* This PRAYER REQUEST changed elsewhere — distinct from the app-update toast. */}
      {(prayerFreshness.state === 'stale' || prayerFreshness.state === 'unknown') && !prayerFreshnessDismissed && (
        <DataFreshnessBanner
          entityKey="entityRecord"
          dirty={false}
          deleted={prayerFreshness.remotelyDeleted}
          unknown={prayerFreshness.state === 'unknown'}
          onDismiss={() => setPrayerFreshnessDismissed(true)}
        />
      )}
      {/* Back */}
      <Link href="/prayers" className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-rose-500 transition-colors">
        <ArrowLeftIcon className="h-4 w-4" />
        {t('prayer.title')}
      </Link>

      {/* Prayer card */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <PrayerStatusBadge status={prayer.status} />
            <p
              id="prayer-focus-title"
              className="rounded-md text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug transition-shadow"
            >
              <HighlightedText text={prayer.title} searchQuery={highlightQuery} />
            </p>
            {prayer.description && (
              <p
                id="prayer-focus-description"
                className="rounded-md text-sm text-gray-600 dark:text-gray-400 transition-shadow"
              >
                <HighlightedText text={prayer.description} searchQuery={highlightQuery} />
              </p>
            )}
            {prayer.tags && prayer.tags.length > 0 && (
              <div id="prayer-focus-tags" className="flex flex-wrap gap-1 rounded-md transition-shadow">
                {prayer.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                    <HighlightedText text={tag} searchQuery={highlightQuery} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Meta */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700 pt-3">
          <span className="flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5" />
            {t('prayer.detail.addedOn')}: {new Date(prayer.createdAt).toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1">
            <ClockIcon className="h-3.5 w-3.5" />
            {t('prayer.detail.updatedOn')}: {new Date(prayer.updatedAt).toLocaleDateString()}
          </span>
          {prayer.answeredAt && (
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircleIcon className="h-3.5 w-3.5" />
              {t('prayer.detail.answeredOn')}: {new Date(prayer.answeredAt).toLocaleDateString()}
            </span>
          )}
        </div>

        {/* Actions row */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => setShowAddUpdate(true)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors font-medium"
          >
            <PlusIcon className="h-4 w-4" />
            {t('prayer.actions.addUpdate')}
          </button>

          {isActive ? (
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={() => handleSetStatus('answered')}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <CheckCircleIcon className="h-4 w-4 text-green-500" />
                {t('prayer.actions.markAnswered')}
              </button>
              <button
                onClick={() => handleSetStatus('not_answered')}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
              >
                <XCircleIcon className="h-4 w-4 text-gray-400" />
                {t('prayer.actions.markNotAnswered')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => handleSetStatus('active')}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
            >
              <ClockIcon className="h-4 w-4 text-blue-500" />
              {t('prayer.actions.markActive')}
            </button>
          )}

          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => {
                setEditBaseRevision(prayer.rev?.[PRAYER_CORE_AGGREGATE] ?? 0);
                setEditBaseContent({
                  title: prayer.title,
                  description: prayer.description ?? null,
                  tags: prayer.tags ?? [],
                });
                setShowEdit(true);
              }}
              className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 rounded-lg"
            >
              <PencilIcon className="h-4 w-4" />
              {t('prayer.actions.edit')}
            </button>

            <button
              onClick={handleDelete}
              className={`flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                confirmDelete
                  ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-medium'
                  : 'text-gray-400 hover:text-red-500'
              }`}
            >
              <TrashIcon className="h-4 w-4" />
              {confirmDelete ? t('prayer.delete.confirm_button') + '?' : t('prayer.actions.delete')}
            </button>
          </div>
        </div>
      </div>

      {/* God's Answer */}
      {prayer.status === 'answered' && (
        <div
          id="prayer-focus-answer"
          className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 rounded-xl p-5 transition-shadow"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <CheckCircleIcon className="h-4 w-4 text-green-600 dark:text-green-400" />
              <h2 className="text-sm font-semibold text-green-800 dark:text-green-300">
                {t('prayer.answerText.label')}
              </h2>
            </div>
            <button
              onClick={() => setShowMarkAnswered(true)}
              className="text-xs text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
            >
              {prayer.answerText ? t('prayer.answerText.edit') : t('prayer.answerText.add')}
            </button>
          </div>
          {prayer.answerText ? (
            <p className="text-sm text-green-900 dark:text-green-100 whitespace-pre-wrap leading-relaxed">
              <HighlightedText text={prayer.answerText} searchQuery={highlightQuery} />
            </p>
          ) : (
            <p className="text-sm text-green-600/70 dark:text-green-400/60 italic">
              {t('prayer.answerText.add')}...
            </p>
          )}
        </div>
      )}

      {/* Updates timeline */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            {t('prayer.detail.updates')}
            {prayer.updates.length > 0 && (
              <span className="ml-1.5 text-xs font-normal text-gray-400">({prayer.updates.length})</span>
            )}
          </h2>
        </div>

        {sortedUpdates.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
            {t('prayer.detail.noUpdates')}
          </p>
        ) : (
          <div className="space-y-2">
            {sortedUpdates.map((update) => (
              <div
                key={update.id}
                id={`prayer-update-${update.id}`}
                className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3 transition-shadow"
              >
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                  <HighlightedText text={update.text} searchQuery={highlightQuery} />
                </p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                  {new Date(update.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showEdit && (
        <CreatePrayerModal
          mode="edit"
          initialValues={prayer}
          onClose={() => setShowEdit(false)}
          onSubmit={handleEdit}
        />
      )}
      {showAddUpdate && (
        <AddUpdateModal
          onClose={() => setShowAddUpdate(false)}
          onSubmit={handleAddUpdate}
        />
      )}
      {showMarkAnswered && (
        <MarkAnsweredModal
          onClose={() => setShowMarkAnswered(false)}
          onSubmit={handleMarkAnswered}
        />
      )}
    </div>
  );
}
