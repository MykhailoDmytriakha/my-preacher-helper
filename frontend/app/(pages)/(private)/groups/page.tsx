'use client';

import { PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import CreateGroupModal from '@/components/groups/CreateGroupModal';
import GroupCard from '@/components/groups/GroupCard';
import ConfirmModal from '@/components/ui/ConfirmModal';
import { useGroups } from '@/hooks/useGroups';
import { useSeries } from '@/hooks/useSeries';
import { Group } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { hasGroupsAccess } from '@/services/userSettings.service';
import '@locales/i18n';

export default function GroupsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [groupsEnabled, setGroupsEnabled] = useState(false);
  const [accessLoading, setAccessLoading] = useState(true);
  const groupsUserId = user?.uid && groupsEnabled ? user.uid : null;
  const { groups, loading, error, refreshGroups, createNewGroup, deleteExistingGroup } = useGroups(groupsUserId);
  const { series } = useSeries(groupsUserId);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

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

  const stats = useMemo(() => {
    const active = groups.filter((group) => group.status === 'active').length;
    const completed = groups.filter((group) => group.status === 'completed').length;
    const drafts = groups.filter((group) => group.status === 'draft').length;
    return { total: groups.length, active, completed, drafts };
  }, [groups]);

  const handleCreateGroup = async (payload: Omit<Group, 'id'>) => {
    try {
      await createNewGroup(payload);
      toast.success(
        t('workspaces.groups.messages.created', { defaultValue: 'Group created successfully' })
      );
      setShowCreateModal(false);
    } catch (errorValue) {
      console.error('Failed to create group:', errorValue);
      toast.error(
        t('workspaces.groups.errors.createFailed', {
          defaultValue: 'Failed to create group',
        })
      );
    }
  };

  const handleDeleteGroupTrigger = (group: Group) => {
    setGroupToDelete(group);
  };

  const handleConfirmDelete = async () => {
    if (!groupToDelete) return;

    try {
      setDeletingGroupId(groupToDelete.id);
      await deleteExistingGroup(groupToDelete.id);
      toast.success(
        t('workspaces.groups.messages.deleted', { defaultValue: 'Group deleted successfully' })
      );
      setGroupToDelete(null);
    } catch (errorValue) {
      console.error('Failed to delete group:', errorValue);
      toast.error(
        t('workspaces.groups.errors.deleteFailed', {
          defaultValue: 'Failed to delete group',
        })
      );
    } finally {
      setDeletingGroupId(null);
    }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {t('navigation.groups', { defaultValue: 'Groups' })}
          </h1>
        </header>
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {t('workspaces.groups.errors.loadFailed', { defaultValue: 'Failed to load groups' })}
        </div>
      </div>
    );
  }

  if (accessLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((index) => (
          <div
            key={index}
            className="h-36 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  if (!groupsEnabled) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t('navigation.groups', { defaultValue: 'Groups' })}
        </h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-900 dark:border-amber-700/50 dark:bg-amber-950/40 dark:text-amber-100">
          <p className="text-base font-semibold">
            {t('workspaces.groups.access.disabledTitle', {
              defaultValue: 'Groups workspace is disabled',
            })}
          </p>
          <p className="mt-1 text-sm">
            {t('workspaces.groups.access.disabledDescription', {
              defaultValue: 'Enable this beta feature in Settings to access groups.',
            })}
          </p>
          <Link
            href="/settings"
            className="mt-3 inline-flex items-center rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-700"
          >
            {t('workspaces.groups.access.openSettings', { defaultValue: 'Open settings' })}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-3">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-500">
          {t('workspaces.groups.badge', { defaultValue: 'Workspace' })}
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              {t('workspaces.groups.title', { defaultValue: 'Groups workspace' })}
            </h1>
            <p className="text-base text-gray-600 dark:text-gray-300 max-w-2xl">
              {t('workspaces.groups.description', {
                defaultValue:
                  'Prepare modular group meetings with reusable templates, flexible flow, and calendar-ready sessions.',
              })}
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => refreshGroups()}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {t('common.refresh', { defaultValue: 'Refresh' })}
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
            >
              <PlusIcon className="h-4 w-4" />
              {t('workspaces.groups.actions.newGroup', { defaultValue: 'New group' })}
            </button>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.groups.stats.total', { defaultValue: 'Total groups' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-gray-900 dark:text-gray-100">{stats.total}</span>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.groups.stats.active', { defaultValue: 'Active' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-blue-600 dark:text-blue-300">{stats.active}</span>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.groups.stats.draft', { defaultValue: 'Draft' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-amber-600 dark:text-amber-300">{stats.drafts}</span>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
            {t('workspaces.groups.stats.completed', { defaultValue: 'Completed' })}
          </p>
          <span className="mt-2 block text-2xl font-bold text-emerald-600 dark:text-emerald-300">
            {stats.completed}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((index) => (
            <div
              key={index}
              className="h-36 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white/50 p-8 text-center dark:border-gray-700 dark:bg-gray-900/40">
          <p className="text-gray-600 dark:text-gray-300">
            {t('workspaces.groups.empty', { defaultValue: 'No groups yet. Create your first group.' })}
          </p>
          <button
            onClick={() => setShowCreateModal(true)}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"
          >
            <PlusIcon className="h-4 w-4" />
            {t('workspaces.groups.actions.newGroup', { defaultValue: 'New group' })}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" data-testid="groups-grid">
          {groups.map((group) => (
            <GroupCard
              key={group.id}
              group={group}
              series={series}
              onDelete={() => handleDeleteGroupTrigger(group)}
              deleting={deletingGroupId === group.id}
            />
          ))}
        </div>
      )}

      {showCreateModal && (
        <CreateGroupModal onClose={() => setShowCreateModal(false)} onCreate={handleCreateGroup} />
      )}

      <ConfirmModal
        isOpen={!!groupToDelete}
        onClose={() => setGroupToDelete(null)}
        onConfirm={handleConfirmDelete}
        title={t('workspaces.groups.actions.deleteConfirmTitle', { defaultValue: 'Delete Group' })}
        description={
          groupToDelete
            ? `${t('workspaces.groups.actions.deleteConfirm', {
              defaultValue: 'Delete this group permanently?',
            })} "${groupToDelete.title}"`
            : t('workspaces.groups.actions.deleteConfirm', {
              defaultValue: 'Delete this group permanently?',
            })
        }
        confirmText={t('workspaces.groups.actions.delete', { defaultValue: 'Delete' })}
        isDeleting={!!deletingGroupId}
      />
    </section>
  );
}
