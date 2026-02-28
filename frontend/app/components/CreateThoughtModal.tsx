"use client";

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useScrollLock } from '@/hooks/useScrollLock';
import { Thought, SermonOutline } from '@/models/models';
import { FocusRecorderButton } from '@components/FocusRecorderButton';
import { transcribeThoughtAudio } from '@services/thought.service';
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag } from '@utils/tagUtils';

import { RichMarkdownEditor } from './ui/RichMarkdownEditor';
import '@locales/i18n';


interface CreateThoughtModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateThought: (thought: Omit<Thought, 'id'>) => Promise<void> | void;
  allowedTags?: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
  disabled?: boolean;
}

export default function CreateThoughtModal({
  isOpen,
  onClose,
  onCreateThought,
  allowedTags = [],
  sermonOutline,
  disabled = false,
}: CreateThoughtModalProps) {
  const [text, setText] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const { t } = useTranslation();
  const isOnline = useOnlineStatus();

  useScrollLock(isOpen);

  const isDirty = text.trim().length > 0;

  const resetAndClose = () => {
    setText('');
    setTags([]);
    setSelectedSermonPointId(undefined);
    onClose();
  };

  const handleClose = () => {
    if (isDirty && !window.confirm(t('createThought.dirtyGuard'))) return;
    resetAndClose();
  };

  const handleDictationComplete = async (audioBlob: Blob) => {
    try {
      setIsDictating(true);
      const result = await transcribeThoughtAudio(audioBlob);
      const appended = result.polishedText.trim();
      if (!appended) {
        toast.error(t('errors.audioProcessing'));
        return;
      }
      setText((prev) => {
        const separator = prev ? '\n\n' : '';
        return `${prev}${separator}${appended}`;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.audioProcessing');
      toast.error(message);
    } finally {
      setIsDictating(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled || !isOnline) return;
    const trimmedText = text.trim();
    if (!trimmedText) return;

    const newThought: Omit<Thought, 'id'> = {
      text: trimmedText,
      tags,
      date: new Date().toISOString(),
      outlinePointId: selectedSermonPointId,
    };

    try {
      setIsSubmitting(true);
      await onCreateThought(newThought);
      toast.success(t('manualThought.addedSuccess'));
      resetAndClose();
    } catch (error) {
      console.error('Error creating thought:', error);
      toast.error(t('errors.addThoughtError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) setTags([...tags, tag]);
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const availableTags = allowedTags.filter((tag) => !tags.includes(tag.name));

  const allSermonPoints: { id: string; text: string; section: string }[] = [];
  if (sermonOutline) {
    (['introduction', 'main', 'conclusion'] as const).forEach((section) => {
      const points = sermonOutline[section];
      if (Array.isArray(points)) {
        const label = t(section === 'main' ? 'outline.mainPoints' : `outline.${section}`);
        points.forEach((p) => allSermonPoints.push({ id: p.id, text: p.text, section: label }));
      }
    });
  }
  const selectedPointInfo = allSermonPoints.find((p) => p.id === selectedSermonPointId);

  const getTagDisplayName = (tagName: string, translationKey?: string) => {
    if (translationKey) return t(translationKey);
    const canonical = normalizeStructureTag(tagName);
    if (canonical === 'intro') return t('tags.introduction');
    if (canonical === 'main') return t('tags.mainPart');
    if (canonical === 'conclusion') return t('tags.conclusion');
    return tagName;
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — only on desktop */}
      <div className="hidden sm:block absolute inset-0 bg-black bg-opacity-50" onClick={handleClose} />

      {/* Mobile: full-screen scroll sheet / Desktop: centered card */}
      <div
        className={
          "absolute inset-0 overflow-y-auto bg-white dark:bg-gray-800 " +
          "sm:bg-transparent sm:dark:bg-transparent " +
          "sm:inset-auto sm:relative sm:top-0 sm:left-0 sm:overflow-visible " +
          "sm:flex sm:items-center sm:justify-center sm:min-h-screen sm:p-4"
        }
        onClick={handleClose}
      >
        <div
          role="dialog"
          aria-modal="true"
          className={
            "p-4 sm:p-8 w-full sm:max-w-[600px] sm:max-h-[85vh] sm:rounded-lg sm:shadow-lg " +
            "sm:flex sm:flex-col sm:overflow-hidden sm:my-8 sm:bg-white sm:dark:bg-gray-800"
          }
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="space-y-3 mb-3">
            <h2 className="text-xl sm:text-2xl font-bold">{t('createThought.title')}</h2>
            <div className="flex flex-wrap items-center justify-between gap-3 min-h-[48px]">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {t('editThought.textLabel')}
              </label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {t('editThought.appendDictation')}
                </span>
                <div className="relative flex items-center justify-center w-12 h-12 flex-shrink-0">
                  <FocusRecorderButton
                    size="small"
                    onRecordingComplete={handleDictationComplete}
                    isProcessing={isDictating}
                    disabled={isSubmitting || !isOnline}
                    onError={(msg) => {
                      toast.error(msg);
                      setIsDictating(false);
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-grow sm:overflow-hidden">
            {/* Body: mobile scrolls via outer container; desktop scroll here */}
            <div className="sm:flex-grow sm:overflow-auto space-y-4">
              {!isOnline && (
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 border border-yellow-400 rounded-md">
                  <p className="text-sm text-yellow-800 dark:text-yellow-200">
                    {t('manualThought.offlineWarning')}
                  </p>
                </div>
              )}

              <RichMarkdownEditor
                value={text}
                onChange={setText}
                placeholder={t('manualThought.placeholder')}
              />

              {sermonOutline && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('editThought.outlinePointLabel')}
                  </label>
                  <select
                    value={selectedSermonPointId || ''}
                    onChange={(e) => setSelectedSermonPointId(e.target.value || undefined)}
                    className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200"
                    disabled={isSubmitting}
                  >
                    <option value="">{t('editThought.noSermonPoint')}</option>
                    {(['introduction', 'main', 'conclusion'] as const).map((section) => {
                      const points = sermonOutline[section];
                      if (!Array.isArray(points) || points.length === 0) return null;
                      const label = t(section === 'main' ? 'outline.mainPoints' : `outline.${section}`);
                      return (
                        <optgroup key={section} label={label}>
                          {points.map((p) => (
                            <option key={p.id} value={p.id}>{p.text}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                  {selectedPointInfo && (
                    <p className="mt-1 text-sm text-gray-500">
                      {t('editThought.selectedSermonPoint', { section: selectedPointInfo.section })}
                    </p>
                  )}
                </div>
              )}

              <div>
                <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">
                  {t('thought.tagsLabel')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag, idx) => {
                    const tagInfo = allowedTags.find((t) => t.name === tag);
                    const displayName = getTagDisplayName(tag, tagInfo?.translationKey);
                    const { className: base, style } = getTagStyle(tag, tagInfo?.color);
                    const iconInfo = isStructureTag(tag) ? getStructureIcon(tag) : null;
                    return (
                      <div
                        key={tag + idx}
                        onClick={() => handleRemoveTag(idx)}
                        className={`cursor-pointer ${base}`}
                        style={style}
                        role="button"
                        aria-label={`Remove tag ${displayName}`}
                      >
                        {iconInfo && (
                          <span className={iconInfo.className} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
                        )}
                        <span>{displayName}</span>
                        <span className="ml-1">×</span>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500 mt-2 mb-1">{t('editThought.availableTags')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {availableTags.map((tag) => {
                    const displayName = getTagDisplayName(tag.name, tag.translationKey);
                    const { className: base, style } = getTagStyle(tag.name, tag.color);
                    const iconInfo = isStructureTag(tag.name) ? getStructureIcon(tag.name) : null;
                    return (
                      <div
                        key={tag.name}
                        onClick={() => handleAddTag(tag.name)}
                        className={`cursor-pointer ${base}`}
                        style={style}
                        role="button"
                        aria-label={`Add tag ${displayName}`}
                      >
                        {iconInfo && (
                          <span className={iconInfo.className} dangerouslySetInnerHTML={{ __html: iconInfo.svg }} />
                        )}
                        <span>{displayName}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-4 pb-4 sm:pb-0">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-gray-300 dark:bg-gray-600 dark:text-white rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 disabled:opacity-50 transition-colors"
                disabled={isSubmitting}
              >
                {t('buttons.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
                disabled={isSubmitting || !text.trim() || !isOnline}
              >
                {isSubmitting ? t('buttons.saving') : t('buttons.save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
