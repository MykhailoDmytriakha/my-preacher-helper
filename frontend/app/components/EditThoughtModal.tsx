"use client";

import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useScrollLock } from '@/hooks/useScrollLock';
import { SermonPoint, SermonOutline } from '@/models/models';
import { useConnection } from '@/providers/ConnectionProvider';
import { FocusRecorderButton } from "@components/FocusRecorderButton";
import { transcribeThoughtAudio } from "@services/thought.service";
import { resolveThoughtOutlineLocation } from "@utils/subPoints";
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag } from "@utils/tagUtils";

import { RichMarkdownEditor } from './ui/RichMarkdownEditor';
import "@locales/i18n";

interface EditThoughtModalProps {
  initialText: string;
  initialTags: string[];
  initialSermonPointId?: string;
  initialSubPointId?: string | null;
  allowedTags: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
  containerSection?: string;
  onSave: (updatedText: string, updatedTags: string[], outlinePointId?: string | null, subPointId?: string | null) => void;
  onClose: () => void;
  allowOffline?: boolean;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

type OutlineSectionKey = keyof Pick<SermonOutline, 'introduction' | 'main' | 'conclusion'>;

type SermonPointInfo = {
  id: string;
  text: string;
  section: string;
};

type AllowedTag = EditThoughtModalProps['allowedTags'][number];

const OUTLINE_SECTION_LABEL_KEYS: Record<OutlineSectionKey, string> = {
  introduction: 'outline.introduction',
  main: 'outline.mainPoints',
  conclusion: 'outline.conclusion',
};

const OUTLINE_SECTIONS_IN_ORDER: OutlineSectionKey[] = ['introduction', 'main', 'conclusion'];

const isOutlineSectionKey = (value: string | undefined): value is OutlineSectionKey =>
  value === 'introduction' || value === 'main' || value === 'conclusion';

const areStringArraysEqual = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const getTagDisplayName = (t: TranslateFn, tagName: string, translationKey?: string) => {
  if (translationKey) return t(translationKey);

  const canonical = normalizeStructureTag(tagName);
  if (canonical === 'intro') return t('tags.introduction');
  if (canonical === 'main') return t('tags.mainPart');
  if (canonical === 'conclusion') return t('tags.conclusion');

  return tagName;
};

const translateOrFallback = (
  t: TranslateFn,
  key: string,
  fallback: string,
  options?: Record<string, unknown>
) => {
  const translated = t(key, options);
  return translated === key ? fallback : translated;
};

const formatOutlinePlacementDetail = (
  t: TranslateFn,
  subPointText?: string | null,
) => {
  if (subPointText) {
    return translateOrFallback(
      t,
      'editThought.currentSubPoint',
      `Sub-point: ${subPointText}`,
      { subPoint: subPointText }
    );
  }

  return translateOrFallback(
    t,
    'editThought.directUnderOutlinePoint',
    'Directly under this outline point'
  );
};

const buildAllSermonPoints = (sermonOutline: SermonOutline | undefined, t: TranslateFn): SermonPointInfo[] => {
  if (!sermonOutline) return [];

  const points: SermonPointInfo[] = [];

  OUTLINE_SECTIONS_IN_ORDER.forEach((sectionKey) => {
    const sectionPoints = sermonOutline[sectionKey];
    if (!Array.isArray(sectionPoints)) return;

    const sectionLabel = t(OUTLINE_SECTION_LABEL_KEYS[sectionKey]);
    sectionPoints.forEach((point) => {
      points.push({ id: point.id, text: point.text, section: sectionLabel });
    });
  });

  return points;
};

const getFilteredSermonPoints = (
  sermonOutline: SermonOutline | undefined,
  containerSection: string | undefined
): Partial<Record<OutlineSectionKey, SermonPoint[]>> => {
  if (!sermonOutline) return {};

  if (isOutlineSectionKey(containerSection)) {
    const sectionPoints = sermonOutline[containerSection];
    if (!Array.isArray(sectionPoints)) return {};
    return { [containerSection]: sectionPoints };
  }

  return {
    introduction: Array.isArray(sermonOutline.introduction) ? sermonOutline.introduction : [],
    main: Array.isArray(sermonOutline.main) ? sermonOutline.main : [],
    conclusion: Array.isArray(sermonOutline.conclusion) ? sermonOutline.conclusion : [],
  };
};

const OutlinePointSelect = ({
  selectedSermonPointId,
  selectedSubPointId,
  onSelect,
  filteredSermonPoints,
  t,
  disabled = false,
}: {
  selectedSermonPointId: string | null | undefined;
  selectedSubPointId: string | null | undefined;
  onSelect: (outlinePointId: string | null, subPointId: string | null) => void;
  filteredSermonPoints: Partial<Record<OutlineSectionKey, SermonPoint[]>>;
  t: TranslateFn;
  disabled?: boolean;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Find selected point/sub-point for display
  const selectedPoint = selectedSermonPointId
    ? Object.values(filteredSermonPoints).flat().find((p) => p?.id === selectedSermonPointId)
    : null;
  const selectedSubPoint = selectedPoint?.subPoints?.find((sp) => sp.id === selectedSubPointId);

  // Build display label
  const displayLabel = selectedPoint
    ? selectedSubPoint
      ? `${selectedPoint.text} / ${selectedSubPoint.text}`
      : selectedPoint.text
    : t('editThought.noSermonPoint') || 'No outline point selected';

  const handleSelect = (outlinePointId: string | null, subPointId: string | null) => {
    if (disabled) return;
    onSelect(outlinePointId, subPointId);
    setIsOpen(false);
  };

  // Close on outside click
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="mb-2" ref={dropdownRef}>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        {t('editThought.outlinePointLabel') || 'SermonOutline Point'}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`w-full text-left p-2.5 border rounded-lg flex items-center justify-between gap-2 transition-colors ${
            selectedPoint
              ? 'border-blue-200 bg-blue-50/50 text-gray-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-gray-200'
              : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-blue-300 dark:hover:border-blue-700'}`}
        >
          <span className="truncate text-sm">{displayLabel}</span>
          <svg className={`w-4 h-4 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isOpen && (
          <div className="absolute z-50 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto">
            <button
              type="button"
              onClick={() => handleSelect(null, null)}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                !selectedSermonPointId
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/50 dark:text-blue-200'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {t('editThought.noSermonPoint')}
            </button>

            {Object.entries(filteredSermonPoints).map(([section, points]) =>
              points?.length ? (
                <div key={section}>
                  <div className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50">
                    {t(OUTLINE_SECTION_LABEL_KEYS[section as OutlineSectionKey]) || section}
                  </div>
                  {points.map((point) => (
                    <div key={point.id}>
                      <button
                        type="button"
                        onClick={() => handleSelect(point.id, null)}
                        className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                          selectedSermonPointId === point.id && !selectedSubPointId
                            ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/50 dark:text-blue-200'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }`}
                      >
                        {point.text}
                      </button>
                      {point.subPoints && point.subPoints.length > 0 && (
                        [...point.subPoints].sort((a, b) => a.position - b.position).map((sp) => (
                          <button
                            type="button"
                            key={sp.id}
                            onClick={() => handleSelect(point.id, sp.id)}
                            className={`w-full text-left pl-7 pr-3 py-1.5 text-sm transition-colors ${
                              selectedSermonPointId === point.id && selectedSubPointId === sp.id
                                ? 'bg-blue-50 text-blue-700 font-medium dark:bg-blue-900/50 dark:text-blue-200'
                                : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                            }`}
                          >
                            <span className="inline-flex items-center gap-1.5">
                              <span className="w-1 h-1 rounded-full bg-gray-400 dark:bg-gray-500 flex-shrink-0" />
                              {sp.text}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              ) : null
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const TagPill = ({
  label,
  ariaLabel,
  onClick,
  className,
  style,
  iconHtml,
  iconClassName,
  trailing,
}: {
  label: string;
  ariaLabel: string;
  onClick: () => void;
  className: string;
  style: React.CSSProperties;
  iconHtml: string | null;
  iconClassName: string | null;
  trailing?: React.ReactNode;
}) => (
  <div
    onClick={onClick}
    className={className}
    style={style}
    role="button"
    aria-label={ariaLabel}
  >
    {iconHtml && iconClassName && (
      <span className={iconClassName} dangerouslySetInnerHTML={{ __html: iconHtml }} />
    )}
    <span>{label}</span>
    {trailing}
  </div>
);

const TagsSection = ({
  tags,
  allowedTags,
  availableTags,
  onRemoveTag,
  onAddTag,
  t,
  disabled = false,
}: {
  tags: string[];
  allowedTags: AllowedTag[];
  availableTags: AllowedTag[];
  onRemoveTag: (index: number) => void;
  onAddTag: (tagName: string) => void;
  t: TranslateFn;
  disabled?: boolean;
}) => (
  <div className="mb-4">
    <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('thought.tagsLabel')}</p>

    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag, idx) => {
        const tagInfo = allowedTags.find((t) => t.name === tag);
        const displayName = getTagDisplayName(t, tag, tagInfo?.translationKey);
        const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);
        const className = `${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${baseClassName}`;
        const iconInfo = isStructureTag(tag) ? getStructureIcon(tag) : null;

        return (
          <TagPill
            key={tag + idx}
            label={displayName}
            ariaLabel={`Remove tag ${displayName}`}
            onClick={disabled ? () => { } : () => onRemoveTag(idx)}
            className={className}
            style={style}
            iconHtml={iconInfo?.svg ?? null}
            iconClassName={iconInfo?.className ?? null}
            trailing={<span className="ml-1">×</span>}
          />
        );
      })}
    </div>

