'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { Target, Link as LinkIcon, ScrollText, Check, X, Info, HelpCircle, BookOpen } from 'lucide-react';

type GoalType = '' | 'informative' | 'proclamation' | 'didactic' | 'exhortative';

interface GoalsStepContentProps {
  initialTimelessTruth?: string;
  onSaveTimelessTruth?: (text: string) => Promise<void> | void;
  initialChristConnection?: string;
  onSaveChristConnection?: (text: string) => Promise<void> | void;
  initialGoalStatement?: string;
  onSaveGoalStatement?: (text: string) => Promise<void> | void;
  initialGoalType?: GoalType;
  onSaveGoalType?: (type: Exclude<GoalType, ''>) => Promise<void> | void;
}

const GoalsStepContent: React.FC<GoalsStepContentProps> = ({
  initialTimelessTruth = '',
  onSaveTimelessTruth,
  initialChristConnection = '',
  onSaveChristConnection,
  initialGoalStatement = '',
  onSaveGoalStatement,
  initialGoalType = '',
  onSaveGoalType,
}) => {
  const { t } = useTranslation();

  const [timelessDraft, setTimelessDraft] = React.useState<string>(initialTimelessTruth || '');
  const [christDraft, setChristDraft] = React.useState<string>(initialChristConnection || '');
  const [goalDraft, setGoalDraft] = React.useState<string>(initialGoalStatement || '');
  const [typeDraft, setTypeDraft] = React.useState<GoalType>(initialGoalType || '');

  const [savingTimeless, setSavingTimeless] = React.useState(false);
  const [savingChrist, setSavingChrist] = React.useState(false);
  const [savingGoal, setSavingGoal] = React.useState(false);
  const [savingType, setSavingType] = React.useState(false);

  const [showInstruction, setShowInstruction] = React.useState<boolean>(false);

  React.useEffect(() => setTimelessDraft(initialTimelessTruth || ''), [initialTimelessTruth]);
  React.useEffect(() => setChristDraft(initialChristConnection || ''), [initialChristConnection]);
  React.useEffect(() => setGoalDraft(initialGoalStatement || ''), [initialGoalStatement]);
  React.useEffect(() => setTypeDraft(initialGoalType || ''), [initialGoalType]);

  const timelessChanged = (initialTimelessTruth || '') !== timelessDraft;
  const christChanged = (initialChristConnection || '') !== christDraft;
  const goalChanged = (initialGoalStatement || '') !== goalDraft;
  const typeChanged = (initialGoalType || '') !== typeDraft;

  const handleSaveTimeless = async () => {
    if (!onSaveTimelessTruth) return;
    try { setSavingTimeless(true); await onSaveTimelessTruth(timelessDraft); } finally { setSavingTimeless(false); }
  };
  const handleSaveChrist = async () => {
    if (!onSaveChristConnection) return;
    try { setSavingChrist(true); await onSaveChristConnection(christDraft); } finally { setSavingChrist(false); }
  };
  const handleSaveGoal = async () => {
    if (!onSaveGoalStatement) return;
    try { setSavingGoal(true); await onSaveGoalStatement(goalDraft); } finally { setSavingGoal(false); }
  };
  const handleSaveType = async () => {
    if (!onSaveGoalType || !typeDraft) return;
    try { setSavingType(true); await onSaveGoalType(typeDraft); } finally { setSavingType(false); }
  };

  return (
    <div className="space-y-3">
      {/* Instruction block (collapsible) */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.title')}</h4>
          <button
            type="button"
            onClick={() => setShowInstruction((s) => !s)}
            className={`ml-auto inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          >
            {showInstruction ? (t('wizard.steps.goals.instruction.hide') as string) : (t('wizard.steps.goals.instruction.show') as string)}
          </button>
        </div>
        {showInstruction && (
          <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            <div className="space-y-4 text-sm">
              {/* Timeless Truth Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <ScrollText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.timelessTruth.title')}</h5>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.tt.definition1')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.definition2')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.question')}</li>
                  <li>{t('wizard.steps.goals.instruction.tt.otNt')}</li>
                  <li>
                    {t('wizard.steps.goals.instruction.tt.warningTitle')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.tt.warning1')}</li>
                    </ul>
                  </li>
                  <li>
                    {t('wizard.steps.goals.instruction.tt.howToFind.title')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.tt.howToFind.scan')}</li>
                      <li>{t('wizard.steps.goals.instruction.tt.howToFind.fromKeyVerse')}</li>
                    </ul>
                  </li>
                </ul>
                <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className={`w-4 h-4 ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`} />
                    <h6 className="text-sm font-semibold">{t('wizard.steps.goals.instruction.tt.examplePhilip.title')}</h6>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.key')}</li>
                    <li>
                      {t('wizard.steps.goals.instruction.tt.examplePhilip.explains')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q1')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q2')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q3')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.examplePhilip.q4')}</li>
                      </ul>
                    </li>
                  </ul>
                </div>
                <div className={`mt-2 p-3 rounded-md border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className={`w-4 h-4 ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`} />
                    <h6 className="text-sm font-semibold">{t('wizard.steps.goals.instruction.tt.example2Peter.title')}</h6>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.goals.instruction.tt.example2Peter.summary')}</li>
                    <li>{t('wizard.steps.goals.instruction.tt.example2Peter.key')}</li>
                    <li>
                      {t('wizard.steps.goals.instruction.tt.example2Peter.explains')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q1')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q2')}</li>
                        <li>{t('wizard.steps.goals.instruction.tt.example2Peter.q3')}</li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Christ Connection Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <LinkIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.christConnection.title')}</h5>
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.cc.road')}</li>
                  <li>{t('wizard.steps.goals.christConnection.warning')}</li>
                </ul>
              </div>

              {/* Goal Guide */}
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Target className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                  <h5 className="text-sm font-semibold">{t('wizard.steps.goals.goal.title')}</h5>
                </div>
                <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} mb-1`}>
                  {t('wizard.steps.goals.goal.note')}
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  <li>{t('wizard.steps.goals.instruction.goal.purpose')}</li>
                  <li>{t('wizard.steps.goals.instruction.goal.keepSearching')}</li>
                  <li>
                    {t('wizard.steps.goals.instruction.goal.typesTitle')}
                    <ul className="list-disc pl-5 mt-1 space-y-1">
                      <li>{t('wizard.steps.goals.instruction.goal.typeInformative')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeProclamation')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeDidactic')}</li>
                      <li>{t('wizard.steps.goals.instruction.goal.typeExhortative')}</li>
                    </ul>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
      {/* Timeless Biblical Truth */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ScrollText className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.timelessTruth.title')}</h4>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('wizard.steps.goals.timelessTruth.instruction')}</p>
        <textarea
          rows={3}
          value={timelessDraft}
          onChange={(e) => setTimelessDraft(e.target.value)}
          placeholder={t('wizard.steps.goals.timelessTruth.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
        />
        {timelessChanged && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveTimeless}
              disabled={savingTimeless}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
              title={t('actions.save') || 'Save'}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setTimelessDraft(initialTimelessTruth || '')}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
              title={t('actions.cancel') || 'Cancel'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Christ Connection */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <LinkIcon className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.christConnection.title')}</h4>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 mb-2">{t('wizard.steps.goals.christConnection.instruction')}</p>
        <textarea
          rows={3}
          value={christDraft}
          onChange={(e) => setChristDraft(e.target.value)}
          placeholder={t('wizard.steps.goals.christConnection.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
        />
        <div className={`mt-2 p-2 rounded border text-xs ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-gray-500" />
            <span className="text-gray-600 dark:text-gray-400">{t('wizard.steps.goals.christConnection.warning')}</span>
          </div>
        </div>
        {christChanged && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveChrist}
              disabled={savingChrist}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
              title={t('actions.save') || 'Save'}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setChristDraft(initialChristConnection || '')}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
              title={t('actions.cancel') || 'Cancel'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Goal */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Target className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.goals.goal.title')}</h4>
        </div>
        <div className="grid sm:grid-cols-3 gap-2 mb-2">
          <label className="text-sm font-medium sm:col-span-1 flex items-center">{t('wizard.steps.goals.goal.typeLabel')}</label>
          <div className="sm:col-span-2">
            <select
              value={typeDraft}
              onChange={(e) => setTypeDraft(e.target.value as GoalType)}
              className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
            >
              <option value="">{t('wizard.steps.goals.goal.typePlaceholder')}</option>
              <option value="informative">{t('wizard.steps.goals.goal.types.informative')}</option>
              <option value="proclamation">{t('wizard.steps.goals.goal.types.proclamation')}</option>
              <option value="didactic">{t('wizard.steps.goals.goal.types.didactic')}</option>
              <option value="exhortative">{t('wizard.steps.goals.goal.types.exhortative')}</option>
            </select>
            {typeChanged && (
              <div className="mt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={handleSaveType}
                  disabled={savingType || !typeDraft}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                  title={t('actions.save') || 'Save'}
                >
                  <Check className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setTypeDraft(initialGoalType || '')}
                  className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                  title={t('actions.cancel') || 'Cancel'}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <textarea
          rows={3}
          value={goalDraft}
          onChange={(e) => setGoalDraft(e.target.value)}
          placeholder={t('wizard.steps.goals.goal.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} focus:outline-none focus:ring-2 focus:ring-offset-0`}
        />
        <div className={`mt-2 p-2 rounded border text-xs ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-gray-500" />
            <span className="text-gray-600 dark:text-gray-400">{t('wizard.steps.goals.goal.note')}</span>
          </div>
        </div>
        {goalChanged && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveGoal}
              disabled={savingGoal}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
              title={t('actions.save') || 'Save'}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setGoalDraft(initialGoalStatement || '')}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
              title={t('actions.cancel') || 'Cancel'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default GoalsStepContent;
