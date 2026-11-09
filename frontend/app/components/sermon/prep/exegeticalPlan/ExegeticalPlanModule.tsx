'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import ConfirmModal from '@/components/ui/ConfirmModal';
import { failureCode } from '@/utils/failureCode';
import { useTranslation } from '@locales/useTranslation';

import { AuthorIntentField } from './AuthorIntentField';
import BlockDiagramSection from './BlockDiagramSection';
import InstructionSection from './InstructionSection';
import TreeBuilder from './TreeBuilder';
import {
  createNewNode,
  syncDraftTitles,
  mergeDraftTitles,
  removeNode,
  addChildNode,
  addSiblingNode,
  promoteNode,
  demoteNode,
  areTreesEqual,
  setNodeTitle,
  findPlace,
  findNode,
  insertNode,
  previousSiblingId
} from './treeUtils';


import type { ExegeticalPlanModuleProps, PlanEdit } from './types';
import type { ExegeticalPlanNode } from '@/models/models';

interface RemovalQuestion {
  subject: unknown;
  node: ExegeticalPlanNode;
}

interface RemovalState {
  question: RemovalQuestion;
  phase: 'confirm' | 'saving' | 'failed';
  applied: boolean;
  decisionKey?: string;
}

const NO_DRAFT_TITLES: Record<string, string> = {};

