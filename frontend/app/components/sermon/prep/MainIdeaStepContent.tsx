'use client';

import { Lightbulb, BookText, ListChecks, Check, X } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';

// Module-level constants to avoid duplicate strings
const MAIN_IDEA_SAVE_FALLBACK = "Save";
const MAIN_IDEA_CANCEL_FALLBACK = "Cancel";

interface MainIdeaStepContentProps {
  initialContextIdea?: string;
  onSaveContextIdea?: (text: string) => Promise<void> | void;
  initialTextIdea?: string;
  onSaveTextIdea?: (text: string) => Promise<void> | void;
  initialArgumentation?: string;
  onSaveArgumentation?: (text: string) => Promise<void> | void;
}

const MainIdeaStepContent: React.FC<MainIdeaStepContentProps> = ({
  initialContextIdea = '',
  onSaveContextIdea,
  initialTextIdea = '',
  onSaveTextIdea,
  initialArgumentation = '',
  onSaveArgumentation,
}) => {
  const { t } = useTranslation();

  // Title functions to avoid duplicate strings
  const getSaveTitle = () => t('actions.save') || MAIN_IDEA_SAVE_FALLBACK;
  const getCancelTitle = () => t('actions.cancel') || MAIN_IDEA_CANCEL_FALLBACK;

  const [contextDraft, setContextDraft] = React.useState<string>(initialContextIdea || '');
  const [textDraft, setTextDraft] = React.useState<string>(initialTextIdea || '');
  const [argumentationDraft, setArgumentationDraft] = React.useState<string>(initialArgumentation || '');
  const [isSavingContext, setIsSavingContext] = React.useState<boolean>(false);
  const [isSavingText, setIsSavingText] = React.useState<boolean>(false);
  const [isSavingArgumentation, setIsSavingArgumentation] = React.useState<boolean>(false);

  React.useEffect(() => {
    setContextDraft(initialContextIdea || '');
  }, [initialContextIdea]);

  React.useEffect(() => {
    setTextDraft(initialTextIdea || '');
  }, [initialTextIdea]);

  React.useEffect(() => {
    setArgumentationDraft(initialArgumentation || '');
  }, [initialArgumentation]);

  const contextHasChanges = React.useMemo(() => (initialContextIdea || '') !== contextDraft, [initialContextIdea, contextDraft]);
  const textHasChanges = React.useMemo(() => (initialTextIdea || '') !== textDraft, [initialTextIdea, textDraft]);
  const argumentationHasChanges = React.useMemo(() => (initialArgumentation || '') !== argumentationDraft, [initialArgumentation, argumentationDraft]);

  const handleSaveContext = async () => {
    if (!onSaveContextIdea) return;
    try {
      setIsSavingContext(true);
      await onSaveContextIdea(contextDraft);
    } finally {
      setIsSavingContext(false);
    }
  };

  const handleSaveText = async () => {
    if (!onSaveTextIdea) return;
    try {
      setIsSavingText(true);
      await onSaveTextIdea(textDraft);
    } finally {
      setIsSavingText(false);
    }
  };

  const handleSaveArgumentation = async () => {
    if (!onSaveArgumentation) return;
    try {
      setIsSavingArgumentation(true);
      await onSaveArgumentation(argumentationDraft);
    } finally {
      setIsSavingArgumentation(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Context main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.contextIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.contextIdea.instruction')}</li>
        </ul>
        
        {onSaveContextIdea && (
          <>
            <textarea
              rows={3}
              value={contextDraft}
              onChange={(e) => setContextDraft(e.target.value)}
              placeholder={t('wizard.steps.mainIdea.contextIdea.placeholder')}
              className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
            />
            {contextHasChanges && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveContext}
                  disabled={isSavingContext}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                  title={getSaveTitle()}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setContextDraft(initialContextIdea || '')}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                  title={getCancelTitle()}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Text main idea */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Lightbulb className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.textIdea.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.textIdea.instruction1')}</li>
          <li>{t('wizard.steps.mainIdea.textIdea.instruction2')}</li>
        </ul>
        
        {onSaveTextIdea && (
          <>
            <textarea
              rows={3}
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              placeholder={t('wizard.steps.mainIdea.textIdea.placeholder')}
              className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
            />
            {textHasChanges && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveText}
                  disabled={isSavingText}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                  title={getSaveTitle()}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTextDraft(initialTextIdea || '')}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                  title={getCancelTitle()}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
        
        {/* Note moved inside text main idea section */}
        <div className={`mt-3 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          <div className="flex items-center gap-2 mb-1">
            <h5 className="text-sm font-semibold">{t('wizard.steps.mainIdea.note.title')}</h5>
          </div>
          <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
            <li>{t('wizard.steps.mainIdea.note.text')}</li>
          </ul>
        </div>
      </div>

      {/* Argumentation */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.mainIdea.argumentation.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm mb-3">
          <li>{t('wizard.steps.mainIdea.argumentation.instruction')}</li>
        </ul>
        
        {onSaveArgumentation && (
          <>
            <textarea
              rows={3}
              value={argumentationDraft}
              onChange={(e) => setArgumentationDraft(e.target.value)}
              placeholder={t('wizard.steps.mainIdea.argumentation.placeholder')}
              className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
            />
            {argumentationHasChanges && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveArgumentation}
                  disabled={isSavingArgumentation}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                  title={getSaveTitle()}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setArgumentationDraft(initialArgumentation || '')}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                  title={getCancelTitle()}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default MainIdeaStepContent;


