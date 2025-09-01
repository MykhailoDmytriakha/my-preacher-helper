'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { Quote, BookOpen, HelpCircle, Check, X } from 'lucide-react';

interface ThesisStepContentProps {
  exegetical?: string;
  onSaveExegetical?: (text: string) => Promise<void> | void;

  // Homiletical Q&A
  whyPreach?: string;
  onSaveWhyPreach?: (text: string) => Promise<void> | void;
  impactOnChurch?: string;
  onSaveImpactOnChurch?: (text: string) => Promise<void> | void;
  practicalQuestions?: string;
  onSavePracticalQuestions?: (text: string) => Promise<void> | void;

  homiletical?: string;
  onSaveHomiletical?: (text: string) => Promise<void> | void;

  // One-sentence thesis block
  questionWord?: string;
  onSaveQuestionWord?: (text: string) => Promise<void> | void;
  pluralKey?: string;
  onSavePluralKey?: (text: string) => Promise<void> | void;
  transitionSentence?: string;
  onSaveTransitionSentence?: (text: string) => Promise<void> | void;
  oneSentence?: string;
  onSaveOneSentence?: (text: string) => Promise<void> | void;
  sermonInOneSentence?: string;
  onSaveSermonInOneSentence?: (text: string) => Promise<void> | void;
}

