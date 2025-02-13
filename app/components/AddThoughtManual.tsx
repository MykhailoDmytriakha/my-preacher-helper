"use client";

import React, { useState } from 'react';
import { Thought } from '@/models/models';
import { createManualThought } from '@services/thought.service';
import { PlusIcon } from '@components/Icons';

interface AddThoughtManualProps {
  sermonId: string;
  onNewThought: (thought: Thought) => void;
}

export default function AddThoughtManual({ sermonId, onNewThought }: AddThoughtManualProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newThought: Thought = {
      text,
      tags: [], // No tags by default; could extend functionality later
      relevant: true,
      date: new Date().toISOString()
    };

    try {
      const savedThought = await createManualThought(sermonId, newThought);
      onNewThought(savedThought);
      setText("");
      setOpen(false);
    } catch (error) {
      console.error("Error adding thought manually:", error);
      alert("Ошибка добавления записи");
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 mt-4"
      >
        <PlusIcon className="w-5 h-5" />
        Добавить запись вручную
      </button>
      {open && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 w-[600px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-2xl font-bold mb-6">Добавить запись вручную</h2>
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Введите вашу запись..."
                  className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3"
                  rows={3}
                  required
                />
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