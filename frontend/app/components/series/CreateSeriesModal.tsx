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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.newSeries')}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-lg bg-red-50 p-3 dark:bg-red-950/50">
            <p className="text-sm text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('workspaces.series.form.title')} *
            </label>
            <TextareaAutosize
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                clearError();
              }}
              placeholder={t('workspaces.series.form.titlePlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white resize-none"
              minRows={1}
              maxRows={3}
              required
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('workspaces.series.form.description')}
            </label>
            <TextareaAutosize
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                clearError();
              }}
              placeholder={t('workspaces.series.form.descriptionPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white resize-none"
              minRows={2}
              maxRows={4}
            />
          </div>

          {/* Book/Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('workspaces.series.form.bookOrTopic')} *
            </label>
            <input
              type="text"
              value={bookOrTopic}
              onChange={(e) => {
                setBookOrTopic(e.target.value);
                clearError();
              }}
              placeholder={t('workspaces.series.form.bookOrTopicPlaceholder')}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
              required
            />
          </div>

          {/* Color Picker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('workspaces.series.form.color')}
            </label>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((colorOption) => (
                <button
                  key={colorOption}
                  type="button"
                  onClick={() => setColor(colorOption)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${
                    color === colorOption
                      ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-600/20 dark:ring-blue-400/20 scale-110'
                      : 'border-gray-300 opacity-60 hover:opacity-80'
                  }`}
                  style={{ backgroundColor: colorOption }}
                  title={colorOption}
                />
              ))}

              {/* Custom Color Picker Button */}
              <button
                type="button"
                onClick={() => setIsColorPickerOpen(true)}
                className={`w-8 h-8 rounded-full border-2 transition-all cursor-pointer relative overflow-hidden ${
                  !colorOptions.includes(color)
                    ? 'border-blue-600 dark:border-blue-400 ring-2 ring-blue-600/20 dark:ring-blue-400/20 scale-110'
                    : 'border-gray-300 opacity-60 hover:opacity-100'
                }`}
                style={{
                  background: colorOptions.includes(color)
                    ? 'conic-gradient(from 0deg, #FF0000 0%, #FFFF00 60deg, #00FF00 120deg, #00FFFF 180deg, #0000FF 240deg, #FF00FF 300deg, #FF0000 360deg)'
                    : color
                }}
                title="Custom color"
              >
                {/* Plus icon overlay when showing rainbow gradient */}
                {colorOptions.includes(color) && (
                  <div className="absolute inset-0 flex items-center justify-center bg-white/20 dark:bg-black/20">
                    <svg
                      className="w-4 h-4 text-white drop-shadow"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 4v16m8-8H4"
                      />
                    </svg>
                  </div>
                )}
              </button>
            </div>
          </div>

          {/* Initial Sermons Info */}
          {initialSermonIds.length > 0 && (
            <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-950/50">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                {initialSermonIds.length} sermon(s) will be added to this series
              </p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-700"
            >
              {t('workspaces.series.actions.cancel')}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-blue-500 px-4 py-2 text-white hover:bg-blue-600 disabled:opacity-50"
            >
              {saving ? 'Creating...' : t('workspaces.series.actions.createSeries')}
            </button>
          </div>
        </form>
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
