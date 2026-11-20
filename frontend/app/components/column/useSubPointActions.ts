'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useOutlineTitleDraft } from '@/components/plan-editor/OutlineTitleDrafts';
import { subPointDeletionNeedsConfirm } from '@/utils/subPoints';
import { capitalizeFirstLetter, changedCapitalizedTitle, normalizeCapitalizedTitle } from '@/utils/textNormalization';

import type { SubPoint } from '@/models/models';
import type { OutlineTitleVersion } from '@/utils/sermonNoteText';

export interface SubPointActionHandlers {
  subPoints: SubPoint[];
  outlinePointId: string;
  isPointLocked: boolean;
  onAdd: (outlinePointId: string, text: string) => void;
  onEdit: (outlinePointId: string, subPointId: string, newText: string, openingText: string, version?: OutlineTitleVersion) => Promise<unknown> | void;
  onTitleDraftChange?: (outlinePointId: string, active: boolean) => void;
  onDelete: (outlinePointId: string, subPointId: string) => void;
  getAffectedThoughtCount?: (subPointId: string) => number;
}

/**
 * Adding, renaming and removing a point's sub-points — one rule for every screen that shows them: the
 * sub-point list (the sidebar, the classic outline) and the structure page's lanes. A rename is bound to
 * the title the person opened (the outline title draft keeps typed words across a reload or a collision);
 * a sub-point with thoughts or words in it is removed only after the question. `active` is false while
 * the host does not show its sub-points, so its title draft does not claim the field.
 */
export function useSubPointActions({
  subPoints, outlinePointId, isPointLocked, onAdd, onEdit, onTitleDraftChange, onDelete, getAffectedThoughtCount,
}: SubPointActionHandlers, active = true) {
  const [isAdding, setIsAdding] = useState(false);
  const [addText, setAddTextRaw] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const openingTitle = useRef('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const titleDraft = useOutlineTitleDraft(active && subPoints.some(point => point.id === editingId) ? editingId : null);

  const hasTitleDraft = isAdding || editingId !== null;
  useLayoutEffect(() => {
    if (!onTitleDraftChange || !hasTitleDraft) return;
    onTitleDraftChange(outlinePointId, true);
    return () => onTitleDraftChange(outlinePointId, false);
  }, [hasTitleDraft, onTitleDraftChange, outlinePointId]);

  useEffect(() => {
    if (active && isAdding && addInputRef.current) addInputRef.current.focus();
  }, [isAdding, active]);

  useEffect(() => {
    if (active && editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId, active]);

  const cancelAdd = () => {
    setIsAdding(false);
    setAddTextRaw('');
  };
  const handleAdd = () => {
    // Locked while the field was open: nothing is written, and the typed words stay in the field.
    if (isPointLocked) return;
    const textToSave = normalizeCapitalizedTitle(addText);
    if (textToSave) onAdd(outlinePointId, textToSave);
    cancelAdd();
  };

  const handleEditSave = () => {
    if (isPointLocked) return;
    const textToSave = changedCapitalizedTitle(editText, openingTitle.current);
    if (editingId && textToSave) {
      const version = titleDraft.opening()?.version;
      titleDraft.handoff(onEdit(outlinePointId, editingId, textToSave, openingTitle.current, ...(version ? [version] : [])));
    }
    setEditingId(null);
    setEditText('');
  };
  const cancelEdit = () => {
    titleDraft.cancel();
    setEditingId(null);
    setEditText('');
  };
  const startEditing = (subPoint: SubPoint) => {
    if (isPointLocked) return;
    openingTitle.current = subPoint.text;
    titleDraft.open({ target: { kind: 'subpoint', id: subPoint.id }, text: subPoint.text }, subPoint.text);
    setEditingId(subPoint.id);
    setEditText(subPoint.text);
  };
  const changeEditText = (value: string) => {
    titleDraft.change(value);
    setEditText(capitalizeFirstLetter(value));
  };

  const requestDelete = (subPointId: string) => {
    if (isPointLocked) return;
    const count = getAffectedThoughtCount?.(subPointId) ?? 0;
    if (subPointDeletionNeedsConfirm(subPoints.find(subPoint => subPoint.id === subPointId), count)) setConfirmDeleteId(subPointId);
    else onDelete(outlinePointId, subPointId);
  };
  const confirmDelete = () => {
    if (confirmDeleteId && !isPointLocked) onDelete(outlinePointId, confirmDeleteId);
    setConfirmDeleteId(null);
  };

  return {
    isAdding, startAdding: () => setIsAdding(true), addText, setAddText: (value: string) => setAddTextRaw(capitalizeFirstLetter(value)),
    handleAdd, cancelAdd, addInputRef,
    editingId, editText, changeEditText, startEditing, handleEditSave, cancelEdit, editInputRef,
    confirmDeleteId, confirmThoughtCount: confirmDeleteId ? getAffectedThoughtCount?.(confirmDeleteId) ?? 0 : 0,
    requestDelete, confirmDelete, cancelDelete: () => setConfirmDeleteId(null),
  };
}
