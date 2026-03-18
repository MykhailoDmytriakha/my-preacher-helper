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
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import AddUpdateModal from '@/components/prayer/AddUpdateModal';
import CreatePrayerModal from '@/components/prayer/CreatePrayerModal';
import MarkAnsweredModal from '@/components/prayer/MarkAnsweredModal';
import PrayerStatusBadge from '@/components/prayer/PrayerStatusBadge';
import { usePrayerRequests } from '@/hooks/usePrayerRequests';
import { PrayerRequest, PrayerStatus } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import '@locales/i18n';

export default function PrayerDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const { prayerRequests, loading, updatePrayer, deletePrayer, addUpdate, setStatus } =
    usePrayerRequests(user?.uid ?? null);

  const prayer = prayerRequests.find((p) => p.id === id);

  const [showEdit, setShowEdit] = useState(false);
  const [showAddUpdate, setShowAddUpdate] = useState(false);
  const [showMarkAnswered, setShowMarkAnswered] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    await updatePrayer(prayer.id, payload);
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
    await setStatus(prayer.id, 'answered', answerText);
    toast.success(t('prayer.toast.statusChanged'));
    setShowMarkAnswered(false);
  };

  const isActive = prayer.status === 'active';

  const sortedUpdates = [...prayer.updates].sort(
    (a, b) => b.createdAt.localeCompare(a.createdAt)
  );

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
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
            <p className="text-base font-semibold text-gray-900 dark:text-gray-100 leading-snug">
              {prayer.title}
            </p>
            {prayer.description && (
              <p className="text-sm text-gray-600 dark:text-gray-400">{prayer.description}</p>
            )}
            {prayer.tags && prayer.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {prayer.tags.map((tag) => (
                  <span key={tag} className="text-xs px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                    {tag}
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
              onClick={() => setShowEdit(true)}
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
        <div className="bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800/50 rounded-xl p-5">
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
              {prayer.answerText}
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
                className="bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg px-4 py-3"
              >
                <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{update.text}</p>
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
