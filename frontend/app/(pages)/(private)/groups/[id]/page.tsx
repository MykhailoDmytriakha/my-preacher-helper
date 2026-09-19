'use client';

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  MapPinIcon,
  PlayIcon,
  TrashIcon,
  UsersIcon,
  LinkIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddBlockButton from '@/components/groups/AddBlockButton';
import FlowEditor from '@/components/groups/FlowEditor';
import FlowFooter from '@/components/groups/FlowFooter';
import FlowItemRow from '@/components/groups/FlowItemRow';
import SeriesSelector from '@/components/series/SeriesSelector';
import ConfirmModal from '@/components/ui/ConfirmModal';
import DatePickerField from '@/components/ui/DatePickerField';
import { LiveTextInput, LiveTextArea } from '@/components/ui/LiveTextInput';
import { DataDocumentProvider, isCollectionOnEngine } from '@/data-engine/react.client';
import { useGroupPageEditor } from '@/hooks/useGroupPageEditor';
import { useLegacyGroupPageEditor } from '@/hooks/useLegacyGroupPageEditor';
import { useRouteId } from '@/hooks/useRouteId';
import { useSeries } from '@/hooks/useSeries';
import { useSeriesMembership } from '@/hooks/useSeriesMembership';
import { GroupBlockStatus, GroupBlockTemplate, GroupBlockTemplateType, GroupFlowItem } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import {
  createFlowItem,
  createTemplate,
  duplicateFlowItem,
  moveFlowItem,
  normalizeFlow,
  removeFlowItem,
} from '@/utils/groupFlow';
import { getSeriesForRef } from '@/utils/seriesMembership';

import type { GroupPageEditor } from '@/hooks/groupPageEditor';

const STATUS_CYCLE: GroupBlockStatus[] = ['empty', 'draft', 'filled'];

export default function GroupDetailPage() {
  const id = useRouteId();
  const { user } = useAuth();
  const groupId = user?.uid && typeof id === 'string' ? id : '';
  return isCollectionOnEngine('groups')
    ? <DataDocumentProvider key={groupId} resource={{ collection: 'groups', id: groupId }} options={{ slot: 'group' }}><EngineGroupPage groupId={groupId} /></DataDocumentProvider>
    : <LegacyGroupPage groupId={groupId} />;
}

