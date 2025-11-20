"use client";

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Series } from '@/models/models';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { useAuth } from '@/providers/AuthProvider';
import ColorPickerModal from '@/components/ColorPickerModal';

interface CreateSeriesModalProps {
  onClose: () => void;
  onCreate: (series: Omit<Series, 'id'>) => Promise<void>;
  initialSermonIds?: string[]; // For multi-select flow
}

export default function CreateSeriesModal({ onClose, onCreate, initialSermonIds = [] }: CreateSeriesModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bookOrTopic, setBookOrTopic] = useState('');
  const [color, setColor] = useState('#3B82F6'); // Default blue
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isColorPickerOpen, setIsColorPickerOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setSaving(true);
      await onCreate({
        title: title.trim(),
        theme: title.trim(), // Use title as theme for simplicity
        description: description.trim() || undefined,
        bookOrTopic: bookOrTopic.trim(),
        color: color || undefined,
        status: 'draft',
        sermonIds: initialSermonIds,
        userId: user?.uid || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      onClose();
    } catch (error) {
      console.error('Failed to create series:', error);
      setError('Failed to create series. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const clearError = () => setError(null);

  const handleColorSelect = (newColor: string) => {
    setColor(newColor);
    setIsColorPickerOpen(false);
  };

  const handleCancelColorSelect = () => {
    setIsColorPickerOpen(false);
  };

  const colorOptions = [
    '#3B82F6', // Blue
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#6B7280', // Gray
    '#000000'  // Black
  ];

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-gray-200/70 bg-white shadow-2xl ring-1 ring-gray-100/80 dark:border-gray-800 dark:bg-gray-900 dark:ring-gray-800">
        <div className="h-1 w-full bg-gradient-to-r from-blue-600 via-indigo-600 to-sky-500" />
        <div className="p-6 sm:p-7 max-h-[85vh] overflow-y-auto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-900/30 dark:text-blue-100 dark:ring-blue-800/60">
                {t('workspaces.series.newSeries')}
              </p>
              <h2 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
                {t('workspaces.series.description')}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Создайте серию, дайте ей яркое имя и тему, выберите оттенок для визуального кода.
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              <XMarkIcon className="h-6 w-6" />
            </button>
          </div>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200/80 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {t('workspaces.series.form.title')} *
                </span>
                <TextareaAutosize
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearError();
                  }}
                  placeholder={t('workspaces.series.form.titlePlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                  minRows={1}
                  maxRows={3}
                  required
                />
              </label>

              <label className="space-y-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {t('workspaces.series.form.bookOrTopic')} *
                </span>
                <input
                  type="text"
                  value={bookOrTopic}
                  onChange={(e) => {
                    setBookOrTopic(e.target.value);
                    clearError();
                  }}
                  placeholder={t('workspaces.series.form.bookOrTopicPlaceholder')}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                  required
                />
              </label>
            </div>

            <label className="block space-y-2">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('workspaces.series.form.description')}
              </span>
              <TextareaAutosize
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError();
                }}
                placeholder={t('workspaces.series.form.descriptionPlaceholder')}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-transparent transition focus:border-blue-400 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:border-blue-500 dark:focus:ring-blue-900/40"
                minRows={3}
                maxRows={5}
              />
            </label>

            <div className="space-y-3">
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {t('workspaces.series.form.color')}
              </span>
              <div className="flex flex-wrap gap-2">
                {colorOptions.map((colorOption) => (
                  <button
                    key={colorOption}
                    type="button"
                    onClick={() => setColor(colorOption)}
                    className={`h-9 w-9 rounded-full border-2 transition-all ${
                      color === colorOption
                        ? 'border-blue-600 ring-2 ring-blue-600/20 dark:border-blue-400 dark:ring-blue-400/30 scale-110'
                        : 'border-gray-200 hover:scale-105 dark:border-gray-700'
                    }`}
                    style={{ backgroundColor: colorOption }}
                    title={colorOption}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setIsColorPickerOpen(true)}
                  className={`flex h-9 w-9 items-center justify-center rounded-full border-2 bg-gradient-to-br from-indigo-500 via-pink-500 to-amber-400 text-white shadow-sm transition hover:scale-105 ${
                    !colorOptions.includes(color) ? 'ring-2 ring-white/60 dark:ring-gray-900' : ''
                  }`}
                  title="Custom color"
                >
                  +
                </button>
              </div>
            </div>

            {initialSermonIds.length > 0 && (
              <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-100">
                {initialSermonIds.length} sermon(s) will be added to this series
              </div>
            )}

            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {t('workspaces.series.actions.cancel')}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? 'Creating...' : t('workspaces.series.actions.createSeries')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(
    <>
      {modalContent}

      {/* Color Picker Modal */}
      {isColorPickerOpen && (
        <ColorPickerModal
          tagName={t('workspaces.series.newSeries')}
          initialColor={color}
          onOk={handleColorSelect}
          onCancel={handleCancelColorSelect}
        />
      )}
    </>,
    document.body
  );
}
