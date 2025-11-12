"use client";

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Series } from '@/models/models';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';
import { useAuth } from '@/providers/AuthProvider';

interface EditSeriesModalProps {
  series: Series;
  onClose: () => void;
  onUpdate: (seriesId: string, updates: Partial<Series>) => Promise<void>;
}

export default function EditSeriesModal({ series, onClose, onUpdate }: EditSeriesModalProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [title, setTitle] = useState(series.title);
  const [description, setDescription] = useState(series.description || '');
  const [bookOrTopic, setBookOrTopic] = useState(series.bookOrTopic);
  const [color, setColor] = useState(series.color || '#3B82F6');
  const [status, setStatus] = useState(series.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    try {
      setSaving(true);
      await onUpdate(series.id, {
        title: title!.trim(),
        theme: title!.trim(), // Use title as theme for simplicity
        description: description.trim() || undefined,
        bookOrTopic: bookOrTopic.trim(),
        color: color || undefined,
        status
      });

      onClose();
    } catch (error) {
      console.error('Failed to update series:', error);
      setError('Failed to update series. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const clearError = () => setError(null);

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

  const statusOptions = [
    { value: 'draft', label: t('workspaces.series.form.statuses.draft') },
    { value: 'active', label: t('workspaces.series.form.statuses.active') },
    { value: 'completed', label: t('workspaces.series.form.statuses.completed') }
  ];

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg mx-4 rounded-lg bg-white p-6 shadow-xl dark:bg-gray-800 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {t('workspaces.series.editSeries')}
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

          {/* Status */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t('workspaces.series.form.status')}
            </label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as Series['status'])}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
            </div>
          </div>

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
              {saving ? 'Saving...' : t('workspaces.series.actions.saveChanges')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
