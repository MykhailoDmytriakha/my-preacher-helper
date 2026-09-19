'use client';

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeftIcon,
  ExclamationTriangleIcon,
} from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import AddSermonModal from '@/components/AddSermonModal';
import { DataFreshnessBanner } from '@/components/DataFreshnessBanner';
import { SaveConflictBanner } from '@/components/SaveConflictBanner';
import AddGroupToSeriesModal from '@/components/series/AddGroupToSeriesModal';
import AddSermonToSeriesModal from '@/components/series/AddSermonToSeriesModal';
import EditSeriesModal from '@/components/series/EditSeriesModal';
import { EngineSeriesDetail } from '@/components/series/EngineSeriesDetail';
import { SeriesDetailView } from '@/components/series/SeriesDetailView';
import SeriesItemCard from '@/components/series/SeriesItemCard';
import { SeriesDetailSkeleton } from '@/components/skeletons/SeriesDetailSkeleton';
import { isCollectionOnEngine } from '@/data-engine/clientPolicy';
import { useDocumentFreshness } from '@/hooks/useDocumentFreshness';
import { useFreshnessUid } from '@/hooks/useFreshnessUid';
import { useRouteId } from '@/hooks/useRouteId';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesDetail } from '@/hooks/useSeriesDetail';
import { useAuth } from '@/providers/AuthProvider';
import { contentFingerprint } from '@/utils/contentFingerprint';
import { debugLog } from '@/utils/debugMode';
import { awaitAcceptance, skippedWrite } from '@/utils/recoverableWrite';
import { normalizeSeriesItems } from '@/utils/seriesItems';
import { SERIES_META_AGGREGATE } from '@services/series.service';

import type { SeriesItem } from '@/models/models';

type ModalState = 'add-sermon' | 'add-group' | 'create-new-sermon' | null;

const MODAL_STATES = {
  ADD_SERMON: 'add-sermon' as const,
  ADD_GROUP: 'add-group' as const,
  CREATE_NEW_SERMON: 'create-new-sermon' as const,
};

const TRANSLATION_KEYS = {
  DELETE_SERIES: 'workspaces.series.deleteSeries',
};

type PendingRemoval = {
  type: 'sermon' | 'group';
  refId: string;
} | null;

export default function SeriesDetailPage() {
  const id = useRouteId();
  return isCollectionOnEngine('series') ? <EngineSeriesDetail key={id} seriesId={typeof id === 'string' ? id : ''} /> : <LegacySeriesDetailPage />;
}