    <p className="text-xs text-gray-500 mt-2 mb-1">{t('editThought.availableTags')}</p>
    <div className="flex flex-wrap gap-1.5 overflow-x-hidden">
      {availableTags.map((tag) => {
        const displayName = getTagDisplayName(t, tag.name, tag.translationKey);
        const { className: baseClassName, style } = getTagStyle(tag.name, tag.color);
        const className = `${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${baseClassName}`;
        const iconInfo = isStructureTag(tag.name) ? getStructureIcon(tag.name) : null;

        return (
          <TagPill
            key={tag.name}
            label={displayName}
            ariaLabel={`Add tag ${displayName}`}
            onClick={disabled ? () => { } : () => onAddTag(tag.name)}
            className={className}
            style={style}
            iconHtml={iconInfo?.svg ?? null}
            iconClassName={iconInfo?.className ?? null}
          />
        );
      })}
    </div>
  </div>
);

export default function EditThoughtModal({
  initialText,
  initialTags,
  initialSermonPointId,
  initialSubPointId,
  allowedTags,
  sermonOutline,
  containerSection,
  onSave,
  onClose,
  allowOffline = false,
}: EditThoughtModalProps) {
  const { isOnline, isMagicAvailable } = useConnection();
  const isReadOnly = !isOnline && !allowOffline;
  const isDictationDisabled = !isMagicAvailable || isReadOnly;
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | null | undefined>(initialSermonPointId);
  const [selectedSubPointId, setSelectedSubPointId] = useState<string | null | undefined>(initialSubPointId);
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);

  useScrollLock(true);

  const [isDictating, setIsDictating] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const isChanged =
    text !== initialText ||
    !areStringArraysEqual(tags, initialTags) ||
    selectedSermonPointId !== initialSermonPointId ||
    (selectedSubPointId ?? null) !== (initialSubPointId ?? null);

  const handleAddTag = (tag: string) => {
    if (isReadOnly) return;
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (index: number) => {
    if (isReadOnly) return;
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (isReadOnly) return;
    setIsSubmitting(true);
    try {
      onSave(text, tags, selectedSermonPointId, selectedSubPointId ?? null);
      onClose();
    } catch (error) {
      console.error("Error saving thought:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDictationComplete = async (audioBlob: Blob) => {
    try {
      setIsDictating(true);
      const result = await transcribeThoughtAudio(audioBlob);
      const appendedText = result.polishedText.trim();
      if (!appendedText) {
        toast.error(t('errors.audioProcessing'));
        return;
      }

      setText((prev) => {
        const separator = prev ? "\n\n" : "";
        return `${prev}${separator}${appendedText}`;
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.audioProcessing');
      toast.error(message);
    } finally {
      setIsDictating(false);
    }
  };

  const filteredSermonPoints = getFilteredSermonPoints(sermonOutline, containerSection);

  const availableTags = allowedTags.filter(allowedTag =>
    !tags.some(selectedTag => {
      if (allowedTag.name === selectedTag) return true;
      const normAllowed = normalizeStructureTag(allowedTag.name);
      const normSelected = normalizeStructureTag(selectedTag);
      return normAllowed !== null && normAllowed === normSelected;
    })
  );

  const modalContent = (
    <div className="fixed inset-0 z-50">
      {/* Backdrop — only visible on desktop */}
      <div className="hidden sm:block absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

      {/* Mobile: full-screen scroll sheet */}
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className={
          "absolute inset-0 overflow-y-auto bg-white dark:bg-gray-800 " +
          "sm:bg-transparent sm:dark:bg-transparent " +
          "sm:inset-auto sm:relative sm:top-0 sm:left-0 sm:overflow-visible " +
          "sm:flex sm:items-center sm:justify-center sm:min-h-screen sm:p-4"
        }
      >
        <div
          className={
            "p-4 sm:p-8 w-full sm:max-w-[760px] sm:max-h-[90vh] sm:rounded-lg sm:shadow-lg " +
            "sm:flex sm:flex-col sm:overflow-hidden sm:my-6 sm:bg-white sm:dark:bg-gray-800"
          }
        >
          {/* Header */}
          <div ref={headerRef} className="flex justify-between items-center mb-4">
            <h2 className="text-xl sm:text-2xl font-bold">{t('editThought.editTitle')}</h2>
          </div>

          {/* Body: on desktop scroll inside; on mobile the outer div scrolls */}
          <div className="sm:flex-1 sm:overflow-y-auto sm:min-h-0 w-full flex flex-col gap-6">
            <div ref={metaRef} className="space-y-4">
              {sermonOutline && (
                <OutlinePointSelect
                  selectedSermonPointId={selectedSermonPointId}
                  selectedSubPointId={selectedSubPointId}
                  onSelect={(outlinePointId, subPointId) => {
                    setSelectedSermonPointId(outlinePointId);
                    setSelectedSubPointId(subPointId);
                  }}
                  filteredSermonPoints={filteredSermonPoints}
                  t={t}
                  disabled={isReadOnly}
                />
              )}

              <TagsSection
                tags={tags}
                allowedTags={allowedTags}
                availableTags={availableTags}
                onRemoveTag={handleRemoveTag}
                onAddTag={handleAddTag}
                t={t}
                disabled={isReadOnly}
              />
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 min-h-[48px]">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('editThought.textLabel')}</label>
                <div className={`flex items-center gap-2 transition-opacity duration-300 ${isDictationDisabled ? 'opacity-40 grayscale pointer-events-none' : ''}`}>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {t('editThought.appendDictation')}
                  </span>
                  <div className="relative flex items-center justify-center w-12 h-12 flex-shrink-0">
                    <FocusRecorderButton
                      size="small"
                      onRecordingComplete={handleDictationComplete}
                      isProcessing={isDictating}
                      disabled={isSubmitting || isDictationDisabled}
                      onError={(errorMessage: string) => {
                        toast.error(errorMessage);
                        setIsDictating(false);
                      }}
                    />
                  </div>
                </div>
              </div>

              {isReadOnly ? (
                <div className="p-3 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-700 rounded-md prose prose-sm desktop:prose-base dark:prose-invert max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-gray-700 dark:text-gray-300">{text}</pre>
                </div>
              ) : (
                <RichMarkdownEditor
                  value={text}
                  onChange={setText}
                  placeholder={t('manualThought.placeholder')}
                />
              )}
            </div>
          </div>

          {/* Footer */}
          <div ref={footerRef} className="flex justify-end gap-3 mt-4 pb-6 sm:pb-0 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200 rounded-md hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 disabled:hover:bg-gray-200 transition-colors"
              disabled={isSubmitting}
            >
              {t('buttons.cancel')}
            </button>
            <button
              type="button"
              disabled={!isChanged || isSubmitting || isReadOnly}
              onClick={handleSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
            >
              {isSubmitting ? t('buttons.saving') : t('buttons.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
