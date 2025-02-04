"use client";

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSermon } from '@services/api.service';
import { auth } from '@services/firebaseAuth.service';
import { Sermon } from '@/models/models';

export default function AddSermonModal() {
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
    const newSermon = {
      title,
      verse,
      date: new Date().toISOString(),
      thoughts: [],
      userId: user.uid
    };

    try {
      // Call createSermon in the service
      await createSermon(newSermon as Omit<Sermon, 'id'>);
      // Optionally, refresh the list of sermons (using Next.js router refresh)
      router.refresh();
    } catch (error) {
      console.error('Error creating sermon:', error);
    }
    
    // Reset the form and close the modal
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
        <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" 
          viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
        Новая проповедь
      </button>

      {open && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px]">
            <h2 className="text-2xl font-bold mb-6">Новая проповедь</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                  Тема
                </label>
                <input 
                  type="text" 
                  id="title" 
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Введите тему проповеди"
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">Например:<br />"Сила веры в испытаниях"</p>
              </div>
              <div className="mb-6">
                <label htmlFor="verse" className="block text-sm font-medium text-gray-700">
                  Стих из Писания
                </label>
                <textarea 
                  id="verse"
                  value={verse}
                  onChange={e => setVerse(e.target.value)}
                  placeholder="Введите стих из Писания"
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Например:<br />
                  Еф 1:15: "Посему и я, услышав о вашей вере во Христа Иисуса и о любви ко всем святым"
                </p>
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => setOpen(false)}
                  className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400"
                >
                  Отмена
                </button>
                <button 
                  type="submit" 
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
} 