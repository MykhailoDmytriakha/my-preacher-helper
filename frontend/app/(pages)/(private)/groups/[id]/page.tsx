'use client';

import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  PlusIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useGroupDetail } from '@/hooks/useGroupDetail';
import { GroupBlockTemplate, GroupBlockTemplateType, GroupFlowItem } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { hasGroupsAccess } from '@/services/userSettings.service';
import {
  createFlowItem,
  createTemplate,
  duplicateFlowItem,
  getFilledFlowItems,
  moveFlowItem,
  normalizeFlow,
  removeFlowItem,
} from '@/utils/groupFlow';

const TEMPLATE_OPTIONS: Array<{ type: GroupBlockTemplateType; labelKey: string; fallback: string }> = [
  { type: 'announcement', labelKey: 'workspaces.groups.types.announcement', fallback: 'Announcement' },
  { type: 'topic', labelKey: 'workspaces.groups.types.topic', fallback: 'Main topic' },
  { type: 'scripture', labelKey: 'workspaces.groups.types.scripture', fallback: 'Scripture' },
  { type: 'questions', labelKey: 'workspaces.groups.types.questions', fallback: 'Questions' },
  { type: 'explanation', labelKey: 'workspaces.groups.types.explanation', fallback: 'Explanation' },
  { type: 'notes', labelKey: 'workspaces.groups.types.notes', fallback: 'Notes' },
  { type: 'prayer', labelKey: 'workspaces.groups.types.prayer', fallback: 'Prayer focus' },
  { type: 'custom', labelKey: 'workspaces.groups.types.custom', fallback: 'Custom' },
];