function LegacySeriesDetailPage() {
  const id = useRouteId();
  const router = useRouter();
  const { t } = useTranslation();
  const seriesId = typeof id === 'string' ? id : '';

  const {
    series,
    items,
    sermons,
    groups,
    loading,
    error,
    addSermons,
    addGroups,
    removeItem,
    reorderMixedItems,
    updateSeriesDetail,
    refreshSeriesDetail,
    isRefetching,
    saveConflict,
    resolvingConflict,
    keepMineOnConflict,
    takeTheirsOnConflict,
  } = useSeriesDetail(seriesId);

  const [optimisticItems, setOptimisticItems] = useState(items);

  // Does the server hold a newer version of THIS series? Same shared layer as the
  // note editor: observe only, never swap what is on screen without a decision.
  type SeriesWatched = {
    title: string;
    description: string;
    theme: string;
    bookOrTopic: string;
    status: string;
    items: string;
  };
  const knownSeries = useMemo<SeriesWatched | null>(
    () =>
      series
        ? {
            title: series.title || '',
            description: series.description || '',
            theme: series.theme || '',
            bookOrTopic: series.bookOrTopic || '',
            status: series.status || '',
            // Reordering keeps the count identical — fingerprint the items themselves.
            items: contentFingerprint(series.items ?? []),
          }
        : null,
    [series]
  );

  const freshnessUid = useFreshnessUid(series?.userId);
  const seriesFreshness = useDocumentFreshness<SeriesWatched>({
    collection: 'series',
    docId: seriesId || null,
    // The CURRENT signed-in owner, not the owner stored on the cached document.
    // A listener keyed by the document's own userId survives a logout: the cached
    // entity keeps the old owner, the prop never changes, so the effect never
    // cleans up. Requiring the two to match also refuses to listen to a foreign
    // document left in the cache.
    uid: freshnessUid,
    enabled: Boolean(series),
    known: knownSeries,
    select: (data) => ({
      title: (data.title as string) || '',
      description: (data.description as string) || '',
      theme: (data.theme as string) || '',
      bookOrTopic: (data.bookOrTopic as string) || '',
      status: (data.status as string) || '',
      // Normalize the SAME way the hook does before fingerprinting. A legacy
      // series stores only `sermonIds`, so the local side holds derived items
      // while the raw document holds none — comparing them produced a permanent
      // phantom "changed on another device" that no refresh could clear.
      items: contentFingerprint(
        normalizeSeriesItems(
          data.items as SeriesItem[] | undefined,
          (data.sermonIds as string[]) ?? []
        )
      ),
    }),
  });

  const [seriesFreshnessDismissed, setSeriesFreshnessDismissed] = useState(false);
  useEffect(() => {
    if (seriesFreshness.state === 'stale' || seriesFreshness.state === 'unknown') setSeriesFreshnessDismissed(false);
  }, [seriesFreshness.remote, seriesFreshness.state]);


  const { user } = useAuth();
  const { deleteExistingSeries } = useSeries(user?.uid || null);

  const [showEditModal, setShowEditModal] = useState(false);
  /**
   * The revision the edit form OPENED with — frozen, not read at save time.
   *
   * The modal keeps the text it was opened with. If a focus refetch advances the
   * page object meanwhile, saving with the LIVE revision pairs fresh permission
   * with stale text, and compare-and-set waves it through — restoring the old
   * title over the other device's. The stated revision must describe the text
   * actually being saved, so it is captured together with it.
   */
  const [editBaseRevision, setEditBaseRevision] = useState<number | null>(null);
  /**
   * And the VALUES the form opened with. The number alone cannot catch a writer that
   * changed the title without advancing it — which is exactly what an old installed
   * PWA does, and what the rules cannot reject while they stay disabled.
   */
  const [editBaseContent, setEditBaseContent] = useState<Record<string, unknown> | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [modalState, setModalState] = useState<ModalState>(null);
  const [pendingRemoval, setPendingRemoval] = useState<PendingRemoval>(null);

  // Sync optimistic items with server items when server items change, but only
  // when not fetching (to avoid interrupting DND state). Content-equality guard:
  // return the PREVIOUS array when the id-order is unchanged so React bails on an
  // identical reference — otherwise a churning `items` reference (query without
  // stable data, e.g. loading/offline/refetch) would re-fire this effect every
  // render and drive a "Maximum update depth" setState loop.
  useEffect(() => {
    if (isRefetching) return;
    setOptimisticItems((prev) => {
      if (
        prev.length === items.length &&
        prev.every((entry, index) => entry.item.id === items[index]?.item.id)
      ) {
        return prev;
      }
      return items;
    });
  }, [items, isRefetching]);

  const showAddSermonModal = modalState === MODAL_STATES.ADD_SERMON;
  const showAddGroupModal = modalState === MODAL_STATES.ADD_GROUP;
  const showCreateSermonModal = modalState === MODAL_STATES.CREATE_NEW_SERMON;

  const openAddSermonModal = () => setModalState(MODAL_STATES.ADD_SERMON);
  const openAddGroupModal = () => setModalState(MODAL_STATES.ADD_GROUP);
  const openCreateSermonModal = () => setModalState(MODAL_STATES.CREATE_NEW_SERMON);
  const closeModals = () => setModalState(null);
  const cancelCreateSermon = () => setModalState(MODAL_STATES.ADD_SERMON);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id || !series) {
      return;
    }

    const oldIndex = optimisticItems.findIndex((item) => item.item.id === active.id);
    const newIndex = optimisticItems.findIndex((item) => item.item.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    // 1. Update optimistic UI immediately
    const nextItems = arrayMove(optimisticItems, oldIndex, newIndex);
    setOptimisticItems(nextItems);

    // 2. Persist to backend
    const nextItemIds = nextItems.map((entry) => entry.item.id);

    try {
      // useSeriesMembership's recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(reorderMixedItems(nextItemIds), () => undefined);
    } catch (errorValue) {
      /**
       * NO message here. The membership descriptor in `useSeriesMembership` reports
       * this refusal — with wording, the affected items and a working retry — and it
       * keeps reporting after this page is gone. Announcing here too showed one refused
       * action as two separate failures.
       */
      console.error('Error reordering series items:', errorValue);
      setOptimisticItems(items);
    }
  };

  const handleDeleteSeries = async () => {
    if (!series) return;
    try {
      // useSeries' delete recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(deleteExistingSeries(series.id), () => undefined);
      // replace, not push: we are ON the page of the thing being deleted, so pushing leaves a dead entry in history and Back re-opens it.
      router.replace('/series');
    } catch (errorValue) {
      // Reported by the delete descriptor in `useSeries` — see the note above.
      console.error('Error deleting series:', errorValue);
    } finally {
      setShowDeleteConfirm(false);
    }
  };

  const handleAddSermons = (sermonIds: string[]) => addSermons(sermonIds);

  const handleAddGroups = (groupIds: string[]) => {
    return series ? addGroups(groupIds) : skippedWrite();
  };

  const handleConfirmRemove = async () => {
    if (!pendingRemoval) return;
    try {
      // useSeriesMembership's recovery descriptor reports a late refusal while this screen is mounted.
      await awaitAcceptance(removeItem(pendingRemoval.type, pendingRemoval.refId), () => undefined);
      setPendingRemoval(null);
    } catch (errorValue) {
      // Reported by the membership descriptor — see the note above.
      console.error('Error removing item from series:', errorValue);
    }
  };

  if (loading) {
    return <SeriesDetailSkeleton />;
  }

  if (error || !series) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.push('/series')}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-5 w-5" />
          {t('navigation.series')}
        </button>

        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          <p>{t('workspaces.series.errors.updateFailed', { defaultValue: 'Series not found or failed to load.' })}</p>
        </div>
      </div>
    );
  }


  return (
    <SeriesDetailView series={series} items={items} onBack={() => router.push('/series')}
      onAddSermons={openAddSermonModal} onAddGroups={openAddGroupModal} onEdit={() => {
        setEditBaseRevision(series.rev?.[SERIES_META_AGGREGATE] ?? 0);
        setEditBaseContent({ title: series.title ?? '', description: series.description ?? null,
          theme: series.theme ?? null, bookOrTopic: series.bookOrTopic ?? null, status: series.status ?? null });
        setShowEditModal(true);
      }}
      onDelete={() => setShowDeleteConfirm(true)} onRefresh={refreshSeriesDetail}
      feedback={<>
      {/* A save was TURNED AWAY. The edit modal has already closed, so this banner
          holds the only remaining copy of what was typed until it is resolved. */}
      {saveConflict && (
        <SaveConflictBanner
          entityKey="entitySeries"
          pendingText={saveConflict.payload.title ?? saveConflict.payload.description ?? undefined}
          onKeepMine={keepMineOnConflict}
          onTakeTheirs={takeTheirsOnConflict}
          busy={resolvingConflict}
        />
      )}
      {/* This SERIES changed elsewhere. Distinct from the app-update toast, and it
          refreshes the record rather than reloading the application.

          NOT while a save conflict is on screen: that banner already says the record
          changed elsewhere AND holds the person's text, and its "take theirs" does what
          "load newer" would. Showing both gave one event two headlines and four buttons,
          two of which meant the same thing — found in the browser, not by a test. */}
      {!saveConflict && (seriesFreshness.state === 'stale' || seriesFreshness.state === 'unknown') && !seriesFreshnessDismissed && (
        <DataFreshnessBanner
          entityKey="entitySeries"
          dirty={false}
          deleted={seriesFreshness.remotelyDeleted}
          unknown={seriesFreshness.state === 'unknown'}
          diagnostics={seriesFreshness.diagnostics}
          checking={seriesFreshness.checking}
          canCheck={seriesFreshness.canCheck}
          onCheckAgain={seriesFreshness.checkAgain}
          onRefresh={async () => {
            // Only declare it refreshed once the refetch actually succeeded.
            // Dismissing first left the screen stale with no warning when the
            // refresh failed or the device was offline — worse than not offering it.
            try {
              await refreshSeriesDetail();
              if (seriesFreshness.remote) seriesFreshness.markSynced(seriesFreshness.remote);
              setSeriesFreshnessDismissed(true);
            } catch {
              /* keep the banner up: the screen is still stale */
            }
          }}
          onDismiss={() => setSeriesFreshnessDismissed(true)}
        />
      )}
</>}
      itemsContent={<DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={optimisticItems.map((entry) => entry.item.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-4">
                {optimisticItems.map((entry, index) => (
                  <SeriesItemCard
                    key={entry.item.id}
                    id={entry.item.id}
                    position={index + 1}
                    resolvedItem={entry}
                    onRemove={(type, refId) => setPendingRemoval({ type, refId })}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>}>

      {showEditModal && (
        <EditSeriesModal
          series={series}
          onClose={() => setShowEditModal(false)}
          onUpdate={(_id, updates) => updateSeriesDetail(updates, editBaseRevision, editBaseContent)}
        />
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-8 w-8 text-red-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t(TRANSLATION_KEYS.DELETE_SERIES)}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">{t('workspaces.series.deleteSeriesConfirm')}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleDeleteSeries}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t(TRANSLATION_KEYS.DELETE_SERIES)}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingRemoval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-gray-200 dark:bg-gray-900 dark:ring-gray-700">
            <div className="flex items-center gap-3 mb-4">
              <ExclamationTriangleIcon className="h-6 w-6 text-amber-500" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.series.actions.removeFromSeries')}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {pendingRemoval.type === 'sermon'
                    ? t('workspaces.series.detail.removeSermonHint', {
                      defaultValue: 'This sermon will be detached from the series.',
                    })
                    : t('workspaces.series.detail.removeGroupHint', {
                      defaultValue: 'This group will be detached from the series.',
                    })}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setPendingRemoval(null)}
                className="flex-1 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                onClick={handleConfirmRemove}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700"
              >
                {t('workspaces.series.actions.removeFromSeries')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSermonModal && (
        <AddSermonToSeriesModal
          onClose={closeModals}
          onCreateNewSermon={openCreateSermonModal}
          onAddSermons={handleAddSermons}
          currentSeriesSermonIds={sermons.map((sermon) => sermon.id)}
          seriesId={seriesId}
        />
      )}

      {showAddGroupModal && (
        <AddGroupToSeriesModal
          onClose={closeModals}
          onAddGroups={handleAddGroups}
          currentSeriesGroupIds={groups.map((group) => group.id)}
        />
      )}

      {showCreateSermonModal && (
        <AddSermonModal
          showTriggerButton={false}
          isOpen
          onClose={closeModals}
          onCancel={cancelCreateSermon}
          preSelectedSeriesId={seriesId}
          onNewSermonCreated={async (newSermon) => {
            debugLog('New sermon created, starting to add to series:', newSermon.id);
            try {
              // AWAIT ACCEPTANCE, not the submission object. `await`-ing the object
              // itself resolved immediately to the object, so a refused membership
              // never reached this catch: the modal closed reporting success while the
              // freshly created sermon stayed outside the series the person chose.
              // The membership sweep reconciles the touched series-detail itself
              // (onSuccess, bound to the real commit ack) — no timer-guessed
              // invalidate needed here.
              await awaitAcceptance(handleAddSermons([newSermon.id]), () => undefined);
            } catch (errorValue) {
              /**
               * DO NOT rethrow. The sermon itself was already created — only the series
               * link was refused. Rethrowing made the creation form treat a successful
               * create as a failure, so it stayed open with the fields populated and the
               * person's obvious next move, pressing Save again, minted a SECOND sermon.
               *
               * The refusal is not swallowed: membership has its own recovery owner for
               * every surface (useSeriesMembership), with an idempotent retry, and the
               * screen; if it is gone, that is the tracked late-navigation debt.
               */
              console.error('Error adding new sermon to series:', errorValue);
            }
          }}
        />
      )}
    </SeriesDetailView>
  );
}
