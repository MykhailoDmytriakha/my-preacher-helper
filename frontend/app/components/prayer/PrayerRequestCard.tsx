'use client';

import {
  CheckCircleIcon,
  ClockIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import HighlightedText from '@/components/HighlightedText';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { getPrayerSearchTarget, getPrayerUpdateSearchSnippet } from '@/utils/prayerFilters';

import PrayerStatusBadge from './PrayerStatusBadge';

interface Props {
  prayer: PrayerRequest;
  onSetStatus: (id: string, status: PrayerStatus) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onAddUpdate: (id: string) => void;
  onEdit: (prayer: PrayerRequest) => void;
  searchQuery?: string;
}

function buildPrayerDetailHref(prayer: PrayerRequest, searchQuery: string): string {
  const target = getPrayerSearchTarget(prayer, searchQuery);
  if (!target) {
    return `/prayers/${prayer.id}`;
  }

  const params = new URLSearchParams({
    q: searchQuery.trim(),
    focus: target.type,
  });

  if (target.updateId) {
    params.set('updateId', target.updateId);
  }

  return `/prayers/${prayer.id}?${params.toString()}`;
}

export default function PrayerRequestCard({
  prayer,
  onSetStatus,
  onDelete,
  onAddUpdate,
  onEdit,
  searchQuery = '',
}: Props) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const latestUpdate = prayer.updates.length > 0
    ? prayer.updates[prayer.updates.length - 1]
    : null;
  const matchedUpdateSnippet = getPrayerUpdateSearchSnippet(prayer, searchQuery);
  const detailHref = buildPrayerDetailHref(prayer, searchQuery);

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return; }
    await onDelete(prayer.id);
  };

  const isActive = prayer.status === 'active';
  const isAnswered = prayer.status === 'answered';

  return (
    <div className={`relative bg-white dark:bg-gray-800 rounded-xl p-4 border transition-colors ${
      isAnswered
        ? 'border-green-200 dark:border-green-800/50 hover:border-green-400 dark:hover:border-green-700'
        : 'border-gray-200 dark:border-gray-700 hover:border-rose-300 dark:hover:border-rose-700'
    }`}>
      <div className="flex items-start gap-3">
        <Link
          href={detailHref}
          className="group block flex-1 min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-gray-800"
        >
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <PrayerStatusBadge status={prayer.status} />
            {prayer.tags && prayer.tags.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {prayer.tags.map((tag) => (
                  <span key={tag} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                    <HighlightedText text={tag} searchQuery={searchQuery} />
                  </span>
                ))}
              </div>
            )}
          </div>

          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 leading-snug line-clamp-2 transition-colors group-hover:text-rose-600 dark:group-hover:text-rose-400">
            <HighlightedText text={prayer.title} searchQuery={searchQuery} />
          </p>

          {prayer.description && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 line-clamp-2">
              <HighlightedText text={prayer.description} searchQuery={searchQuery} />
            </p>
          )}

          {matchedUpdateSnippet ? (
            <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 dark:border-gray-700 dark:bg-gray-800/60">
              <p className="text-xs text-gray-700 dark:text-gray-300 line-clamp-2 italic">
                <HighlightedText text={matchedUpdateSnippet} searchQuery={searchQuery} />
              </p>
            </div>
          ) : latestUpdate && (
            <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 line-clamp-1 italic">
              <HighlightedText text={latestUpdate.text} searchQuery={searchQuery} />
            </p>
          )}

          {prayer.answerText && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-green-50 dark:bg-green-950/40 px-3 py-2">
              <CheckCircleIcon className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
              <p className="text-xs text-green-800 dark:text-green-200 line-clamp-2 leading-relaxed">
                <HighlightedText text={prayer.answerText} searchQuery={searchQuery} />
              </p>
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400 dark:text-gray-500">
            <span className="flex items-center gap-1">
              <ClockIcon className="h-3 w-3" />
              {new Date(prayer.updatedAt).toLocaleDateString()}
            </span>
            {prayer.updates.length > 0 && (
              <span>{t('prayer.updates_count', { count: prayer.updates.length })}</span>
            )}
            {prayer.answeredAt && (
              <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                <CheckCircleIcon className="h-3 w-3" />
                {new Date(prayer.answeredAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </Link>

        {/* Actions */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => { setMenuOpen(!menuOpen); setConfirming(false); }}
            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
            aria-label="Actions"
          >
            <EllipsisVerticalIcon className="h-4 w-4" />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => { setMenuOpen(false); setConfirming(false); }} />
              <div className="absolute right-0 top-7 z-20 min-w-max bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1">
                <button
                  onClick={() => { onAddUpdate(prayer.id); setMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <PlusIcon className="h-4 w-4 shrink-0" />
                  {t('prayer.actions.addUpdate')}
                </button>
                {isActive ? (
                  <>
                    <button
                      onClick={() => { onSetStatus(prayer.id, 'answered'); setMenuOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                    >
                      <CheckCircleIcon className="h-4 w-4 shrink-0 text-green-500" />
                      {t('prayer.actions.markAnswered')}
                    </button>
                    <button
                      onClick={() => { onSetStatus(prayer.id, 'not_answered'); setMenuOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                    >
                      <XCircleIcon className="h-4 w-4 shrink-0 text-gray-400" />
                      {t('prayer.actions.markNotAnswered')}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { onSetStatus(prayer.id, 'active'); setMenuOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                  >
                    <ClockIcon className="h-4 w-4 shrink-0 text-blue-500" />
                    {t('prayer.actions.markActive')}
                  </button>
                )}
                <button
                  onClick={() => { onEdit(prayer); setMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap"
                >
                  <PencilIcon className="h-4 w-4 shrink-0" />
                  {t('prayer.actions.edit')}
                </button>
                <button
                  onClick={handleDelete}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap ${confirming ? 'text-red-600 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
                >
                  <TrashIcon className="h-4 w-4 shrink-0" />
                  {confirming ? t('prayer.delete.confirm_button') + '?' : t('prayer.actions.delete')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
