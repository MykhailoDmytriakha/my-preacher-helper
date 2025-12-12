'use client';

import { Info, Check, X, Plus, Trash2, ArrowUp, ArrowDown, ListChecks, BookOpen } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';

import { UI_COLORS } from '@/utils/themeColors';

interface HomileticPlanItem {
  id: string;
  title: string;
}

interface HomileticPlanStepContentProps {
  // Modern translation
  initialModernTranslation?: string;
  onSaveModernTranslation?: (text: string) => Promise<void> | void;

  // Updated (actualized) plan
  initialUpdatedPlan?: HomileticPlanItem[];
  onSaveUpdatedPlan?: (items: HomileticPlanItem[]) => Promise<void> | void;

  // Sermon plan
  initialSermonPlan?: HomileticPlanItem[];
  onSaveSermonPlan?: (items: HomileticPlanItem[]) => Promise<void> | void;
}

const genId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const HomileticPlanStepContent: React.FC<HomileticPlanStepContentProps> = ({
  initialModernTranslation = '',
  onSaveModernTranslation,
  initialUpdatedPlan = [],
  onSaveUpdatedPlan,
  initialSermonPlan = [],
  onSaveSermonPlan,
}) => {
  const { t } = useTranslation();

  // Use unique fallback literals to avoid duplicate string warnings

  // Instruction collapse
  const [showInstruction, setShowInstruction] = useState<boolean>(false);

  // Modern translation draft
  const [modernDraft, setModernDraft] = useState<string>(initialModernTranslation || '');
  const modernHasChanges = (modernDraft || '') !== (initialModernTranslation || '');
  const [savingModern, setSavingModern] = useState(false);

  const handleSaveModern = async () => {
    if (!onSaveModernTranslation) return;
    try {
      setSavingModern(true);
      await onSaveModernTranslation(modernDraft || '');
    } finally {
      setSavingModern(false);
    }
  };

  // Updated plan (list) draft
  const [updatedPlanDraft, setUpdatedPlanDraft] = useState<HomileticPlanItem[]>(initialUpdatedPlan || []);
  const updatedPlanHasChanges = useMemo(() => {
    const a = initialUpdatedPlan || [];
    const b = updatedPlanDraft || [];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || (a[i].title || '') !== (b[i].title || '')) return true;
    }
    return false;
  }, [initialUpdatedPlan, updatedPlanDraft]);

  const addUpdatedItem = () => {
    setUpdatedPlanDraft(prev => [...prev, { id: genId(), title: '' }]);
  };
  const removeUpdatedItem = (id: string) => {
    setUpdatedPlanDraft(prev => prev.filter(it => it.id !== id));
  };
  const moveUpdatedItem = (index: number, dir: -1 | 1) => {
    setUpdatedPlanDraft(prev => {
      const next = [...prev];
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[newIndex];
      next[newIndex] = tmp;
      return next;
    });
  };

  const handleSaveUpdatedPlan = async () => {
    if (!onSaveUpdatedPlan) return;
    await onSaveUpdatedPlan(updatedPlanDraft.map(it => ({ id: it.id, title: (it.title || '').trim() })));
  };

  // Sermon plan (list) draft
  const [sermonPlanDraft, setSermonPlanDraft] = useState<HomileticPlanItem[]>(initialSermonPlan || []);
  const sermonPlanHasChanges = useMemo(() => {
    const a = initialSermonPlan || [];
    const b = sermonPlanDraft || [];
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i].id !== b[i].id || (a[i].title || '') !== (b[i].title || '')) return true;
    }
    return false;
  }, [initialSermonPlan, sermonPlanDraft]);

  const addSermonPlanItem = () => {
    setSermonPlanDraft(prev => [...prev, { id: genId(), title: '' }]);
  };
  const removeSermonPlanItem = (id: string) => {
    setSermonPlanDraft(prev => prev.filter(it => it.id !== id));
  };
  const moveSermonPlanItem = (index: number, dir: -1 | 1) => {
    setSermonPlanDraft(prev => {
      const next = [...prev];
      const newIndex = index + dir;
      if (newIndex < 0 || newIndex >= next.length) return prev;
      const tmp = next[index];
      next[index] = next[newIndex];
      next[newIndex] = tmp;
      return next;
    });
  };

  const handleSaveSermonPlan = async () => {
    if (!onSaveSermonPlan) return;
    await onSaveSermonPlan(sermonPlanDraft.map(it => ({ id: it.id, title: (it.title || '').trim() })));
  };

  return (
    <div className="space-y-4">
      {/* Header with instruction toggle */}
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.title')}</h4>
        <button
          type="button"
          className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          onClick={() => setShowInstruction(s => !s)}
          aria-expanded={showInstruction}
          title={(showInstruction ? t('wizard.steps.homileticPlan.instruction.hide') : t('wizard.steps.homileticPlan.instruction.show')) as string}
        >
          <Info className="w-4 h-4" /> {showInstruction ? (t('wizard.steps.homileticPlan.instruction.hide') as string) : (t('wizard.steps.homileticPlan.instruction.show') as string)}
        </button>
      </div>

      {showInstruction && (
        <div className={`p-3 rounded-md text-sm border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
          {/* Homiletic plan note */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.homileticPlan')}</h5>
            </div>
            <p className="text-gray-700 dark:text-gray-300">
              {t('wizard.steps.homileticPlan.homiletic.note')}
            </p>
          </div>

          {/* Modern translation */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.modernTranslation')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p1')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p2')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.modernTranslation.p3')}</li>
            </ul>
          </div>

          {/* Updated plan instruction */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.updatedPlan')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.updatedPlan.p1')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.updatedPlan.p2')}</li>
            </ul>
          </div>

          {/* Sermon plan guidance (short) */}
          <div className="mb-3">
            <div className="flex items-center gap-2 mb-1">
              <ListChecks className="w-4 h-4 text-gray-600 dark:text-gray-300" />
              <h5 className="text-sm font-semibold">{t('wizard.steps.homileticPlan.sections.sermonPlan')}</h5>
            </div>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.definition')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.unity')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.transitions')}</li>
              <li>{t('wizard.steps.homileticPlan.instructions.sermonPlan.principles')}</li>
            </ul>
          </div>

          {/* Deep guide sections */}
          <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
            {/* Plan definition */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.planDefinition.title')}</h6>
              <ul className="list-disc pl-5 space-y-1">
                <li>{t('wizard.steps.homileticPlan.guide.planDefinition.p1')}</li>
              </ul>
              <div className="mt-2">
                <div className="text-xs font-medium mb-1">{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.basedOnStructure')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.topicSentences')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.intentRelation')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.planDefinition.diagram.commonAcrossPoints')}</li>
                </ul>
              </div>
            </div>

            {/* Unity, order, progress */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.unityOrderProgress.title')}</h6>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>
                  {t('wizard.steps.homileticPlan.guide.unityOrderProgress.logicalChronological')}
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.generalToSpecific')}</li>
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.focusFlow')}</li>
                  </ul>
                </li>
                <li>
                  {t('wizard.steps.homileticPlan.guide.unityOrderProgress.psychSequence')}
                  <ul className="list-disc pl-5 mt-1 space-y-1">
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.notCorner')}</li>
                    <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.showRoad')}</li>
                  </ul>
                </li>
                <li>{t('wizard.steps.homileticPlan.guide.unityOrderProgress.rule2to4')}</li>
              </ul>
            </div>

            {/* Transitions */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.transitions.title')}</h6>
            </div>

            {/* Principles */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.principles.title')}</h6>
              <ul className="list-disc pl-5 space-y-1 text-sm">
                <li>{t('wizard.steps.homileticPlan.guide.principles.p1')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p2')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p3')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p4')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p5')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p6')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p7')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p8')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p9')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.principles.p10')}</li>
              </ul>
            </div>

            {/* ThoughtsBySection examples */}
            <div className="mb-3">
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.structureExamples.title')}</h6>
              {/* Time logic */}
              <div className="mt-1">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i4')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.timeLogic.items.i5')}</li>
                </ul>
              </div>
              {/* Place logic */}
              <div className="mt-2">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.placeLogic.items.i4')}</li>
                </ul>
              </div>
              {/* Qualities */}
              <div className="mt-2">
                <div className="text-xs font-medium">{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.title')}</div>
                <ul className="list-disc pl-5 space-y-1 text-sm">
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i1')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i2')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i3')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i4')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i5')}</li>
                  <li>{t('wizard.steps.homileticPlan.guide.structureExamples.qualities.items.i6')}</li>
                </ul>
              </div>
            </div>

            {/* 8 basic structures */}
            <div>
              <h6 className="text-sm font-semibold mb-1">{t('wizard.steps.homileticPlan.guide.structures8.title')}</h6>
              <ol className="list-decimal pl-5 space-y-1 text-sm">
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.deductive')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.inductive')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.narrative')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.biographical')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.problemSolution')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.thematic')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.motivational')}</li>
                <li>{t('wizard.steps.homileticPlan.guide.structures8.items.dramatic')}</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Modern translation field */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
        <label className="block text-xs font-medium mb-1" htmlFor="modern-translation-textarea">
          {t('wizard.steps.homileticPlan.fields.modernTranslation.label')}
        </label>
        <textarea
          id="modern-translation-textarea"
          rows={4}
          value={modernDraft}
          onChange={(e) => setModernDraft(e.target.value)}
          placeholder={t('wizard.steps.homileticPlan.fields.modernTranslation.placeholder') || ''}
          className={`w-full rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          aria-label={t('wizard.steps.homileticPlan.fields.modernTranslation.label') || 'Modern translation'}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {modernHasChanges && (
            <>
              <button
                type="button"
                onClick={handleSaveModern}
                disabled={savingModern || (modernDraft.trim().length === 0)}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                title={t('homiletic.actions.save') || "ModernTranslationSave"}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setModernDraft(initialModernTranslation || '')}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('homiletic.actions.cancel') || "ModernTranslationCancel"}
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Updated (actualized) plan list */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium" htmlFor="updated-plan-add-input">
            {t('wizard.steps.homileticPlan.fields.updatedPlan.label')}
          </label>
          <button
            type="button"
            onClick={addUpdatedItem}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
            title={t('wizard.steps.homileticPlan.fields.updatedPlan.addItem') as string}
          >
            <Plus className="w-4 h-4" /> {t('wizard.steps.homileticPlan.fields.updatedPlan.addItem')}
          </button>
        </div>
        <ul className="space-y-2">
          {updatedPlanDraft.map((item, idx) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="text"
                value={item.title}
                onChange={(e) => {
                  const val = e.target.value;
                  setUpdatedPlanDraft(prev => prev.map((it, i) => i === idx ? { ...it, title: val } : it));
                }}
                placeholder={t('wizard.steps.homileticPlan.fields.updatedPlan.itemPlaceholder') || ''}
                className={`flex-1 rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                aria-label={t('wizard.steps.homileticPlan.fields.updatedPlan.itemLabel') || 'Plan item'}
              />
              <button
                type="button"
                onClick={() => moveUpdatedItem(idx, -1)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.updatedPlan.moveUp') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.updatedPlan.moveUp') || 'Move up'}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => moveUpdatedItem(idx, 1)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.updatedPlan.moveDown') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.updatedPlan.moveDown') || 'Move down'}
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => removeUpdatedItem(item.id)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.updatedPlan.remove') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.updatedPlan.remove') || 'Remove'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        {updatedPlanHasChanges && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveUpdatedPlan}
              disabled={updatedPlanDraft.some(it => (it.title || '').trim().length === 0)}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
              title={t('actions.save') || 'Save'}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setUpdatedPlanDraft(initialUpdatedPlan || [])}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
              title={t('actions.cancel') || 'Cancel'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Sermon plan list */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium" htmlFor="sermon-plan-add-input">
            {t('wizard.steps.homileticPlan.fields.sermonPlan.label')}
          </label>
          <button
            type="button"
            onClick={addSermonPlanItem}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
            title={t('wizard.steps.homileticPlan.fields.sermonPlan.addItem') as string}
          >
            <Plus className="w-4 h-4" /> {t('wizard.steps.homileticPlan.fields.sermonPlan.addItem')}
          </button>
        </div>
        <ul className="space-y-2">
          {sermonPlanDraft.map((item, idx) => (
            <li key={item.id} className="flex items-center gap-2">
              <input
                type="text"
                value={item.title}
                onChange={(e) => {
                  const val = e.target.value;
                  setSermonPlanDraft(prev => prev.map((it, i) => i === idx ? { ...it, title: val } : it));
                }}
                placeholder={t('wizard.steps.homileticPlan.fields.sermonPlan.itemPlaceholder') || ''}
                className={`flex-1 rounded-md border px-3 py-2 bg-white dark:bg-gray-800 ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                aria-label={t('wizard.steps.homileticPlan.fields.sermonPlan.itemLabel') || 'Plan item'}
              />
              <button
                type="button"
                onClick={() => moveSermonPlanItem(idx, -1)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.sermonPlan.moveUp') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.sermonPlan.moveUp') || 'Move up'}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => moveSermonPlanItem(idx, 1)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.sermonPlan.moveDown') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.sermonPlan.moveDown') || 'Move down'}
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => removeSermonPlanItem(item.id)}
                className={`inline-flex items-center justify-center px-2 py-1 rounded-md text-xs border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('wizard.steps.homileticPlan.fields.sermonPlan.remove') as string}
                aria-label={t('wizard.steps.homileticPlan.fields.sermonPlan.remove') || 'Remove'}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
        {sermonPlanHasChanges && (
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleSaveSermonPlan}
              disabled={sermonPlanDraft.some(it => (it.title || '').trim().length === 0)}
              className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
              title={t('actions.save') || 'Save'}
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setSermonPlanDraft(initialSermonPlan || [])}
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

export default HomileticPlanStepContent;
