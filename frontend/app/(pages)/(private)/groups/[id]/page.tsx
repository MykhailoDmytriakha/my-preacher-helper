'use client';

import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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

  const { group, loading, updateGroupDetail, addMeetingDate, removeMeetingDate, deleteGroupDetail } =
    useGroupDetail(groupsEnabled ? groupId : '');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>('draft');
  const [templates, setTemplates] = useState<GroupBlockTemplate[]>([]);
  const [flow, setFlow] = useState<GroupFlowItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [selectedFlowItemId, setSelectedFlowItemId] = useState<string | null>(null);

  const [meetingDate, setMeetingDate] = useState(new Date().toISOString().split('T')[0]);
  const [meetingLocation, setMeetingLocation] = useState('');
  const [meetingAudience, setMeetingAudience] = useState('');
  const [meetingNotes, setMeetingNotes] = useState('');
  const [addingMeeting, setAddingMeeting] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);

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
    if (!group) return;
    setTitle(group.title);
    setDescription(group.description || '');
    setStatus(group.status);
    setTemplates(group.templates || []);
    setFlow(normalizeFlow(group.flow || []));
  }, [group]);

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
  };

  const removeFlowBlock = (flowItemId: string) => {
    const item = flow.find((f) => f.id === flowItemId);
    if (!item) return;
    // Remove flow item
    setFlow((prev) => removeFlowItem(prev, flowItemId));
    // Remove template if no other flow items reference it
    const otherRefs = flow.filter((f) => f.id !== flowItemId && f.templateId === item.templateId);
    if (otherRefs.length === 0) {
      setTemplates((prev) => prev.filter((t) => t.id !== item.templateId));
    }
    if (selectedFlowItemId === flowItemId) setSelectedFlowItemId(null);
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
  };

  const saveChanges = async () => {
    if (!group) return;
    try {
      setSaving(true);
      await updateGroupDetail({
        title: title.trim(),
        description: description.trim() || undefined,
        status,
        templates,
        flow: normalizeFlow(flow),
      });
      toast.success(
        t('workspaces.groups.messages.saved', {
          defaultValue: 'Group updated successfully',
        })
      );
    } catch (errorValue) {
      console.error('Failed to save group changes:', errorValue);
      toast.error(
        t('workspaces.groups.errors.updateFailed', {
          defaultValue: 'Failed to update group',
        })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleAddMeeting = async () => {
    if (!meetingDate) return;
    try {
      setAddingMeeting(true);
      await addMeetingDate({
        date: meetingDate,
        location: meetingLocation.trim() || undefined,
        audience: meetingAudience.trim() || undefined,
        notes: meetingNotes.trim() || undefined,
      });
      setMeetingLocation('');
      setMeetingAudience('');
      setMeetingNotes('');
      toast.success(
        t('workspaces.groups.messages.meetingAdded', {
          defaultValue: 'Meeting date added',
        })
      );
    } catch (errorValue) {
      console.error('Failed to add meeting date:', errorValue);
      toast.error(
        t('workspaces.groups.errors.meetingAddFailed', {
          defaultValue: 'Failed to add meeting date',
        })
      );
    } finally {
      setAddingMeeting(false);
    }
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
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-3">
            <button
              onClick={() => router.push('/groups')}
              className="inline-flex items-center gap-2 rounded-full bg-white/70 px-3 py-1 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-gray-200 transition hover:-translate-y-0.5 hover:shadow-md dark:bg-gray-900/80 dark:text-gray-200 dark:ring-gray-800"
            >
              <ArrowLeftIcon className="h-4 w-4" />
              {t('navigation.groups', { defaultValue: 'Groups' })}
            </button>

            <div className="space-y-2">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-2xl font-bold text-gray-900 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700 shadow-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                placeholder={t('workspaces.groups.form.descriptionPlaceholder', {
                  defaultValue: 'Optional description',
                })}
              />
              <div className="flex flex-wrap items-center gap-3">
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as typeof status)}
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
          </div>

          <div className="flex h-fit items-center gap-2">
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
            <button
              onClick={saveChanges}
              disabled={saving || deletingGroup}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {saving
                ? t('common.saving', { defaultValue: 'Saving...' })
                : t('common.save', { defaultValue: 'Save' })}
            </button>
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
                      onMoveUp={() => setFlow((prev) => moveFlowItem(prev, flowItem.id, 'up'))}
                      onMoveDown={() => setFlow((prev) => moveFlowItem(prev, flowItem.id, 'down'))}
                      onDuplicate={() => setFlow((prev) => duplicateFlowItem(prev, flowItem.id))}
                      onDelete={() => removeFlowBlock(flowItem.id)}
                    />
                  );
                })
              )}
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

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex items-center gap-2">
              <CalendarDaysIcon className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('workspaces.groups.meetings.title', { defaultValue: 'Meeting dates' })}
              </h2>
            </div>

            <div className="space-y-3">
              <input
                type="date"
                value={meetingDate}
                onChange={(event) => setMeetingDate(event.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <input
                value={meetingLocation}
                onChange={(event) => setMeetingLocation(event.target.value)}
                placeholder={t('workspaces.groups.meetings.location', { defaultValue: 'Location (optional)' })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <input
                value={meetingAudience}
                onChange={(event) => setMeetingAudience(event.target.value)}
                placeholder={t('workspaces.groups.meetings.audience', { defaultValue: 'Audience (optional)' })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <textarea
                value={meetingNotes}
                onChange={(event) => setMeetingNotes(event.target.value)}
                rows={3}
                placeholder={t('workspaces.groups.meetings.notes', { defaultValue: 'Notes (optional)' })}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
              <button
                onClick={handleAddMeeting}
                disabled={addingMeeting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <PlusIcon className="h-4 w-4" />
                {addingMeeting
                  ? t('common.saving', { defaultValue: 'Saving...' })
                  : t('workspaces.groups.meetings.add', { defaultValue: 'Add meeting date' })}
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {(group.meetingDates || []).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspaces.groups.meetings.empty', { defaultValue: 'No meeting dates yet.' })}
                </p>
              ) : (
                (group.meetingDates || [])
                  .slice()
                  .sort((a, b) => b.date.localeCompare(a.date))
                  .map((meeting) => (
                    <div
                      key={meeting.id}
                      className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700"
                    >
                      <div>
                        <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{meeting.date}</p>
                        {(meeting.location || meeting.audience) && (
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {[meeting.location, meeting.audience].filter(Boolean).join(' · ')}
                          </p>
                        )}
                        {meeting.notes && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{meeting.notes}</p>
                        )}
                      </div>
                      <button
                        onClick={() => removeMeetingDate(meeting.id)}
                        className="rounded-lg border border-red-200 bg-red-50 p-1.5 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
