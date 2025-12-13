"use client";

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import TextareaAutosize from 'react-textarea-autosize';

import { SermonPoint, SermonOutline } from '@/models/models';
import "@locales/i18n";
import { isStructureTag, getStructureIcon, getTagStyle, normalizeStructureTag } from "@utils/tagUtils";

interface EditThoughtModalProps {
  initialText: string;
  initialTags: string[];
  initialSermonPointId?: string;
  allowedTags: { name: string; color: string; translationKey?: string }[];
  sermonOutline?: SermonOutline;
  containerSection?: string;
  onSave: (updatedText: string, updatedTags: string[], outlinePointId?: string) => void;
  onClose: () => void;
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
  onChange,
  filteredSermonPoints,
  selectedPointInfo,
  t,
}: {
  selectedSermonPointId: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  filteredSermonPoints: Partial<Record<OutlineSectionKey, SermonPoint[]>>;
  selectedPointInfo: SermonPointInfo | undefined;
  t: TranslateFn;
}) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
      {t('editThought.outlinePointLabel') || 'SermonOutline Point'}
    </label>
    <select
      value={selectedSermonPointId || ""}
      onChange={onChange}
      className="w-full p-2 border rounded dark:bg-gray-700 dark:text-gray-200"
    >
      <option value="">{t('editThought.noSermonPoint') || 'No outline point selected'}</option>

      {/* Group outline points by section */}
      {Object.entries(filteredSermonPoints).map(([section, points]) =>
        points?.length ? (
          <optgroup
            key={section}
            label={t(OUTLINE_SECTION_LABEL_KEYS[section as OutlineSectionKey]) || section}
          >
            {points.map((point) => (
              <option key={point.id} value={point.id}>
                {point.text}
              </option>
            ))}
          </optgroup>
        ) : null
      )}
    </select>

    {selectedPointInfo && (
      <p className="mt-1 text-sm text-gray-500">
        {t('editThought.selectedSermonPoint', { section: selectedPointInfo.section }) ||
          `Selected outline point from ${selectedPointInfo.section}`}
      </p>
    )}
  </div>
);

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
}: {
  tags: string[];
  allowedTags: AllowedTag[];
  availableTags: AllowedTag[];
  onRemoveTag: (index: number) => void;
  onAddTag: (tagName: string) => void;
  t: TranslateFn;
}) => (
  <div className="mb-4">
    <p className="font-medium text-sm text-gray-700 dark:text-gray-300 mb-2">{t('thought.tagsLabel')}</p>

    <div className="flex flex-wrap gap-1.5 max-h-[20vh] overflow-auto overflow-x-hidden">
      {tags.map((tag, idx) => {
        const tagInfo = allowedTags.find((t) => t.name === tag);
        const displayName = getTagDisplayName(t, tag, tagInfo?.translationKey);
        const { className: baseClassName, style } = getTagStyle(tag, tagInfo?.color);
        const className = `cursor-pointer ${baseClassName}`;
        const iconInfo = isStructureTag(tag) ? getStructureIcon(tag) : null;

        return (
          <TagPill
            key={tag + idx}
            label={displayName}
            ariaLabel={`Remove tag ${displayName}`}
            onClick={() => onRemoveTag(idx)}
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
        const className = `cursor-pointer ${baseClassName}`;
        const iconInfo = isStructureTag(tag.name) ? getStructureIcon(tag.name) : null;

        return (
          <TagPill
            key={tag.name}
            label={displayName}
            ariaLabel={`Add tag ${displayName}`}
            onClick={() => onAddTag(tag.name)}
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
  allowedTags, 
  sermonOutline,
  containerSection,
  onSave, 
  onClose 
}: EditThoughtModalProps) {
  const [text, setText] = useState(initialText);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [selectedSermonPointId, setSelectedSermonPointId] = useState<string | undefined>(initialSermonPointId);
  const { t } = useTranslation();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isChanged =
    text !== initialText ||
    !areStringArraysEqual(tags, initialTags) ||
    selectedSermonPointId !== initialSermonPointId;

  const handleAddTag = (tag: string) => {
    if (!tags.includes(tag)) {
      setTags([...tags, tag]);
    }
  };

  const handleRemoveTag = (index: number) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleSermonPointChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedSermonPointId(value === "" ? undefined : value);
  };

  const handleSave = () => {
    setIsSubmitting(true);
    try {
      onSave(text, tags, selectedSermonPointId);
      onClose();
    } catch (error) {
      console.error("Error saving thought:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const allSermonPoints = buildAllSermonPoints(sermonOutline, t);

  // Find the selected outline point text for display
  const selectedPointInfo = allSermonPoints.find(point => point.id === selectedSermonPointId);

  // Determine which outline points to show based on containerSection
  const filteredSermonPoints = getFilteredSermonPoints(sermonOutline, containerSection);

  const availableTags = allowedTags.filter(t => !tags.includes(t.name));

  const modalContent = (
    <div onClick={(e) => e.stopPropagation()} className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50 p-4">
      <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 sm:p-8 w-full max-w-[600px] max-h-[85vh] my-8 flex flex-col overflow-hidden">
        <h2 className="text-xl sm:text-2xl font-bold mb-4 sm:mb-6">{t('editThought.editTitle')}</h2>
        <div className="mb-4 flex-grow overflow-auto">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('editThought.textLabel')}</label>
          <TextareaAutosize
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="mt-1 block w-full border border-gray-300 dark:border-gray-700 rounded-md p-3 resize-none dark:bg-gray-700 dark:text-white"
            minRows={3}
            maxRows={16}
          />
	        </div>

	        {sermonOutline && (
	          <OutlinePointSelect
	            selectedSermonPointId={selectedSermonPointId}
	            onChange={handleSermonPointChange}
	            filteredSermonPoints={filteredSermonPoints}
	            selectedPointInfo={selectedPointInfo}
	            t={t}
	          />
	        )}

	        <TagsSection
	          tags={tags}
	          allowedTags={allowedTags}
	          availableTags={availableTags}
	          onRemoveTag={handleRemoveTag}
	          onAddTag={handleAddTag}
	          t={t}
	        />
	        <div className="flex justify-end gap-3 mt-auto">
	          <button 
	            type="button" 
	            onClick={onClose} 
            className="px-4 py-2 bg-gray-300 rounded-md hover:bg-gray-400 disabled:opacity-50 disabled:hover:bg-gray-300 transition-colors"
            disabled={isSubmitting}
          >
            {t('buttons.cancel')}
          </button>
          <button 
            type="button" 
            disabled={!isChanged || isSubmitting} 
            onClick={handleSave} 
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors"
          >
            {isSubmitting ? t('buttons.saving') : t('buttons.save')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
} 
