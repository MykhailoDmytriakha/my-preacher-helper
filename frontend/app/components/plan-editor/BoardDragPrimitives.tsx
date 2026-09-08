'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';

import { isDropTargetEnabled, type DragKind } from '@/utils/boardDnd';

import type React from 'react';

/**
 * A card that can be picked up. The listeners go on the HANDLE, not the card, so
 * double-clicking the text to rename still works and a drag never starts from a
 * stray click inside an input.
 */
export function DraggableCard({
  dragId,
  disabled,
  children,
}: {
  dragId: string;
  disabled?: boolean;
  children: (state: {
    setNodeRef: (node: HTMLElement | null) => void;
    handleProps: Record<string, unknown>;
    isDragging: boolean;
  }) => React.ReactNode;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: dragId, disabled });
  return (
    <>
      {children({
        setNodeRef,
        handleProps: disabled ? {} : { ...attributes, ...listeners },
        isDragging,
      })}
    </>
  );
}

/**
 * A place a card can be dropped into.
 *
 * `activeKind` is what makes the board quiet: a target that cannot accept the
 * thing currently in the air is disabled outright, so it never highlights and
 * never competes for the pointer. Nothing is dragging → nothing is a target,
 * which is why the resting board shows no drop zones at all.
 */
export function DropZone({
  dropId,
  disabled,
  activeKind,
  render,
}: {
  dropId: string;
  disabled?: boolean;
  activeKind: DragKind | null;
  render: (state: {
    setNodeRef: (node: HTMLElement | null) => void;
    isOver: boolean;
    isCandidate: boolean;
  }) => React.ReactNode;
}) {
  const isCandidate = activeKind !== null && isDropTargetEnabled(activeKind, dropId);
  /*
   * `disabled` here is ONLY about the board being read-only. It must never depend
   * on what is currently being dragged: dnd-kit measures the targets as the drag
   * begins, so a target that switches itself on at that same moment is measured
   * as absent and never collides with anything for the rest of the gesture.
   */
  const off = Boolean(disabled);
  const { setNodeRef, isOver } = useDroppable({ id: dropId, disabled: off });
  return <>{render({ setNodeRef, isOver: isOver && !off && isCandidate, isCandidate })}</>;
}
