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
  TrashIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import debounce from 'lodash/debounce';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddBlockButton from '@/components/groups/AddBlockButton';
import FlowEditor from '@/components/groups/FlowEditor';
import FlowFooter from '@/components/groups/FlowFooter';
import FlowItemRow from '@/components/groups/FlowItemRow';
import { useGroupDetail } from '@/hooks/useGroupDetail';
import { GroupBlockStatus, GroupBlockTemplate, GroupBlockTemplateType, GroupFlowItem } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { hasGroupsAccess } from '@/services/userSettings.service';
import {
  createFlowItem,
  createTemplate,
  duplicateFlowItem,
  moveFlowItem,
  normalizeFlow,
  removeFlowItem,
} from '@/utils/groupFlow';

const STATUS_CYCLE: GroupBlockStatus[] = ['empty', 'draft', 'filled'];

export default function GroupDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const groupId = typeof id === 'string' ? id : '';
  const [groupsEnabled, setGroupsEnabled] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true);

  const { group, loading, updateGroupDetail, addMeetingDate, updateMeetingDate, removeMeetingDate, deleteGroupDetail } =
    useGroupDetail(groupsEnabled ? groupId : '');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>('draft');
  const [templates, setTemplates] = useState<GroupBlockTemplate[]>([]);
  const [flow, setFlow] = useState<GroupFlowItem[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [selectedFlowItemId, setSelectedFlowItemId] = useState<string | null>(null);
  const saveStatusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const updateGroupDetailRef = useRef(updateGroupDetail);
  // Refs so the debounced save always reads the latest state without re-triggering
  const titleRef = useRef(title);
  const descriptionRef = useRef(description);
  const statusRef = useRef(status);
  const templatesRef = useRef(templates);
  const flowRef = useRef(flow);
  titleRef.current = title;
  descriptionRef.current = description;
  statusRef.current = status;
  templatesRef.current = templates;
  flowRef.current = flow;

  const [meetingDate, setMeetingDate] = useState('');
  const [isDateFocused, setIsDateFocused] = useState(false);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAudience, setMeetingAudience] = useState('');
  const [deletingGroup, setDeletingGroup] = useState(false);

  const meetingDateRef = useRef(meetingDate);
  const meetingLocationRef = useRef(meetingLocation);
  const meetingAudienceRef = useRef(meetingAudience);
  const addMeetingDateRef = useRef(addMeetingDate);
  const updateMeetingDateRef = useRef(updateMeetingDate);
  const removeMeetingDateRef = useRef(removeMeetingDate);
  meetingDateRef.current = meetingDate;
  meetingLocationRef.current = meetingLocation;
  meetingAudienceRef.current = meetingAudience;
  addMeetingDateRef.current = addMeetingDate;
  updateMeetingDateRef.current = updateMeetingDate;
  removeMeetingDateRef.current = removeMeetingDate;

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

  useEffect(() => {
    let isActive = true;

    async function checkAccess() {
      if (!user?.uid) {
        if (isActive) {
          setGroupsEnabled(false);
          setAccessLoading(false);
        }
        return;
      }

      const access = await hasGroupsAccess(user.uid);
      if (isActive) {
        setGroupsEnabled(access);
        setAccessLoading(false);
      }
    }

    checkAccess();
    return () => {
      isActive = false;
    };
  }, [user?.uid]);

  useEffect(() => {
    updateGroupDetailRef.current = updateGroupDetail;
  }, [updateGroupDetail]);

  useEffect(() => {
    if (!group) return;
    setTitle(group.title);
    setDescription(group.description || '');
    setStatus(group.status);
    setTemplates(group.templates || []);
    setFlow(normalizeFlow(group.flow || []));
    const firstMeeting = group.meetingDates?.[0];
    setMeetingDate(firstMeeting?.date || '');
    setMeetingLocation(firstMeeting?.location || '');
    setMeetingAudience(firstMeeting?.audience || '');
  }, [group]);

  // Keep a ref to the server-side meeting date id so we know whether to add/update/remove
  const existingMeetingIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    existingMeetingIdRef.current = group?.meetingDates?.[0]?.id;
  }, [group]);

  const performSave = useCallback(
    async () => {
      try {
        setSaveStatus('saving');
        await updateGroupDetailRef.current({
          title: titleRef.current.trim(),
          description: descriptionRef.current.trim() || undefined,
          status: statusRef.current,
          templates: templatesRef.current,
          flow: normalizeFlow(flowRef.current),
        });

        // Sync single meeting date
        const date = meetingDateRef.current;
        const location = meetingLocationRef.current.trim() || undefined;
        const audience = meetingAudienceRef.current.trim() || undefined;
        const existingId = existingMeetingIdRef.current;

        if (date && existingId) {
          await updateMeetingDateRef.current(existingId, { date, location, audience });
        } else if (date && !existingId) {
          await addMeetingDateRef.current({ date, location, audience });
        } else if (!date && existingId) {
          await removeMeetingDateRef.current(existingId);
        }

        setSaveStatus('saved');
        clearTimeout(saveStatusTimerRef.current);
        saveStatusTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      } catch (errorValue) {
        console.error('Failed to save group changes:', errorValue);
        toast.error(
          t('workspaces.groups.errors.updateFailed', {
            defaultValue: 'Failed to update group',
          })
        );
        setSaveStatus('idle');
      }
    },
    [t]
  );

  // Stable identity — never recreated, so calling it never triggers re-renders
  const debouncedSave = useMemo(() => debounce(performSave, 500), [performSave]);

  // Flush pending saves on unmount
  useEffect(() => {
    return () => {
      debouncedSave.flush();
      clearTimeout(saveStatusTimerRef.current);
    };
  }, [debouncedSave]);

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
    const nextTemplate = createTemplate(type);
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

    const confirmed = window.confirm(
      t('workspaces.groups.actions.deleteConfirm', {
        defaultValue: 'Delete this group permanently?',
      })
    );

    if (!confirmed) return;

    try {
      setDeletingGroup(true);
      await deleteGroupDetail();
      toast.success(
        t('workspaces.groups.messages.deleted', {
          defaultValue: 'Group deleted successfully',
        })
      );
      router.push('/groups');
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

  if (accessLoading || (groupsEnabled && loading)) {
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

  if (!groupsEnabled) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => router.push('/settings')}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {t('navigation.settings', { defaultValue: 'Settings' })}
        </button>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="font-semibold">
            {t('workspaces.groups.access.disabledTitle', {
              defaultValue: 'Groups workspace is disabled',
            })}
          </p>
          <p className="mt-1 text-sm">
            {t('workspaces.groups.access.disabledDescription', {
              defaultValue: 'Enable this beta feature in Settings to access groups.',
            })}
          </p>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="space-y-4">
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
            {saveStatus === 'saving' && (
              <span className="text-xs text-gray-400 dark:text-gray-500">
                {t('common.saving', { defaultValue: 'Saving...' })}
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400">
                <CheckCircleIcon className="mr-1 inline h-3.5 w-3.5" />
                {t('common.saved', { defaultValue: 'Saved' })}
              </span>
            )}
            <button
              onClick={handleDeleteGroup}
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
            <input
              value={title}
              onChange={(event) => { setTitle(event.target.value); debouncedSave(); }}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-2xl font-bold text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
            />
            <textarea
              value={description}
              onChange={(event) => { setDescription(event.target.value); debouncedSave(); }}
              rows={2}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
              placeholder={t('workspaces.groups.form.descriptionPlaceholder', {
                defaultValue: 'Optional description',
              })}
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value as typeof status); debouncedSave(); }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="draft">{t('workspaces.series.form.statuses.draft')}</option>
                <option value="active">{t('workspaces.series.form.statuses.active')}</option>
                <option value="completed">{t('workspaces.series.form.statuses.completed')}</option>
              </select>
              {group.seriesId && (
                <Link
                  href={`/series/${group.seriesId}`}
                  className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/30 dark:text-blue-100 dark:ring-blue-800/60"
                >
                  <CheckCircleIcon className="h-3.5 w-3.5" />
                  {t('workspaces.groups.inSeries', { defaultValue: 'Part of a series' })}
                </Link>
              )}
            </div>
          </div>

          {/* Right Column: Date, Location, Audience */}
          <div className="flex flex-col gap-3 w-full max-w-[320px] ml-auto">
            <div className="flex items-center gap-2">
              <CalendarDaysIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <input
                type={isDateFocused || meetingDate ? 'date' : 'text'}
                value={meetingDate}
                onChange={(event) => {
                  setMeetingDate(event.target.value);
                  debouncedSave();
                }}
                onFocus={() => setIsDateFocused(true)}
                onBlur={() => setIsDateFocused(false)}
                placeholder={t('workspaces.groups.meetings.datePlaceholder', { defaultValue: 'No date' })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <MapPinIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <input
                value={meetingLocation}
                onChange={(event) => { setMeetingLocation(event.target.value); debouncedSave(); }}
                placeholder={t('workspaces.groups.meetings.location', { defaultValue: 'Location' })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>
            <div className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <input
                value={meetingAudience}
                onChange={(event) => { setMeetingAudience(event.target.value); debouncedSave(); }}
                placeholder={t('workspaces.groups.meetings.audience', { defaultValue: 'Audience' })}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
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
              <AddBlockButton onAdd={handleAddBlock} />
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
    </section>
  );
}