const ExegeticalPlanModule: React.FC<ExegeticalPlanModuleProps> = ({
  value = [],
  subject,
  onEdit,
  onCommitRemoval,
  onRetryRemoval,
  onSave,
  saving,
  authorIntentField,
  pointHistory,
  sermonId,
  sourceNoteIds
}) => {
  const { t } = useTranslation();
  const [deletion, setDeletion] = useState<RemovalState | null>(null);
  const runningRemovals = useRef(new Set<unknown>());
  const removal = deletion?.question.subject === subject ? deletion : null;
  const removing = removal?.phase === 'saving';
  const removalFailed = removal?.phase === 'failed';
  const retryRequired = removalFailed && removal.applied && !removal.decisionKey;
  useEffect(() => {
    setDeletion(current => current?.question.subject === subject ? current : null);
  }, [subject]);
  const [showInstruction, setShowInstruction] = useState(false);
  // An empty plan shows one line to type into; it joins the plan once it is edited.
  const [blankPlan, setBlankPlan] = useState<ExegeticalPlanNode[]>(() => [createNewNode()]);
  const [draftTree, setDraftTree] = useState<ExegeticalPlanNode[]>(() =>
    (value && value.length > 0) ? value : blankPlan
  );
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>(() =>
    syncDraftTitles((value && value.length > 0) ? value : blankPlan)
  );
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(true);

  const prevSavingRef = useRef<boolean>(saving);
  const lastSavedTreeRef = useRef<ExegeticalPlanNode[] | null>(null);

  /*
   * On the data engine (`onEdit`) the plan is the open sermon document's: every edit goes into it at
   * once, and the engine saves it (after a short pause, when the page is hidden, when it is left),
   * merges it with other devices and shows conflicts. This screen keeps no copy of its own, so no
   * save can bring an older one back over newer words (BUG-20261010-exegetical-plan-save-wipes-newer-words).
   * Without the engine the module keeps its own draft and saves it with the button or the autosave.
   */
  const showsBlank = !(value && value.length > 0);
  const tree = onEdit ? (showsBlank ? blankPlan : value) : draftTree;
  const apply = useCallback((edit: PlanEdit, titleNodeId?: string): Promise<void> | void => {
    if (!onEdit) { setDraftTree(edit); return; }
    // The blank line joins the plan only through an action on it, i.e. while the screen shows it.
    const update: PlanEdit = nodes => edit(nodes.length === 0 && showsBlank ? blankPlan : nodes);
    const outcome = titleNodeId ? onEdit(update, titleNodeId) : onEdit(update);
    // A refusal is shown by the document's own status; the title field also lets go of the words.
    if (outcome instanceof Promise) outcome.catch(() => undefined);
    return outcome;
  }, [onEdit, blankPlan, showsBlank]);
  // Once the blank line is in the plan it is a real point: an empty plan later starts from a new
  // line, so a point deleted here and changed on another device never comes back under its identity.
  useEffect(() => {
    if (onEdit && findPlace(value, blankPlan[0].id)) setBlankPlan([createNewNode()]);
  }, [onEdit, value, blankPlan]);

  // 1. Memoized values
  const hasUnsavedChanges = useMemo(() => {
    if (onEdit) return false;
    const currentTreeWithDrafts = mergeDraftTitles(draftTree, draftTitles);
    return !areTreesEqual(currentTreeWithDrafts, value || []);
  }, [onEdit, draftTree, draftTitles, value]);


  // 2. Callbacks
  const handleTitleChange = useCallback((id: string, title: string) => {
    if (!onEdit) { setDraftTitles(prev => ({ ...prev, [id]: title })); return; }
    // The words go to the point the person sees. If another device deleted it and this screen has
    // not redrawn yet, the point comes back with the words in its place instead of losing them.
    const place = findPlace(tree, id);
    return apply(nodes => findPlace(nodes, id) || !place
      ? setNodeTitle(nodes, id, title)
      : insertNode(nodes, place, { id, title, children: [] }), id);
  }, [onEdit, apply, tree]);

  const handleAddMainPoint = useCallback(() => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    apply(nodes => [...nodes, newNode]);
  }, [apply]);

  const handleRemoveNode = (id: string) => {
    const node = findNode(tree, id);
    if (node && !runningRemovals.current.has(subject)) {
      setDeletion({ question: { subject, node }, phase: 'confirm', applied: false });
    }
  };
  const closeRemoval = () => {
    if (!runningRemovals.current.has(subject) && !retryRequired) setDeletion(null);
  };
  const confirmRemoval = async () => {
    if (!removal || removal.decisionKey || runningRemovals.current.has(subject)) return;
    const { question } = removal;
    const { node } = question;
    if (!removal.applied && JSON.stringify(findNode(tree, node.id)) !== JSON.stringify(node)) {
      closeRemoval();
      return;
    }
    const cut: PlanEdit = nodes => removeNode(nodes, node.id);
    if (!onCommitRemoval || (!removal.applied && showsBlank && node.id === blankPlan[0].id)) {
      if (!onEdit) {
        const remaining = syncDraftTitles(cut(tree));
        setDraftTitles(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => Object.hasOwn(remaining, id))));
      }
      apply(cut);
      closeRemoval();
      return;
    }

    runningRemovals.current.add(subject);
    setDeletion({ ...removal, phase: 'saving' });
    let applied = removal.applied;
    let changed = false;
    try {
      if (applied && onRetryRemoval) {
        await onRetryRemoval();
      } else {
        await onCommitRemoval(nodes => {
          if (JSON.stringify(findNode(nodes, node.id)) !== JSON.stringify(node)) {
            changed = true;
            throw Object.assign(new Error('The confirmed plan point changed'), { code: 'decision-changed' });
          }
          applied = true;
          return cut(nodes);
        }, node.id);
      }
      setDeletion(current => current?.question === question ? null : current);
    } catch (error) {
      const code = failureCode(error);
      const decisionKey = code === 'resolve-version-first' ? 'dataSync.failure.resolveVersionFirst'
        : code === 'pending-delivery-first' ? 'dataSync.failure.pendingDeliveryFirst' : undefined;
      setDeletion(current => {
        if (current?.question !== question) return current;
        return changed ? null : { question, phase: 'failed', applied, decisionKey };
      });
    } finally {
      runningRemovals.current.delete(subject);
    }
  };

  const handleAddChild = useCallback((parentId: string) => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    apply(nodes => addChildNode(nodes, parentId, newNode));
    setExpand(prev => ({ ...prev, [parentId]: true }));
  }, [apply]);

  const handleAddSibling = useCallback((siblingId: string) => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    apply(nodes => addSiblingNode(nodes, siblingId, newNode));
  }, [apply]);

  const handlePromote = useCallback((id: string) => {
    // From under the parent the person sees; a point moved elsewhere meanwhile stays where it is.
    const from = findPlace(tree, id)?.parentId;
    if (!from) return;
    apply(nodes => promoteNode(nodes, id, from));
  }, [tree, apply]);

  const handleDemote = useCallback((id: string) => {
    // Under the point the person sees above it, wherever the newest plan has put things meanwhile.
    const under = previousSiblingId(tree, id);
    if (!under) return;
    apply(nodes => demoteNode(nodes, id, under));
    setExpand(prev => ({ ...prev, [under]: true }));
  }, [tree, apply]);

  const handleSave = useCallback(async () => {
    const treeWithTitles = mergeDraftTitles(draftTree, draftTitles);
    await onSave?.(treeWithTitles);
  }, [draftTree, draftTitles, onSave]);


  // 3. Effects
  // Sync with external value after successful save (own draft only)
  useEffect(() => {
    const wasSaving = prevSavingRef.current;
    prevSavingRef.current = saving;
    if (onEdit) return;

    if (wasSaving && !saving && value && value.length > 0) {
      const currentTreeWithDrafts = mergeDraftTitles(draftTree, draftTitles);
      if (!areTreesEqual(currentTreeWithDrafts, value)) {
        setDraftTree(value);
        setDraftTitles(syncDraftTitles(value));
      }
    }
  }, [onEdit, saving, value, draftTree, draftTitles]);

  // Auto-save logic (own draft only)
  useEffect(() => {
    if (onEdit || !autoSaveEnabled || !hasUnsavedChanges || saving) return;

    const currentTreeWithDrafts = mergeDraftTitles(draftTree, draftTitles);

    if (lastSavedTreeRef.current && areTreesEqual(currentTreeWithDrafts, lastSavedTreeRef.current)) {
      return;
    }

    const timer = setTimeout(() => {
      handleSave();
      lastSavedTreeRef.current = currentTreeWithDrafts;
    }, 15000); // 15 seconds

    return () => clearTimeout(timer);
  }, [onEdit, autoSaveEnabled, hasUnsavedChanges, saving, draftTree, draftTitles, handleSave]);

  return (
    <div className="space-y-4">
      <ConfirmModal isOpen={removal !== null}
        onClose={closeRemoval} onConfirm={confirmRemoval}
        title={t('common.deleteItem.title')} description={t('common.deleteItem.description')}
        isDeleting={removing}
        closeDisabled={retryRequired}
        confirmDisabled={Boolean(removal?.decisionKey)}
        confirmText={t(removalFailed ? 'dataSync.retry' : 'common.delete')}
        cancelText={t(removalFailed ? 'common.close' : 'common.cancel')}>
        {removing && <p role="status">{t('dataSync.phase.savingLocally')}</p>}
        {removalFailed && <p role="alert">{t(removal.decisionKey ?? 'dataSync.phase.localFailure')}</p>}
      </ConfirmModal>
      <BlockDiagramSection sermonId={sermonId} sourceNoteIds={sourceNoteIds} />

      <InstructionSection
        isVisible={showInstruction}
        onToggle={() => setShowInstruction(s => !s)}
      />

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <TreeBuilder
          tree={tree}
          draftTitles={onEdit ? NO_DRAFT_TITLES : draftTitles}
          focusedId={focusedId}
          expand={expand}
          hasUnsavedChanges={hasUnsavedChanges}
          saving={!!saving}
          onTitleChange={handleTitleChange}
          onFocus={setFocusedId}
          onBlur={setFocusedId}
          onRemove={handleRemoveNode}
          onAddChild={handleAddChild}
          onAddSibling={handleAddSibling}
          onPromote={handlePromote}
          onDemote={handleDemote}
          onAddMainPoint={handleAddMainPoint}
          onSave={onEdit ? undefined : handleSave}
          autoSaveEnabled={autoSaveEnabled}
          onToggleAutoSave={() => setAutoSaveEnabled(v => !v)}
        />
        {pointHistory}
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        {authorIntentField && <AuthorIntentField key={authorIntentField.subject} binding={authorIntentField} />}
      </div>
    </div>
  );
};

export default ExegeticalPlanModule;
