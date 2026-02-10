"use client";

import { MagnifyingGlassIcon, PlusIcon, XMarkIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { useGroups } from '@/hooks/useGroups';
import { useAuth } from '@/providers/AuthProvider';

interface AddGroupToSeriesModalProps {
  onClose: () => void;
  onAddGroups: (groupIds: string[]) => Promise<void>;
  currentSeriesGroupIds: string[];
}

export default function AddGroupToSeriesModal({
  onClose,
  onAddGroups,
  currentSeriesGroupIds,
}: AddGroupToSeriesModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { groups, loading } = useGroups(user?.uid || null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const availableGroups = useMemo(
    () => groups.filter((group) => !currentSeriesGroupIds.includes(group.id)),
    [groups, currentSeriesGroupIds]
  );

  const filteredGroups = useMemo(() => {
    if (!searchQuery.trim()) return availableGroups;
    const query = searchQuery.trim().toLowerCase();
    return availableGroups.filter((group) => {
      const haystack = `${group.title} ${group.description || ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [availableGroups, searchQuery]);

  const toggleGroupSelection = (groupId: string) => {
    const next = new Set(selectedGroupIds);
    if (next.has(groupId)) {
      next.delete(groupId);
    } else {
      next.add(groupId);
    }
    setSelectedGroupIds(next);
  };

  const handleAddSelected = async () => {
    if (selectedGroupIds.size === 0) return;
    setIsAdding(true);
    try {
      await onAddGroups(Array.from(selectedGroupIds));
      onClose();
    } finally {
      setIsAdding(false);
    }
  };

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-3xl mx-4 max-h-[85vh] overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800 flex flex-col">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-600 via-teal-500 to-cyan-500" />
        <div className="p-6 sm:p-7 flex flex-col flex-1 overflow-hidden">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-100 dark:ring-emerald-800/60">
                {t('navigation.groups', { defaultValue: 'Groups' })}
              </p>
              <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">
                {t('workspaces.series.actions.addGroup', { defaultValue: 'Add groups to series' })}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('workspaces.series.detail.selectGroupsDescription', {
                  defaultValue: 'Select one or more groups to include in this series.',
                })}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          <div className="relative mb-4">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('common.search') || 'Search groups...'}
              className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
            />
          </div>

          <div className="flex-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-gray-500 dark:text-gray-400">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-b-transparent border-blue-600 mr-3" />
                {t('workspaces.series.loadingSeries')}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="text-center py-10 text-gray-500 dark:text-gray-400">
                {t('workspaces.series.detail.noGroupsFound', { defaultValue: 'No groups found' })}
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGroups.map((group) => (
                  <div
                    key={group.id}
                    className={`cursor-pointer rounded-xl border p-3 transition bg-white/80 dark:bg-gray-800/70 ${
                      selectedGroupIds.has(group.id)
                        ? 'border-emerald-500 ring-2 ring-emerald-500/20'
                        : 'border-gray-200 hover:border-emerald-200 hover:shadow-sm dark:border-gray-700'
                    }`}
                    onClick={() => toggleGroupSelection(group.id)}
                  >
                    <div className="flex gap-3">
                      <input
                        type="checkbox"
                        checked={selectedGroupIds.has(group.id)}
                        onChange={() => toggleGroupSelection(group.id)}
                        className="mt-1 h-5 w-5 rounded border-gray-300 text-emerald-600 shadow-sm focus:ring-emerald-500 dark:border-gray-600 dark:bg-gray-700"
                        onClick={(event) => event.stopPropagation()}
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {group.title}
                        </h3>
                        {group.description && (
                          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                            {group.description}
                          </p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500 dark:text-gray-400">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200">
                            {(group.templates || []).length}{' '}
                            {t('workspaces.groups.itemsLabel.templates', { defaultValue: 'templates' })}
                          </span>
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200">
                            {(group.flow || []).length}{' '}
                            {t('workspaces.groups.itemsLabel.flowSteps', { defaultValue: 'flow steps' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-4 dark:border-gray-800">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t('workspaces.series.actions.selectedCount', { count: selectedGroupIds.size })}
            </span>
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleAddSelected}
                disabled={selectedGroupIds.size === 0 || isAdding}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isAdding ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-b-transparent border-white" />
                    {t('workspaces.series.actions.adding')}
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4" />
                    {t('workspaces.series.actions.addSelected')}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(content, document.body);
}
