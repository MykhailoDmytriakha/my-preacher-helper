'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

import AuthorIntentSection from './AuthorIntentSection';
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
  areTreesEqual
} from './treeUtils';

import type { ExegeticalPlanModuleProps } from './types';
import type { ExegeticalPlanNode } from '@/models/models';

const ExegeticalPlanModule: React.FC<ExegeticalPlanModuleProps> = ({
  value = [],
  onSave,
  saving,
  authorIntent = '',
  onSaveAuthorIntent
}) => {
  const [showInstruction, setShowInstruction] = useState(false);
  const [tree, setTree] = useState<ExegeticalPlanNode[]>(() =>
    (value && value.length > 0) ? value : [createNewNode()]
  );
  const [draftTitles, setDraftTitles] = useState<Record<string, string>>(() => 
    syncDraftTitles((value && value.length > 0) ? value : [createNewNode()])
  );
  const [expand, setExpand] = useState<Record<string, boolean>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [authorIntentDraft, setAuthorIntentDraft] = useState<string>(authorIntent || '');
  const [isSavingAuthorIntent, setIsSavingAuthorIntent] = useState<boolean>(false);
  const prevSavingRef = useRef<boolean>(saving);

  useEffect(() => {
    setAuthorIntentDraft(authorIntent || '');
  }, [authorIntent]);

  // Sync with external value after successful save
  useEffect(() => {
    const wasSaving = prevSavingRef.current;
    prevSavingRef.current = saving;

    // Only sync when transitioning from saving to not saving
    if (wasSaving && !saving && value && value.length > 0) {
      const currentTreeWithDrafts = mergeDraftTitles(tree, draftTitles);
      if (!areTreesEqual(currentTreeWithDrafts, value)) {
        setTree(value);
        setDraftTitles(syncDraftTitles(value));
      }
    }
  }, [saving, value, tree, draftTitles]);

  const hasUnsavedChanges = useMemo(() => {
    const currentTreeWithDrafts = mergeDraftTitles(tree, draftTitles);
    return !areTreesEqual(currentTreeWithDrafts, value || []);
  }, [tree, draftTitles, value]);

  const hasAuthorIntentChanges = useMemo(() => {
    return authorIntentDraft !== (authorIntent || '');
  }, [authorIntentDraft, authorIntent]);

  const emit = useCallback((nodes: ExegeticalPlanNode[]) => {
    setTree(nodes);
  }, []);

  const handleTitleChange = useCallback((id: string, value: string) => {
    setDraftTitles(prev => ({ ...prev, [id]: value }));
  }, []);

  const handleAddMainPoint = useCallback(() => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    emit([...(tree || []), newNode]);
    setDraftTitles(prev => ({ ...prev, [newNode.id]: '' }));
  }, [tree, emit]);

  const handleRemoveNode = useCallback((id: string) => {
    const newTree = removeNode(tree, id);
    
    // Clean up draft titles for removed nodes
    const getAllNodeIds = (nodes: ExegeticalPlanNode[]): string[] => {
      const ids: string[] = [];
      nodes.forEach(node => {
        ids.push(node.id);
        if (node.children) {
          ids.push(...getAllNodeIds(node.children));
        }
      });
      return ids;
    };
    
    const remainingIds = new Set(getAllNodeIds(newTree));
    setDraftTitles(prev => {
      const updated: Record<string, string> = {};
      Object.keys(prev).forEach(key => {
        if (remainingIds.has(key)) {
          updated[key] = prev[key];
        }
      });
      return updated;
    });
    
    setTree(newTree);
  }, [tree]);

  const handleAddChild = useCallback((parentId: string) => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    emit(addChildNode(tree, parentId, newNode));
    setExpand(prev => ({ ...prev, [parentId]: true }));
    setDraftTitles(prev => ({ ...prev, [newNode.id]: '' }));
  }, [tree, emit]);

  const handleAddSibling = useCallback((siblingId: string) => {
    const newNode = createNewNode();
    setFocusedId(newNode.id);
    emit(addSiblingNode(tree, siblingId, newNode));
    setDraftTitles(prev => ({ ...prev, [newNode.id]: '' }));
  }, [tree, emit]);

  const handleSave = useCallback(async () => {
    const treeWithTitles = mergeDraftTitles(tree, draftTitles);
    await onSave?.(treeWithTitles);
  }, [tree, draftTitles, onSave]);

  const handleSaveAuthorIntent = useCallback(async () => {
    if (!onSaveAuthorIntent) return;
    try {
      setIsSavingAuthorIntent(true);
      await onSaveAuthorIntent(authorIntentDraft);
    } finally {
      setIsSavingAuthorIntent(false);
    }
  }, [authorIntentDraft, onSaveAuthorIntent]);

  return (
    <div className="space-y-4">
      <BlockDiagramSection />

      <InstructionSection
        isVisible={showInstruction}
        onToggle={() => setShowInstruction(s => !s)}
      />

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <TreeBuilder
          tree={tree}
          draftTitles={draftTitles}
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
          onAddMainPoint={handleAddMainPoint}
          onSave={handleSave}
        />
      </div>

      <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
        <AuthorIntentSection
          value={authorIntentDraft}
          onChange={setAuthorIntentDraft}
          onSave={handleSaveAuthorIntent}
          isSaving={isSavingAuthorIntent}
          hasChanges={hasAuthorIntentChanges}
        />
      </div>
    </div>
  );
};

export default ExegeticalPlanModule;
