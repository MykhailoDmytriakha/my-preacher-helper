"use client";

import { useRouter } from 'next/navigation';
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { useSeries } from '@/hooks/useSeries';
import { Sermon } from '@/models/models';
import { useAuth } from '@/providers/AuthProvider';
import { PlusIcon } from "@components/Icons";
import { auth } from '@services/firebaseAuth.service';
import { addSermonToSeries } from '@services/series.service';
import { createSermon } from '@services/sermon.service';

interface AddSermonModalProps {
  onNewSermonCreated?: (newSermon: Sermon) => void;
  preSelectedSeriesId?: string;
  isOpen?: boolean;
  onClose?: () => void;
  showTriggerButton?: boolean;
}

export default function AddSermonModal({
  onNewSermonCreated,
  preSelectedSeriesId,
  isOpen,
  onClose,
  showTriggerButton = true
}: AddSermonModalProps) {
  // showTriggerButton is used to conditionally render the trigger button
  const { t } = useTranslation();
  const { user } = useAuth();
  const { series } = useSeries(user?.uid || null);
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isOpen !== undefined ? isOpen : internalOpen;
  const handleClose = onClose || (() => setInternalOpen(false));
  const [title, setTitle] = useState('');
  const [verse, setVerse] = useState('');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>(preSelectedSeriesId || '');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      console.error("User is not authenticated");
      return;
    }
    const newSermon: Sermon = {
      id: '',
      title,
      verse,
      date: new Date().toISOString(),
      thoughts: [],
      userId: user.uid,
      seriesId: selectedSeriesId || undefined
    };

    try {
      const createdSermon = await createSermon(newSermon as Omit<Sermon, 'id'>);

      // If a series was selected, add the sermon to the series
      if (selectedSeriesId) {
        try {
          await addSermonToSeries(selectedSeriesId, createdSermon.id);
        } catch (seriesError) {
          console.error('Error adding sermon to series:', seriesError);
          // Don't fail the entire operation if series assignment fails
        }
      }

      if (onNewSermonCreated) {
        onNewSermonCreated(createdSermon);
      }
      router.refresh();
    } catch (error) {
      console.error('Error creating sermon:', error);
    }
    
    setTitle('');
    setVerse('');
    setSelectedSeriesId('');
    handleClose();

  };

  const modalContent = (
    <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-[110] p-4" onClick={handleClose}>
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-2xl font-bold mb-6">{t('addSermon.newSermon')}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.titleLabel')}
            </label>
            <TextareaAutosize 
              id="title" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={t('addSermon.titlePlaceholder')}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
              minRows={1}
              maxRows={6}
              required
            />
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('addSermon.titleExample')}
            </p>
          </div>
          <div className="mb-6 flex-grow overflow-auto">
            <label htmlFor="verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.verseLabel')}
            </label>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 350px)' }}>
              <TextareaAutosize 
                id="verse"
                value={verse}
                onChange={e => setVerse(e.target.value)}
                placeholder={t('addSermon.versePlaceholder')}
                className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white resize-none"
                minRows={3}
                maxRows={16}
                required
              />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              {t('addSermon.verseExample')}
            </p>
          </div>
          <div className="mb-6">
            <label htmlFor="series" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              {t('addSermon.seriesLabel')}
            </label>
            <select
              id="series"
              value={selectedSeriesId}
              onChange={(e) => setSelectedSeriesId(e.target.value)}
              className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
            >
              <option value="">{t('addSermon.noSeriesOption')}</option>
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.theme}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 mt-auto">
            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500"
            >
              {t('addSermon.cancel')}
            </button>
            <button 
              type="submit" 
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {t('addSermon.save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return (
    <>
      {showTriggerButton && (
        <button
          onClick={() => setInternalOpen(true)}
          className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
          aria-label="Add new sermon"
        >
          <PlusIcon className="w-5 h-5" />
          {t('addSermon.newSermon')}
        </button>
      )}

      {open && createPortal(modalContent, document.body)}
    </>
  );
}
