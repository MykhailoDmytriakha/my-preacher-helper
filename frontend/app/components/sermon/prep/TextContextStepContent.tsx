'use client';

import React, { useMemo, useState } from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { BookOpen, CheckCircle, Search, Repeat, Check, X } from 'lucide-react';

interface TextContextStepContentProps {
  initialVerse: string;
  onSaveVerse: (nextVerse: string) => Promise<void> | void;
  readWholeBookOnceConfirmed?: boolean;
  onToggleReadWholeBookOnce?: (checked: boolean) => Promise<void> | void;
  initialContextNotes?: string;
  onSaveContextNotes?: (notes: string) => Promise<void> | void;
  initialRepeatedWords?: string[];
  onSaveRepeatedWords?: (words: string[]) => Promise<void> | void;
}

const TextContextStepContent: React.FC<TextContextStepContentProps> = ({ initialVerse, onSaveVerse, readWholeBookOnceConfirmed = false, onToggleReadWholeBookOnce, initialContextNotes = '', onSaveContextNotes, initialRepeatedWords = [], onSaveRepeatedWords }) => {
  const { t } = useTranslation();
  const [verseDraft, setVerseDraft] = useState<string>(initialVerse || '');
  const [isSaving, setIsSaving] = useState(false);
  const [contextDraft, setContextDraft] = useState<string>(initialContextNotes || '');
  const [isSavingContext, setIsSavingContext] = useState(false);
  const [repeatedDraft, setRepeatedDraft] = useState<string>((initialRepeatedWords || []).join(', '));
  const [isSavingRepeated, setIsSavingRepeated] = useState(false);
  const [initialVerseMemo] = useState<string>(initialVerse || '');

  // keep input in sync when sermon verse changes outside
  React.useEffect(() => {
    setVerseDraft(initialVerse || '');
  }, [initialVerse]);
  React.useEffect(() => {
    setContextDraft(initialContextNotes || '');
  }, [initialContextNotes]);
  React.useEffect(() => {
    setRepeatedDraft((initialRepeatedWords || []).join(', '));
  }, [initialRepeatedWords]);

  const canSave = useMemo(() => verseDraft.trim().length > 0 && verseDraft.trim() !== (initialVerse || '').trim(), [verseDraft, initialVerse]);
  const verseHasChanges = canSave;
  const contextHasChanges = useMemo(() => (initialContextNotes || '') !== contextDraft, [initialContextNotes, contextDraft]);
  const repeatedHasChanges = useMemo(() => (initialRepeatedWords || []).join(', ') !== repeatedDraft, [initialRepeatedWords, repeatedDraft]);

  const handleSave = async () => {
    if (!canSave) return;
    try {
      setIsSaving(true);
      await onSaveVerse(verseDraft.trim());
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveContext = async () => {
    if (!onSaveContextNotes) return;
    try {
      setIsSavingContext(true);
      await onSaveContextNotes(contextDraft);
    } finally {
      setIsSavingContext(false);
    }
  };

  const handleSaveRepeated = async () => {
    if (!onSaveRepeatedWords) return;
    try {
      setIsSavingRepeated(true);
      const words = repeatedDraft
        .split(',')
        .map(w => w.trim())
        .filter(Boolean);
      await onSaveRepeatedWords(words);
    } finally {
      setIsSavingRepeated(false);
    }
  };

  return (
    <div id="step-textcontext-panel" className="space-y-3">
      {/* Section 1: Select passage */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.selectPassage')}</h4>
        </div>
        <label htmlFor="passage-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.passageInput.label')}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="passage-input"
            type="text"
            value={verseDraft}
            onChange={(e) => setVerseDraft(e.target.value)}
            placeholder={t('wizard.steps.textContext.passageInput.placeholder') || ''}
            className={`flex-1 rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
          />
          {verseHasChanges ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={`inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                title={t('actions.save') || 'Save'}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setVerseDraft(initialVerseMemo)}
                className={`inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('actions.cancel') || 'Cancel'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.passageInput.help')}</p>
      </div>

      {/* Section 2: Read whole book once */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <CheckCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.readWholeBookOnce')}</h4>
        </div>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={Boolean(readWholeBookOnceConfirmed)}
            onChange={(e) => onToggleReadWholeBookOnce?.(e.target.checked)}
          />
          <span className="text-sm">{t('wizard.steps.textContext.confirmation.readWholeBookOnce')}</span>
        </label>
      </div>

      {/* Section 3: Find context */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Search className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.findContext')}</h4>
        </div>
        <label htmlFor="context-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.contextInput.label')}
        </label>
        <textarea
          id="context-input"
          rows={4}
          value={contextDraft}
          onChange={(e) => setContextDraft(e.target.value)}
          placeholder={t('wizard.steps.textContext.contextInput.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-gray-500">{t('wizard.steps.textContext.contextInput.help')}</p>
          {onSaveContextNotes && contextHasChanges && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveContext}
                disabled={isSavingContext}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                title={t('actions.save') || 'Save'}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setContextDraft(initialContextNotes || '')}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('actions.cancel') || 'Cancel'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Repeated words */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Repeat className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.textContext.actions.findRepeatedWords')}</h4>
        </div>
        <label htmlFor="repeated-input" className="block text-sm font-medium mb-2">
          {t('wizard.steps.textContext.repeatedInput.label')}
        </label>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="repeated-input"
            type="text"
            value={repeatedDraft}
            onChange={(e) => setRepeatedDraft(e.target.value)}
            placeholder={t('wizard.steps.textContext.repeatedInput.placeholder') || ''}
            className={`flex-1 rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
          />
          {onSaveRepeatedWords && repeatedHasChanges && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveRepeated}
                disabled={isSavingRepeated}
                className={`inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                title={t('actions.save') || 'Save'}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setRepeatedDraft((initialRepeatedWords || []).join(', '))}
                className={`inline-flex items-center justify-center px-3 py-2 rounded-md text-sm font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('actions.cancel') || 'Cancel'}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-500">{t('wizard.steps.textContext.repeatedInput.help')}</p>
      </div>
    </div>
  );
};

export default TextContextStepContent;