function LegacyGroupPage({ groupId }: { groupId: string }) {
  return <GroupDetailView editor={useLegacyGroupPageEditor(groupId)} />;
}
function EngineGroupPage({ groupId }: { groupId: string }) {
  return <GroupDetailView editor={useGroupPageEditor(groupId)} />;
}
function GroupDetailView({ editor }: { editor: GroupPageEditor }) {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const { group, loading, title, setTitle, description, setDescription, status, setStatus,
    templates, setTemplates, flow, setFlow, meetingDate, setMeetingDate, meetingLocation, setMeetingLocation,
    meetingAudience, setMeetingAudience, debouncedSave, saveStatus, deleteGroupDetail, feedback,
    meetingFieldsEnabled } = editor;
  const [selectedFlowItemId, setSelectedFlowItemId] = useState<string | null>(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const groupsUserId = user?.uid ?? null;
  const { series } = useSeries(groupsUserId);
  const { addToSeries, removeFromAllSeries } = useSeriesMembership();

  // Which series this group belongs to — DERIVED from series.items (sole truth).
  const groupSeries = group ? getSeriesForRef(group.id, series) : undefined;

  const [isSeriesSelectorOpen, setIsSeriesSelectorOpen] = useState(false);
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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setFlow((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newFlow = arrayMove(items, oldIndex, newIndex);
        const reindexed = newFlow.map((item, idx) => ({ ...item, order: idx + 1 }));
        return normalizeFlow(reindexed);
      });
      debouncedSave();
    }
  };

  const templatesById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates]
  );

  const normalizedFlow = useMemo(() => normalizeFlow(flow), [flow]);

  const totalDuration = useMemo(
    () => normalizedFlow.reduce((sum, item) => sum + (item.durationMin || 0), 0),
    [normalizedFlow]
  );

  const filledCount = useMemo(
    () => normalizedFlow.filter((item) => templatesById.get(item.templateId)?.status === 'filled').length,
    [normalizedFlow, templatesById]
  );

  const selectedFlowItem = useMemo(
    () => normalizedFlow.find((item) => item.id === selectedFlowItemId) || null,
    [normalizedFlow, selectedFlowItemId]
  );

  const selectedTemplate = useMemo(
    () => (selectedFlowItem ? templatesById.get(selectedFlowItem.templateId) || null : null),
    [selectedFlowItem, templatesById]
  );

  const handleAddBlock = (type: GroupBlockTemplateType) => {
    const nextTemplate = createTemplate(type, { title: t(`groupFlow.types.${type}`, { defaultValue: type }) });
    setTemplates((prev) => [...prev, nextTemplate]);
    const nextFlowItem = createFlowItem(nextTemplate.id, flow.length + 1);
    setFlow((prev) => normalizeFlow([...prev, nextFlowItem]));
    setSelectedFlowItemId(nextFlowItem.id);
    debouncedSave();
  };

  const updateTemplate = (templateId: string, updates: Partial<GroupBlockTemplate>) => {
    setTemplates((prev) =>
      prev.map((template) =>
        template.id === templateId
          ? {
            ...template,
            ...updates,
            updatedAt: new Date().toISOString(),
          }
          : template
      )
    );
    debouncedSave();
  };

  const removeFlowBlock = (flowItemId: string) => {
    const item = flow.find((f) => f.id === flowItemId);
    if (!item) return;
    setFlow((prev) => removeFlowItem(prev, flowItemId));
    const otherRefs = flow.filter((f) => f.id !== flowItemId && f.templateId === item.templateId);
    if (otherRefs.length === 0) {
      setTemplates((prev) => prev.filter((t) => t.id !== item.templateId));
    }
    if (selectedFlowItemId === flowItemId) setSelectedFlowItemId(null);
    debouncedSave();
  };

  const cycleStatus = (templateId: string) => {
    setTemplates((prev) =>
      prev.map((template) => {
        if (template.id !== templateId) return template;
        const currentIndex = STATUS_CYCLE.indexOf(template.status);
        const nextStatus = STATUS_CYCLE[(currentIndex + 1) % STATUS_CYCLE.length];
        return { ...template, status: nextStatus, updatedAt: new Date().toISOString() };
      })
    );
    debouncedSave();
  };

  const updateFlowItem = (itemId: string, updates: Partial<GroupFlowItem>) => {
    setFlow((prev) =>
      normalizeFlow(
        prev.map((flowItem) =>
          flowItem.id === itemId
            ? {
              ...flowItem,
              ...updates,
            }
            : flowItem
        )
      )
    );
    debouncedSave();
  };

  const handleDeleteGroup = async () => {
    if (!group) return;

    try {
      setDeletingGroup(true);
      // No success message: the delete wrapper returns on LAUNCH, so this used to
      // confirm a removal the server can still refuse. A refusal restores the row
      // and reports itself through the hook's own error toast.
      await deleteGroupDetail();
      // replace, not push: we are ON the page of the thing being deleted, so pushing leaves a dead entry in history and Back re-opens it.
      router.replace('/groups');
    } catch (errorValue) {
      console.error('Failed to delete group:', errorValue);
      toast.error(
        t('workspaces.groups.errors.deleteFailed', {
          defaultValue: 'Failed to delete group',
        })
      );
    } finally {
      setDeletingGroup(false);
    }
  };

  // Series binding now flows through the client playlist sweep (series.items is
  // the sole truth) — one-to-one is enforced by construction (add removes the
  // group from any other series in the same atomic batch). Fire-and-forget +
  // optimistic, so it works offline like every other membership op.
  const handleSeriesSelect = (seriesId: string) => {
    if (!group) return;
    // Membership writes are fire-and-forget sweeps: the optimistic binding on
    // screen is the acceptance signal, and a terminal refusal now speaks for
    // itself from useSeriesMembership. Announcing success here contradicted it.
    addToSeries(seriesId, { type: 'group', refId: group.id });
    setIsSeriesSelectorOpen(false);
  };

  const handleUnlinkSeries = () => {
    if (!group) return;
    removeFromAllSeries({ type: 'group', refId: group.id });
  };

  // The private layout owns the sign-in flow; no editor is shown without a user.
  if (!user?.uid) return null;

  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-24 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
        {feedback}
        <button
          onClick={() => router.push('/groups')}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t('navigation.groups', { defaultValue: 'Groups' })}
        </button>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {t('workspaces.groups.errors.loadFailed', { defaultValue: 'Failed to load group' })}
        </div>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      {feedback}
      <header className="rounded-3xl border border-gray-200/70 bg-gradient-to-br from-emerald-600/10 via-cyan-600/10 to-blue-600/10 p-6 shadow-sm dark:border-gray-800 dark:from-emerald-500/10 dark:via-cyan-500/10 dark:to-blue-500/10">
        <div className="mb-5 flex items-center justify-between">
          <button
            onClick={() => router.push('/groups')}
            className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-900/80 dark:text-gray-200 dark:ring-gray-800"
          >
            <ArrowLeftIcon className="h-4 w-4" />
            {t('navigation.groups', { defaultValue: 'Groups' })}
          </button>

          <div className="flex items-center gap-2">
            <GroupSaveStatus status={saveStatus} t={t} />
            <button
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deletingGroup}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-60 dark:border-red-900/70 dark:bg-gray-900 dark:text-red-300 dark:hover:bg-red-950/30"
            >
              <TrashIcon className="h-4 w-4" />
              {deletingGroup
                ? t('common.deleting', { defaultValue: 'Deleting...' })
                : t('workspaces.groups.actions.delete', { defaultValue: 'Delete group' })}
            </button>
          </div>
        </div>

        <div className="grid items-start gap-x-6 gap-y-3 lg:grid-cols-[1fr_1fr]">
          {/* Left Column: Title, Description, Status */}
          <div className="flex flex-col gap-3">
            <LiveTextInput
              value={title}
              onChange={(value) => { setTitle(value); debouncedSave(); }}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-2xl font-bold text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
            />
            <LiveTextArea
              value={description}
              onChange={(value) => { setDescription(value); debouncedSave(); }}
              rows={2}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              placeholder={t('workspaces.groups.form.descriptionPlaceholder', {
                defaultValue: 'Optional description',
              })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value as typeof status); debouncedSave(); }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="draft">{t('workspaces.series.form.statuses.draft')}</option>
                <option value="active">{t('workspaces.series.form.statuses.active')}</option>
                <option value="completed">{t('workspaces.series.form.statuses.completed')}</option>
              </select>
              {groupSeries ? (
                <div className="flex items-center gap-[1px]">
                  {(() => {
                    const seriesName = groupSeries.title || t('workspaces.groups.inSeries', { defaultValue: 'Part of a series' });
                    return (
                      <Link
                        href={`/series/${groupSeries.id}`}
                        className="inline-flex max-w-[200px] items-center gap-2 rounded-l-full bg-white/90 px-3 py-1.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-200/50 hover:bg-blue-50 dark:bg-blue-900/30 dark:text-blue-200 dark:ring-blue-800/40 dark:hover:bg-blue-900/50 transition-colors"
                        title={seriesName}
                      >
                        <CheckCircleIcon className="shrink-0 h-3.5 w-3.5" />
                        <span className="truncate">{seriesName}</span>
                      </Link>
                    );
                  })()}
                  <button
                    onClick={() => setIsSeriesSelectorOpen(true)}
                    className="bg-white/90 px-2.5 py-1.5 text-xs font-medium text-gray-500 ring-1 ring-blue-200/50 hover:bg-blue-50 hover:text-blue-700 transition-colors dark:bg-blue-900/30 dark:text-gray-300 dark:ring-blue-800/40 dark:hover:bg-blue-900/50 dark:hover:text-blue-200"
                    title={t('common.edit', { defaultValue: 'Edit' })}
                  >
                    {t('common.edit', { defaultValue: 'Edit' })}
                  </button>
                  <button
                    onClick={handleUnlinkSeries}
                    className="rounded-r-full bg-white/90 px-2 py-1.5 text-xs font-medium text-gray-400 ring-1 ring-blue-200/50 hover:bg-red-50 hover:text-red-600 transition-colors dark:bg-blue-900/30 dark:text-gray-500 dark:ring-blue-800/40 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    title={t('common.remove', { defaultValue: 'Remove' })}
                  >
                    <XMarkIcon className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsSeriesSelectorOpen(true)}
                  className="inline-flex items-center gap-2 rounded-full border border-dashed border-blue-300 bg-white/50 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors dark:border-blue-800/50 dark:bg-gray-800/30 dark:text-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300"
                >
                  <LinkIcon className="h-3.5 w-3.5" />
                  {t('workspaces.groups.actions.assignToSeries', { defaultValue: 'Assign to series' })}
                </button>
              )}
            </div>
          </div>

          {/* Right Column: Date, Location, Audience */}
          <div className="flex flex-col gap-3 w-full max-w-[320px] ml-auto">
            <div className="flex items-center gap-2">
              <CalendarDaysIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <DatePickerField
                value={meetingDate}
                onChange={(nextDate) => {
                  setMeetingDate(nextDate);
                  debouncedSave();
                }}
                placeholder={t('workspaces.groups.meetings.datePlaceholder', { defaultValue: 'No date' })}
                wrapperClassName="w-full"
                inputClassName="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 pr-12 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <MapPinIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <LiveTextInput
                disabled={!meetingFieldsEnabled}
                value={meetingLocation}
                onChange={(value) => { setMeetingLocation(value); debouncedSave(); }}
                placeholder={t('workspaces.groups.meetings.location', { defaultValue: 'Location' })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
            <div className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <LiveTextInput
                disabled={!meetingFieldsEnabled}
                value={meetingAudience}
                onChange={(value) => { setMeetingAudience(value); debouncedSave(); }}
                placeholder={t('workspaces.groups.meetings.audience', { defaultValue: 'Audience' })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 transition focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="space-y-6">
          {/* Unified Flow List */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('groupFlow.title', { defaultValue: 'Group Flow' })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('groupFlow.description', {
                    defaultValue: 'Arrange blocks in the exact sequence of the meeting.',
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {normalizedFlow.length > 0 && (
                  <Link
                    href={`/groups/${group.id}/conduct`}
                    className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 shadow-sm transition hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/60"
                  >
                    <PlayIcon className="h-4 w-4" />
                    {t('conduct.startButton', { defaultValue: 'Start Meeting' })}
                  </Link>
                )}
                <AddBlockButton onAdd={handleAddBlock} />
              </div>
            </div>

            <div className="space-y-2">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={normalizedFlow.map((i) => i.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {normalizedFlow.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                      <p className="mb-3">
                        {t('groupFlow.emptyState', {
                          defaultValue: 'No blocks yet',
                        })}
                      </p>
                    </div>
                  ) : (
                    normalizedFlow.map((flowItem, index) => {
                      const template = templatesById.get(flowItem.templateId);
                      if (!template) return null;

                      return (
                        <FlowItemRow
                          key={flowItem.id}
                          flowItem={flowItem}
                          template={template}
                          index={index}
                          isSelected={selectedFlowItemId === flowItem.id}
                          isFirst={index === 0}
                          isLast={index === normalizedFlow.length - 1}
                          onSelect={() => setSelectedFlowItemId(
                            selectedFlowItemId === flowItem.id ? null : flowItem.id
                          )}
                          onStatusCycle={() => cycleStatus(template.id)}
                          onMoveUp={() => { setFlow((prev) => moveFlowItem(prev, flowItem.id, 'up')); debouncedSave(); }}
                          onMoveDown={() => { setFlow((prev) => moveFlowItem(prev, flowItem.id, 'down')); debouncedSave(); }}
                          onDuplicate={() => { setFlow((prev) => duplicateFlowItem(prev, flowItem.id)); debouncedSave(); }}
                          onDelete={() => removeFlowBlock(flowItem.id)}
                        />
                      );
                    })
                  )}
                </SortableContext>
              </DndContext>
            </div>

            <div className="mt-3">
              <FlowFooter
                totalDuration={totalDuration}
                filledCount={filledCount}
                totalCount={normalizedFlow.length}
              />
            </div>
          </div>
        </div>

        <div className="space-y-6">
          {/* Side panel editor — shows when a block is selected */}
          {selectedFlowItem && selectedTemplate ? (
            <div className="xl:sticky xl:top-4">
              <FlowEditor
                flowItem={selectedFlowItem}
                template={selectedTemplate}
                onUpdateTemplate={(updates) => updateTemplate(selectedTemplate.id, updates)}
                onUpdateFlowItem={(updates) => updateFlowItem(selectedFlowItem.id, updates)}
                onClose={() => setSelectedFlowItemId(null)}
              />
            </div>
          ) : (
            <div className="hidden rounded-2xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 xl:block dark:border-gray-700 dark:text-gray-400">
              {t('groupFlow.editor.placeholder', {
                defaultValue: 'Select a block from the flow to edit its content',
              })}
            </div>
          )}
        </div>
      </div>

      {isSeriesSelectorOpen && (
        <SeriesSelector
          mode="change"
          currentSeriesId={groupSeries?.id}
          onSelect={handleSeriesSelect}
          onClose={() => setIsSeriesSelectorOpen(false)}
        />
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={() => {
          setShowDeleteConfirm(false);
          handleDeleteGroup();
        }}
        title={t('workspaces.groups.actions.deleteConfirmTitle', { defaultValue: 'Delete Group' })}
        description={`${t('workspaces.groups.actions.deleteConfirm', {
          defaultValue: 'Delete this group permanently?',
        })} "${group.title}"`}
        confirmText={t('workspaces.groups.actions.delete', { defaultValue: 'Delete' })}
        isDeleting={deletingGroup}
      />
    </section>
  );
}

function GroupSaveStatus({ status, t }: { status: string; t: ReturnType<typeof useTranslation>['t'] }) {
  return (
    <>
      {status === 'saving' && (
        <span className="text-xs text-gray-400 dark:text-gray-500">
          {t('common.saving', { defaultValue: 'Saving...' })}
        </span>
      )}
      {status === 'saved' && (
        <span className="text-xs text-emerald-600 dark:text-emerald-400">
          <CheckCircleIcon className="mr-1 inline h-3.5 w-3.5" />
          {t('common.saved', { defaultValue: 'Saved' })}
        </span>
      )}
    </>
  );
}