export default function GroupDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const groupId = typeof id === 'string' ? id : '';
  const [groupsEnabled, setGroupsEnabled] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true);

  const { group, loading, error, updateGroupDetail, addMeetingDate, removeMeetingDate, deleteGroupDetail } =
    useGroupDetail(groupsEnabled ? groupId : '');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'draft' | 'active' | 'completed'>('draft');
  const [templates, setTemplates] = useState<GroupBlockTemplate[]>([]);
  const [flow, setFlow] = useState<GroupFlowItem[]>([]);
  const [saving, setSaving] = useState(false);

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

  const filledPreview = useMemo(() => getFilledFlowItems(flow, templates), [flow, templates]);

  const addTemplate = (type: GroupBlockTemplateType) => {
    const nextTemplate = createTemplate(type, {
      title: t(
        TEMPLATE_OPTIONS.find((option) => option.type === type)?.labelKey || '',
        { defaultValue: TEMPLATE_OPTIONS.find((option) => option.type === type)?.fallback || 'Block' }
      ),
    });
    setTemplates((prev) => [...prev, nextTemplate]);
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

  const removeTemplate = (templateId: string) => {
    setTemplates((prev) => prev.filter((template) => template.id !== templateId));
    setFlow((prev) => normalizeFlow(prev.filter((flowItem) => flowItem.templateId !== templateId)));
  };

  const addTemplateToFlow = (templateId: string) => {
    setFlow((prev) => normalizeFlow([...prev, createFlowItem(templateId, prev.length + 1)]));
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

  if (accessLoading || loading) {
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

  if (error || !group) {
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

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.groups.templates.title', { defaultValue: 'Template library' })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspaces.groups.templates.subtitle', {
                    defaultValue: 'Create reusable blocks and mark their completion status.',
                  })}
                </p>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {TEMPLATE_OPTIONS.map((option) => (
                <button
                  key={option.type}
                  onClick={() => addTemplate(option.type)}
                  className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
                >
                  <PlusIcon className="h-3.5 w-3.5" />
                  {t(option.labelKey, { defaultValue: option.fallback })}
                </button>
              ))}
            </div>

            <div className="space-y-4">
              {templates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('workspaces.groups.templates.empty', {
                    defaultValue: 'No templates yet. Add your first block type.',
                  })}
                </div>
              ) : (
                templates.map((template) => (
                  <div key={template.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <input
                        value={template.title}
                        onChange={(event) => updateTemplate(template.id, { title: event.target.value })}
                        className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={template.status}
                          onChange={(event) =>
                            updateTemplate(template.id, {
                              status: event.target.value as GroupBlockTemplate['status'],
                            })
                          }
                          className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                        >
                          <option value="empty">
                            {t('workspaces.groups.status.empty', { defaultValue: 'Empty' })}
                          </option>
                          <option value="draft">
                            {t('workspaces.groups.status.draft', { defaultValue: 'Draft' })}
                          </option>
                          <option value="filled">
                            {t('workspaces.groups.status.filled', { defaultValue: 'Filled' })}
                          </option>
                        </select>
                        <button
                          onClick={() => addTemplateToFlow(template.id)}
                          className="rounded-lg bg-blue-600 px-2 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                        >
                          {t('workspaces.groups.flow.addToFlow', { defaultValue: 'Add to flow' })}
                        </button>
                        <button
                          onClick={() => removeTemplate(template.id)}
                          className="rounded-lg border border-red-200 bg-red-50 px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <textarea
                      value={template.content}
                      onChange={(event) => updateTemplate(template.id, { content: event.target.value })}
                      rows={4}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                      placeholder={t('workspaces.groups.templates.contentPlaceholder', {
                        defaultValue: 'Write content, notes, key points, or context here...',
                      })}
                    />
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {t('workspaces.groups.flow.title', { defaultValue: 'Group flow' })}
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {t('workspaces.groups.flow.subtitle', {
                    defaultValue: 'Reorder, duplicate, and set optional timing per step.',
                  })}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {flow.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  {t('workspaces.groups.flow.empty', {
                    defaultValue: 'No flow steps yet. Add a template to flow.',
                  })}
                </div>
              ) : (
                normalizeFlow(flow).map((flowItem, index) => {
                  const template = templatesById.get(flowItem.templateId);
                  if (!template) return null;

                  return (
                    <div key={flowItem.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                            {index + 1}
                          </span>
                          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                            {flowItem.instanceTitle || template.title}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            onClick={() => setFlow((prev) => moveFlowItem(prev, flowItem.id, 'up'))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            {t('workspaces.groups.flow.moveUp', { defaultValue: 'Up' })}
                          </button>
                          <button
                            onClick={() => setFlow((prev) => moveFlowItem(prev, flowItem.id, 'down'))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            {t('workspaces.groups.flow.moveDown', { defaultValue: 'Down' })}
                          </button>
                          <button
                            onClick={() => setFlow((prev) => duplicateFlowItem(prev, flowItem.id))}
                            className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            {t('workspaces.groups.flow.duplicate', { defaultValue: 'Duplicate' })}
                          </button>
                          <button
                            onClick={() => setFlow((prev) => removeFlowItem(prev, flowItem.id))}
                            className="rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200"
                          >
                            {t('common.delete', { defaultValue: 'Delete' })}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <input
                          value={flowItem.instanceTitle || ''}
                          onChange={(event) =>
                            updateFlowItem(flowItem.id, { instanceTitle: event.target.value || undefined })
                          }
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          placeholder={t('workspaces.groups.flow.instanceTitle', {
                            defaultValue: 'Optional instance title',
                          })}
                        />
                        <input
                          type="number"
                          min={1}
                          value={flowItem.durationMin ?? ''}
                          onChange={(event) =>
                            updateFlowItem(flowItem.id, {
                              durationMin: event.target.value ? Number(event.target.value) : null,
                            })
                          }
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          placeholder={t('workspaces.groups.flow.duration', {
                            defaultValue: 'Duration (optional)',
                          })}
                        />
                        <input
                          value={flowItem.instanceNotes || ''}
                          onChange={(event) =>
                            updateFlowItem(flowItem.id, { instanceNotes: event.target.value || undefined })
                          }
                          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                          placeholder={t('workspaces.groups.flow.instanceNotes', {
                            defaultValue: 'Optional notes',
                          })}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-900">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardDocumentListIcon className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t('workspaces.groups.preview.title', { defaultValue: 'Final preview (filled only)' })}
              </h2>
            </div>

            {filledPreview.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                {t('workspaces.groups.preview.empty', {
                  defaultValue: 'No filled blocks yet. Mark templates as "filled" to include them here.',
                })}
              </div>
            ) : (
              <div className="space-y-3">
                {filledPreview.map(({ flowItem, template }, index) => (
                  <div key={flowItem.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-700">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                        {index + 1}. {flowItem.instanceTitle || template?.title}
                      </h3>
                      {flowItem.durationMin ? (
                        <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                          {flowItem.durationMin} min
                        </span>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-line text-sm text-gray-600 dark:text-gray-300">
                      {template?.content}
                    </p>
                    {flowItem.instanceNotes && (
                      <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                        {flowItem.instanceNotes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

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
