"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSermon } from '@services/sermon.service';
import { auth } from '@services/firebaseAuth.service';
import { Sermon } from '@/models/models';
import { PlusIcon } from "@components/Icons";
import { useTranslation } from 'react-i18next';

interface AddSermonModalProps {
  onNewSermonCreated?: (newSermon: Sermon) => void;
}

export default function AddSermonModal({ onNewSermonCreated }: AddSermonModalProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [verse, setVerse] = useState('');
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
      userId: user.uid
    };

    try {
      const createdSermon = await createSermon(newSermon as Omit<Sermon, 'id'>);
      if (onNewSermonCreated) {
        onNewSermonCreated(createdSermon);
      }
      router.refresh();
    } catch (error) {
      console.error('Error creating sermon:', error);
    }
    
    setTitle('');
    setVerse('');
    setOpen(false);

  };

  return (
    <>
      <button 
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2"
        aria-label="Add new sermon"
      >
        <PlusIcon className="w-5 h-5" />
        {t('addSermon.newSermon')}
      </button>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px]">
            <h2 className="text-2xl font-bold mb-6">{t('addSermon.newSermon')}</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label htmlFor="title" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t('addSermon.titleLabel')}
                </label>
                <input 
                  type="text" 
                  id="title" 
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={t('addSermon.titlePlaceholder')}
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('addSermon.titleExample')}
                </p>
              </div>
              <div className="mb-6">
                <label htmlFor="verse" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  {t('addSermon.verseLabel')}
                </label>
                <textarea 
                  id="verse"
                  value={verse}
                  onChange={e => setVerse(e.target.value)}
                  placeholder={t('addSermon.versePlaceholder')}
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 dark:bg-gray-700 dark:text-white"
                  required
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('addSermon.verseExample')}
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setOpen(false)}
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
      )}
    </>
  );
}