const ThesisStepContent: React.FC<ThesisStepContentProps> = ({
  exegetical = '', onSaveExegetical,
  whyPreach = '', onSaveWhyPreach,
  impactOnChurch = '', onSaveImpactOnChurch,
  practicalQuestions = '', onSavePracticalQuestions,
  homiletical = '', onSaveHomiletical,
  questionWord = '', onSaveQuestionWord,
  pluralKey = '', onSavePluralKey,
  transitionSentence = '', onSaveTransitionSentence,
  oneSentence = '', onSaveOneSentence,
  sermonInOneSentence = '', onSaveSermonInOneSentence,
}) => {
  const { t } = useTranslation();

  // Local drafts
  const [exeDraft, setExeDraft] = React.useState(exegetical);
  const [whyDraft, setWhyDraft] = React.useState(whyPreach);
  const [impactDraft, setImpactDraft] = React.useState(impactOnChurch);
  const [practicalDraft, setPracticalDraft] = React.useState(practicalQuestions);
  const [homoDraft, setHomoDraft] = React.useState(homiletical);
  const [questionDraft, setQuestionDraft] = React.useState(questionWord);
  const [pluralKeyDraft, setPluralKeyDraft] = React.useState(pluralKey);
  const [transitionDraft, setTransitionDraft] = React.useState(transitionSentence);
  const [oneSentenceDraft, setOneSentenceDraft] = React.useState(oneSentence);
  const [sermonOneDraft, setSermonOneDraft] = React.useState(sermonInOneSentence);

  React.useEffect(() => setExeDraft(exegetical || ''), [exegetical]);
  React.useEffect(() => setWhyDraft(whyPreach || ''), [whyPreach]);
  React.useEffect(() => setImpactDraft(impactOnChurch || ''), [impactOnChurch]);
  React.useEffect(() => setPracticalDraft(practicalQuestions || ''), [practicalQuestions]);
  React.useEffect(() => setHomoDraft(homiletical || ''), [homiletical]);
  React.useEffect(() => setQuestionDraft(questionWord || ''), [questionWord]);
  React.useEffect(() => setPluralKeyDraft(pluralKey || ''), [pluralKey]);
  React.useEffect(() => setTransitionDraft(transitionSentence || ''), [transitionSentence]);
  React.useEffect(() => setOneSentenceDraft(oneSentence || ''), [oneSentence]);
  React.useEffect(() => setSermonOneDraft(sermonInOneSentence || ''), [sermonInOneSentence]);

  // Saving states
  const [saving, setSaving] = React.useState<{[k: string]: boolean}>({});
  const setSavingKey = (k: string, v: boolean) => setSaving(prev => ({ ...prev, [k]: v }));

  const renderSaveCancel = (key: string, hasChanges: boolean, onSave?: () => Promise<void> | void, onCancel?: () => void) => (
    hasChanges && (
      <div className="mt-2 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={async () => { if (!onSave) return; setSavingKey(key, true); try { await onSave(); } finally { setSavingKey(key, false); } }}
          disabled={saving[key]}
          className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
          title={t('actions.save') || 'Save'}
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          title={t('actions.cancel') || 'Cancel'}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  );

  const [showInstruction, setShowInstruction] = React.useState(false);

  return (
    <div className="space-y-3">
      {/* Instruction */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.title')}</h4>
          <button
            type="button"
            onClick={() => setShowInstruction(s => !s)}
            className={`ml-auto inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          >
            {showInstruction ? (t('wizard.steps.thesis.instruction.hide') as string) : (t('wizard.steps.thesis.instruction.show') as string)}
          </button>
        </div>
        {showInstruction && (
          <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            <div className="space-y-3 text-sm">
              <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText}`}>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.note.usingTBT')}</li>
                  <li>{t('wizard.steps.thesis.note.mainMessage')}</li>
                  <li>{t('wizard.steps.thesis.note.naming')}</li>
                  <li>{t('wizard.steps.thesis.note.verb')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.exegetical.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.exegetical.definition')}</li>
                  <li>{t('wizard.steps.thesis.exegetical.whereFound')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.homiletical.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.homiletical.q.why')}</li>
                  <li>{t('wizard.steps.thesis.homiletical.q.impact')}</li>
                  <li>{t('wizard.steps.thesis.homiletical.q.practical')}</li>
                </ul>
              </div>
              <div>
                <h5 className="text-sm font-semibold mb-1">{t('wizard.steps.thesis.oneSentence.title')}</h5>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.thesis.oneSentence.question')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.pluralKey')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.transition')}</li>
                  <li>{t('wizard.steps.thesis.oneSentence.sermon')}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Exegetical Thesis */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.exegetical.title')}</h4>
        </div>
        <textarea
          rows={3}
          value={exeDraft}
          onChange={(e) => setExeDraft(e.target.value)}
          placeholder={t('wizard.steps.thesis.exegetical.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
        />
        {renderSaveCancel('exe', exeDraft !== (exegetical || ''), async () => onSaveExegetical && onSaveExegetical(exeDraft), () => setExeDraft(exegetical || ''))}
      </div>

      {/* Homiletical Q&A */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Quote className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.homiletical.title')}</h4>
        </div>
        <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.homiletical.q.why')}</label>
        <textarea rows={2} value={whyDraft} onChange={(e)=>setWhyDraft(e.target.value)} placeholder={t('wizard.steps.thesis.homiletical.q.whyPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('why', whyDraft !== (whyPreach || ''), async () => onSaveWhyPreach && onSaveWhyPreach(whyDraft), () => setWhyDraft(whyPreach || ''))}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.q.impact')}</label>
        <textarea rows={2} value={impactDraft} onChange={(e)=>setImpactDraft(e.target.value)} placeholder={t('wizard.steps.thesis.homiletical.q.impactPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('impact', impactDraft !== (impactOnChurch || ''), async () => onSaveImpactOnChurch && onSaveImpactOnChurch(impactDraft), () => setImpactDraft(impactOnChurch || ''))}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.q.practical')}</label>
        <textarea rows={2} value={practicalDraft} onChange={(e)=>setPracticalDraft(e.target.value)} placeholder={t('wizard.steps.thesis.homiletical.q.practicalPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('practical', practicalDraft !== (practicalQuestions || ''), async () => onSavePracticalQuestions && onSavePracticalQuestions(practicalDraft), () => setPracticalDraft(practicalQuestions || ''))}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.homiletical.own')}</label>
        <textarea rows={3} value={homoDraft} onChange={(e)=>setHomoDraft(e.target.value)} placeholder={t('wizard.steps.thesis.homiletical.ownPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('homiletical', homoDraft !== (homiletical || ''), async () => onSaveHomiletical && onSaveHomiletical(homoDraft), () => setHomoDraft(homiletical || ''))}
      </div>

      {/* One-sentence thesis & related */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <HelpCircle className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.thesis.oneSentence.title')}</h4>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.oneSentence.questionLabel')}</label>
            <input type="text" value={questionDraft} onChange={(e)=>setQuestionDraft(e.target.value)} placeholder={t('wizard.steps.thesis.oneSentence.questionPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
            {renderSaveCancel('question', questionDraft !== (questionWord || ''), async () => onSaveQuestionWord && onSaveQuestionWord(questionDraft), () => setQuestionDraft(questionWord || ''))}
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">{t('wizard.steps.thesis.oneSentence.pluralKeyLabel')}</label>
            <input type="text" value={pluralKeyDraft} onChange={(e)=>setPluralKeyDraft(e.target.value)} placeholder={t('wizard.steps.thesis.oneSentence.pluralKeyPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
            {renderSaveCancel('pluralKey', pluralKeyDraft !== (pluralKey || ''), async () => onSavePluralKey && onSavePluralKey(pluralKeyDraft), () => setPluralKeyDraft(pluralKey || ''))}
          </div>
        </div>
        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.transitionLabel')}</label>
        <textarea rows={2} value={transitionDraft} onChange={(e)=>setTransitionDraft(e.target.value)} placeholder={t('wizard.steps.thesis.oneSentence.transitionPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('transition', transitionDraft !== (transitionSentence || ''), async () => onSaveTransitionSentence && onSaveTransitionSentence(transitionDraft), () => setTransitionDraft(transitionSentence || ''))}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.oneLabel')}</label>
        <textarea rows={2} value={oneSentenceDraft} onChange={(e)=>setOneSentenceDraft(e.target.value)} placeholder={t('wizard.steps.thesis.oneSentence.onePh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('one', oneSentenceDraft !== (oneSentence || ''), async () => onSaveOneSentence && onSaveOneSentence(oneSentenceDraft), () => setOneSentenceDraft(oneSentence || ''))}

        <label className="block text-xs font-medium mt-3 mb-1">{t('wizard.steps.thesis.oneSentence.sermonLabel')}</label>
        <textarea rows={2} value={sermonOneDraft} onChange={(e)=>setSermonOneDraft(e.target.value)} placeholder={t('wizard.steps.thesis.oneSentence.sermonPh') || ''} className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}/>
        {renderSaveCancel('sermon', sermonOneDraft !== (sermonInOneSentence || ''), async () => onSaveSermonInOneSentence && onSaveSermonInOneSentence(sermonOneDraft), () => setSermonOneDraft(sermonInOneSentence || ''))}
      </div>
    </div>
  );
};

export default ThesisStepContent;

