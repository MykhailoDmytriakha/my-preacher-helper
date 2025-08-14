'use client';

import React from 'react';
import { UI_COLORS } from '@/utils/themeColors';
import { useTranslation } from 'react-i18next';
import '@locales/i18n';
import { BookOpen, ListTree, Info, Plus, X, Check, CornerDownRight } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

import type { ExegeticalPlanNode, Preparation } from '@/models/models';

type TreeNodeProps = { node: ExegeticalPlanNode; depth?: number; isLast?: boolean };

type ExegeticalPlanStepContentProps = {
  value?: ExegeticalPlanNode[];
  onChange?: (nodes: ExegeticalPlanNode[]) => void;
  onSave?: (nodes: ExegeticalPlanNode[]) => Promise<void> | void;
  saving?: boolean;
  authorIntent?: string;
  onSaveAuthorIntent?: (text: string) => Promise<void> | void;
};

const ExegeticalPlanStepContent: React.FC<ExegeticalPlanStepContentProps> = ({ value = [], onChange, onSave, saving, authorIntent = '', onSaveAuthorIntent }) => {
  const { t } = useTranslation();

  const [showInstruction, setShowInstruction] = React.useState(false);
  const [tree, setTree] = React.useState<ExegeticalPlanNode[]>(() =>
    (value && value.length > 0) ? value : [{ id: `n-${Date.now()}`, title: '', children: [] }]
  );
  const [draftTitles, setDraftTitles] = React.useState<Record<string, string>>({});
  const [expand, setExpand] = React.useState<Record<string, boolean>>({});
  const [focusedId, setFocusedId] = React.useState<string | null>(null);
  const [authorIntentDraft, setAuthorIntentDraft] = React.useState<string>(authorIntent || '');
  const [isSavingAuthorIntent, setIsSavingAuthorIntent] = React.useState<boolean>(false);

  React.useEffect(() => {
    setAuthorIntentDraft(authorIntent || '');
  }, [authorIntent]);

  const createId = React.useCallback((): string => {
    try {
      // @ts-ignore - browser crypto may exist at runtime
      if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        // @ts-ignore
        return crypto.randomUUID();
      }
    } catch {}
    return `n-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  React.useEffect(() => {
    if (value && value.length > 0) {
      setTree(value);
    }
  }, [value]);

  const emit = (nodes: ExegeticalPlanNode[]) => {
    setTree(nodes);
    onChange?.(nodes);
  };

  const addMainPoint = () => {
    const newNode: ExegeticalPlanNode = { id: createId(), title: '', children: [] };
    emit([...(tree || []), newNode]);
  };

  const updateNodeTitle = (id: string, title: string) => {
    const recur = (nodes: ExegeticalPlanNode[]): ExegeticalPlanNode[] => nodes.map(n => (
      n.id === id ? { ...n, title } : { ...n, children: n.children ? recur(n.children) : [] }
    ));
    emit(recur(tree));
  };

  const removeNode = (id: string) => {
    const recur = (nodes: ExegeticalPlanNode[]): ExegeticalPlanNode[] => nodes
      .filter(n => n.id !== id)
      .map(n => ({ ...n, children: n.children ? recur(n.children) : [] }));
    emit(recur(tree));
  };

  const addChild = (parentId: string) => {
    const newNode: ExegeticalPlanNode = { id: createId(), title: '', children: [] };
    const recur = (nodes: ExegeticalPlanNode[]): ExegeticalPlanNode[] => nodes.map(n => (
      n.id === parentId ? { ...n, children: [...(n.children || []), newNode] } : { ...n, children: n.children ? recur(n.children) : [] }
    ));
    emit(recur(tree));
    setExpand(prev => ({ ...prev, [parentId]: true }));
  };

  const addSibling = (siblingId: string) => {
    const newNode: ExegeticalPlanNode = { id: createId(), title: '', children: [] };
    const recur = (nodes: ExegeticalPlanNode[]): ExegeticalPlanNode[] => {
      const out: ExegeticalPlanNode[] = [];
      nodes.forEach(n => {
        const updated = n.children && n.children.length
          ? { ...n, children: recur(n.children) }
          : n;
        out.push(updated);
        if (n.id === siblingId) out.push(newNode);
      });
      return out;
    };
    emit(recur(tree));
  };

  const handleSave = async () => {
    await onSave?.(tree);
  };
  
  const toggleBranch = (id: string) => setExpand(prev => ({ ...prev, [id]: !(prev[id] ?? true) }));

  const TreeNode: React.FC<TreeNodeProps> = ({ node, depth = 0 }) => {
    const isOpen = expand[node.id] ?? true;
    const currentValue = draftTitles[node.id] !== undefined ? draftTitles[node.id] : (node.title || '');
    const isDirty = currentValue !== (node.title || '');
    const inputRef = React.useRef<HTMLInputElement>(null);
    return (
      <div className="relative" style={{ marginLeft: depth * 12 }}>

        <div className="group relative flex items-center">
          <button
            onClick={() => addSibling(node.id)}
            aria-label="add sibling"
            title={t('wizard.steps.exegeticalPlan.builder.tooltips.addSibling') as string}
            className="absolute -left-3.5 top-1/2 -translate-y-1/2 z-10 w-6 h-6 rounded-full bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hidden group-hover:flex items-center justify-center shadow-sm"
          >
            <Plus className="w-4 h-4" />
          </button>
          <div className="w-full border-2 border-gray-300 dark:border-gray-600 rounded-3xl px-4 py-2 bg-white dark:bg-gray-800 shadow-sm pr-24">
            <input
              ref={inputRef}
              value={currentValue}
              onChange={(e) => {
                const val = e.target.value;
                setDraftTitles(prev => ({ ...prev, [node.id]: val }));
                setTimeout(() => {
                  if (focusedId === node.id) {
                    inputRef.current?.focus();
                  }
                }, 0);
              }}
              onFocus={() => setFocusedId(node.id)}
              onBlur={() => {
                // Keep track but allow blur; do not forcibly refocus here
                if (focusedId === node.id) setFocusedId(node.id);
              }}
              autoFocus={focusedId === node.id}
              className="w-full px-3 py-2 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-offset-0"
              placeholder={t('wizard.steps.exegeticalPlan.builder.placeholder') as string}
            />
          </div>

          {/* Right-side: only delete on hover */}
          <div className="absolute right-12 inset-y-0 hidden group-hover:flex items-center gap-2">
            <button onClick={() => removeNode(node.id)} aria-label="delete" title={t('wizard.steps.exegeticalPlan.builder.tooltips.delete') as string} className="w-7 h-7 rounded-full border-2 border-red-500 text-red-500 bg-white dark:bg-gray-900 flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* External right child add button */}
          <button onClick={() => addChild(node.id)} aria-label="add child" title={t('wizard.steps.exegeticalPlan.builder.tooltips.addChild') as string} className="absolute -right-3.5 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white dark:bg-gray-800 border-2 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hidden group-hover:flex items-center justify-center shadow-sm">
            <CornerDownRight className="w-4 h-4" />
          </button>
        </div>

        {isOpen && node.children && node.children.length > 0 ? (
          <div className="ml-3 pl-3">
            {node.children.map((child) => (
              <TreeNode key={child.id} node={child} depth={depth + 1} />
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Block diagram → exegetical plan */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <ListTree className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.blockDiagram.title')}</h4>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.exegeticalPlan.blockDiagram.description')}</li>
        </ul>
      </div>

      {/* Exegetical plan (single section + collapsible instruction) */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-1">
          <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.title')}</h4>
          <button
            type="button"
            onClick={() => setShowInstruction((s) => !s)}
            className={`ml-auto inline-flex items-center px-2 py-1 rounded text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
          >
            {showInstruction ? (t('wizard.steps.exegeticalPlan.instruction.hide') as string) : (t('wizard.steps.exegeticalPlan.instruction.show') as string)}
          </button>
        </div>
        <ul className="list-disc pl-5 mt-1 space-y-1 text-sm">
          <li>{t('wizard.steps.exegeticalPlan.intro')}</li>
        </ul>

        <AnimatePresence initial={false}>
          {showInstruction && (
            <motion.div
              key="exegetical-instruction"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease: 'easeInOut' }}
              style={{ overflow: 'hidden' }}
              className={`mt-3 p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}
            >
              <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} mb-2`}>
                {t('wizard.steps.exegeticalPlan.simpleStudy.note')}
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <ListTree className="w-4 h-4 text-gray-600 dark:text-gray-300" />
                    <h5 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.simpleStudy.title')}</h5>
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.definition')}</li>
                    <li>
                      {t('wizard.steps.exegeticalPlan.simpleStudy.requirementsIntro')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req1')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req2')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req3')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.simpleStudy.req4')}</li>
                      </ul>
                    </li>
                    <li>{t('wizard.steps.exegeticalPlan.simpleStudy.goal')}</li>
                  </ul>
                </div>

                <div className={`p-3 rounded-md border ${UI_COLORS.accent.border} dark:${UI_COLORS.accent.darkBorder} ${UI_COLORS.accent.bg} dark:${UI_COLORS.accent.darkBg}`}>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className={`w-4 h-4 ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText}`} />
                    <h5 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.exampleTitle')}</h5>
                  </div>
                  <p className={`text-xs ${UI_COLORS.accent.text} dark:${UI_COLORS.accent.darkText} mb-2`}>{t('wizard.steps.exegeticalPlan.exampleHint')}</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>{t('wizard.steps.exegeticalPlan.example.topic')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.example.iCommand')}</li>
                    <li>{t('wizard.steps.exegeticalPlan.example.iiPurpose')}</li>
                    <li>
                      {t('wizard.steps.exegeticalPlan.example.iiiCharacter')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>
                          {t('wizard.steps.exegeticalPlan.example.notEvidenceTitle')}
                          <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceA')}</li>
                            <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceB')}</li>
                            <li>{t('wizard.steps.exegeticalPlan.example.notEvidenceC')}</li>
                          </ul>
                        </li>
                        <li>
                          {t('wizard.steps.exegeticalPlan.example.evidenceTitle')}
                          <ul className="list-disc pl-5 mt-1 space-y-1">
                            <li>{t('wizard.steps.exegeticalPlan.example.evidenceA')}</li>
                            <li>{t('wizard.steps.exegeticalPlan.example.evidenceB')}</li>
                          </ul>
                        </li>
                      </ul>
                    </li>
                    <li>
                      {t('wizard.steps.exegeticalPlan.example.ivExample')}
                      <ul className="list-disc pl-5 mt-1 space-y-1">
                        <li>{t('wizard.steps.exegeticalPlan.example.holyWomen')}</li>
                        <li>{t('wizard.steps.exegeticalPlan.example.sarah')}</li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Builder */}
        <div className="mt-3 p-3 rounded-md border border-gray-300 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h5 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.builder.title')}</h5>
            <div className="flex items-center gap-2">
              {(!tree || tree.length === 0) && (
              <button onClick={addMainPoint} title={t('wizard.steps.exegeticalPlan.builder.tooltips.addMain') as string} className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white">
                  {t('wizard.steps.exegeticalPlan.builder.addMainPoint')}
                </button>
              )}
              {(tree && tree.length > 0) && (
                <button onClick={handleSave} disabled={!!saving} className="px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-60">
                  {saving ? t('buttons.saving') : t('buttons.save')}
                </button>
              )}
            </div>
          </div>
          {(!tree || tree.length === 0) ? (
            <div className="text-xs text-gray-600 dark:text-gray-300">{t('wizard.steps.exegeticalPlan.builder.empty')}</div>
          ) : (
            <div className="space-y-2">
              {tree.map((n) => (
                <TreeNode key={n.id} node={n} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Author intent */}
      <div className={`p-3 rounded-md border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder} ${UI_COLORS.neutral.bg} dark:${UI_COLORS.neutral.darkBg}`}>
        <div className="flex items-center gap-2 mb-2">
          <Info className="w-4 h-4 text-gray-600 dark:text-gray-300" />
          <h4 className="text-sm font-semibold">{t('wizard.steps.exegeticalPlan.authorIntent.title')}</h4>
        </div>
        <div className={`text-xs ${UI_COLORS.muted.text} dark:${UI_COLORS.muted.darkText} mb-2`}>
          {t('wizard.steps.exegeticalPlan.authorIntent.description')}
        </div>
        <textarea
          className="w-full mt-1 text-sm rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 focus:outline-none focus:ring-2 focus:ring-offset-0"
          rows={3}
          placeholder={t('wizard.steps.exegeticalPlan.authorIntent.placeholder') as string}
          value={authorIntentDraft}
          onChange={(e) => {
            setAuthorIntentDraft(e.target.value);
          }}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {(authorIntentDraft !== (authorIntent || '')) && (
            <>
              <button
                type="button"
                onClick={async () => {
                  if (!onSaveAuthorIntent) return;
                  try {
                    setIsSavingAuthorIntent(true);
                    await onSaveAuthorIntent(authorIntentDraft);
                  } finally {
                    setIsSavingAuthorIntent(false);
                  }
                }}
                disabled={isSavingAuthorIntent}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-semibold shadow-sm ${UI_COLORS.button.primary.bg} ${UI_COLORS.button.primary.hover} dark:${UI_COLORS.button.primary.darkBg} dark:${UI_COLORS.button.primary.darkHover} ${UI_COLORS.button.primary.text}`}
                title={t('actions.save') || 'Save'}
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setAuthorIntentDraft(authorIntent || '')}
                className={`inline-flex items-center justify-center px-3 py-1.5 rounded-md text-xs font-medium border ${UI_COLORS.neutral.border} dark:${UI_COLORS.neutral.darkBorder}`}
                title={t('actions.cancel') || 'Cancel'}
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ExegeticalPlanStepContent;


