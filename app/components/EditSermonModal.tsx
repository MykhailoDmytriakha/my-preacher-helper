"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Sermon } from '@/models/models';

interface EditSermonModalProps {
  sermon: Sermon;
  onClose: () => void;
  onUpdate: (updatedSermon: Sermon) => void;
}

export default function EditSermonModal({ sermon, onClose, onUpdate }: EditSermonModalProps) {
  const [title, setTitle] = useState(sermon.title);
  const [verse, setVerse] = useState(sermon.verse);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  // При монтировании устанавливаем флаг, чтобы использовать портал
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const updatedData = { title, verse };

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:3000'}/api/sermons/${sermon.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatedData),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update sermon');
      }

      const data = await response.json();
      const updatedSermon = { ...sermon, ...updatedData };
      onUpdate(updatedSermon);
      onClose();
    } catch (error) {
      console.error("Error updating sermon:", error);
      alert("Ошибка обновления проповеди");
    } finally {
      setIsSubmitting(false);
    }
  };

  const modalContent = (
    // Останавливаем всплытие кликов, чтобы они не доходили до родительских элементов
    <div
      onClick={(e) => e.stopPropagation()}
      className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px]"
      >
        <h2 className="text-2xl font-bold mb-6">Редактировать проповедь</h2>
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
          </div>
          <div className="flex justify-end gap-3">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400"
            >
              Отмена
            </button>
            <button 
              type="submit" 
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              {isSubmitting ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  if (mounted) {
    return createPortal(modalContent, document.body);
  }
  return null;
}
