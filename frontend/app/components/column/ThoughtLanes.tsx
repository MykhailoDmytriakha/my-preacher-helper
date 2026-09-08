"use client";

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import React from 'react';

import PointNote from '@/components/PointNote';
import { buildSubPointRenderableEntries } from '@/utils/subPoints';

import { BG_GRAY_LIGHT_DARK } from './constants';

import type { ThoughtItemRenderer, Translate } from './types';
import type { Item, SubPoint } from '@/models/models';

type SubPointRenderableEntry = ReturnType<typeof buildSubPointRenderableEntries<Item>>[number];

const getRenderableEntryPosition = (entry: SubPointRenderableEntry | null | undefined): number | undefined => {
  if (!entry) return undefined;

  if (entry.type === "item") {
    return typeof entry.item.position === "number" ? entry.item.position : undefined;
  }

  return typeof entry.subPoint.position === "number" ? entry.subPoint.position : undefined;
};

const getRenderableEntryFirstItemId = (entry: SubPointRenderableEntry | null | undefined): string | null => {
  if (!entry) return null;
  if (entry.type === "item") return entry.item.id;
  return entry.items[0]?.id ?? null;
};

const getRenderableEntryLastItemId = (entry: SubPointRenderableEntry | null | undefined): string | null => {
  if (!entry) return null;
  if (entry.type === "item") return entry.item.id;
  return entry.items[entry.items.length - 1]?.id ?? null;
};

const findPreviousRenderableItemId = (
  entries: SubPointRenderableEntry[],
  boundaryIndex: number,
): string | null => {
  for (let index = boundaryIndex - 1; index >= 0; index -= 1) {
    const itemId = getRenderableEntryLastItemId(entries[index]);
    if (itemId) return itemId;
  }
  return null;
};

const findNextRenderableItemId = (
  entries: SubPointRenderableEntry[],
  boundaryIndex: number,
): string | null => {
  for (let index = boundaryIndex; index < entries.length; index += 1) {
    const itemId = getRenderableEntryFirstItemId(entries[index]);
    if (itemId) return itemId;
  }
  return null;
};

const OutlinePointDropSlot: React.FC<{
  slotId: string;
  containerId: string;
  outlinePointId: string;
  beforeItemId?: string | null;
  afterItemId?: string | null;
  prevPosition?: number;
  nextPosition?: number;
  activeId?: string | null;
  t: Translate;
}> = ({
  slotId,
  containerId,
  outlinePointId,
  beforeItemId,
  afterItemId,
  prevPosition,
  nextPosition,
  activeId,
}) => {
  const { setNodeRef } = useDroppable({
    id: `outline-gap-${slotId}`,
    data: {
      container: containerId,
      outlinePointId,
      subPointId: null,
      beforeItemId: beforeItemId ?? undefined,
      afterItemId: afterItemId ?? undefined,
      prevPosition,
      nextPosition,
    },
  });
  const hasActiveDrag = Boolean(activeId);

  // Invisible droppable — collision detection only, no visual chrome.
  // Items rearrange in real-time via live preview state updates.
  // Larger hit area during drag so users can target the gap between subpoints.
  return (
    <div
      ref={setNodeRef}
      data-testid={`outline-gap-${slotId}`}
      className={`transition-all duration-150 ${hasActiveDrag ? "min-h-[24px]" : "min-h-[4px]"}`}
    />
  );
};

// Drop zone with sub-point grouping (visual headers only, no nested drop targets)
const SubPointDropTarget: React.FC<{
  subPoint: SubPoint;
  items: Item[];
  containerId: string;
  outlinePointId: string;
  renderItem: (item: Item) => React.ReactNode;
  activeId?: string | null;
  t: Translate;
  renderRecorder?: (subPoint: SubPoint) => React.ReactNode;
  showNotes?: boolean;
  isReadOnly?: boolean;
  onEditNote?: (note?: string) => void;
}> = ({ subPoint, items, containerId, outlinePointId, renderItem, activeId, t, renderRecorder, showNotes = false, isReadOnly = false, onEditNote }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `sub-point-${subPoint.id}`,
    data: {
      container: containerId,
      outlinePointId,
      subPointId: subPoint.id,
    },
  });
  const hasActiveDrag = Boolean(activeId);
  const isHovered = isOver && hasActiveDrag;

  return (
    <div
      ref={setNodeRef}
      data-testid={`sub-point-drop-${subPoint.id}`}
      className={`relative ml-3 rounded-2xl border px-3 py-3 shadow-sm transition-all duration-200 ${
        isHovered
          ? "border-blue-300 bg-blue-50/50 ring-1 ring-blue-200/50 dark:border-blue-600 dark:bg-blue-900/15 dark:ring-blue-700/30"
          : "border-slate-200/90 bg-slate-50/90 dark:border-slate-700/70 dark:bg-slate-900/30"
      }`}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-3 left-3 top-3 w-px rounded-full ${
          isHovered ? "bg-blue-300 dark:bg-blue-500" : "bg-slate-300/90 dark:bg-slate-600/90"
        }`}
      />
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute bottom-3 left-3 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${
          isHovered ? "bg-blue-400 dark:bg-blue-400" : "bg-slate-400 dark:bg-slate-500"
        }`}
      />
      <div className="relative flex flex-wrap items-center justify-between gap-2 pl-4 pr-1">
        <div className="flex min-w-0 flex-1 basis-24 items-center gap-2">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
              isHovered ? "bg-blue-400 dark:bg-blue-400" : "bg-slate-400 dark:bg-slate-500"
            }`}
          />
          <span className="min-w-0 truncate text-xs font-semibold text-slate-600 dark:text-slate-300" title={subPoint.text}>
            {subPoint.text}
          </span>
        </div>
        {renderRecorder ? (
          <div className="shrink-0">
            {renderRecorder(subPoint)}
          </div>
        ) : null}
      </div>
      {showNotes && (
        <div className="mt-1 pl-4 pr-1">
          <PointNote
            note={subPoint.note}
            onChange={(note) => onEditNote?.(note)}
            isReadOnly={isReadOnly}
            addRevealClass="opacity-100"
          />
        </div>
      )}
      <div
        data-testid={`sub-point-lane-${subPoint.id}`}
        className="relative mt-3 space-y-4 pl-4 pr-1"
      >
        {items.length > 0 && items.map(renderItem)}
        {items.length === 0 && (
          <div className={`min-h-[40px] rounded border border-dashed px-4 py-2 text-center text-sm ${
            isHovered
              ? "border-blue-300 text-blue-400 dark:border-blue-600 dark:text-blue-400"
              : "border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500"
          }`}>
            {t("structure.dropThoughtsHere")}
          </div>
        )}
      </div>
    </div>
  );
};

export const PointThoughtLane: React.FC<{
  setNodeRef: (node: HTMLElement | null) => void;
  isOver: boolean;
  pointItems: Item[];
  subPoints: SubPoint[];
  containerId: string;
  outlinePointId: string;
  hasItems: boolean;
  renderItem: ThoughtItemRenderer;
  activeId?: string | null;
  renderSubPointRecorder?: (subPoint: SubPoint) => React.ReactNode;
  showNotes?: boolean;
  isPointLocked?: boolean;
  onSetSubPointNote?: (outlinePointId: string, subPointId: string, note?: string) => void;
  t: Translate;
}> = ({
  setNodeRef, isOver, pointItems, subPoints, containerId, outlinePointId, hasItems,
  renderItem, activeId, renderSubPointRecorder, showNotes = false, isPointLocked = false, onSetSubPointNote, t
}) => {
  const hasSubPoints = subPoints.length > 0;

  // Interleave items and sub-point headers sorted by position
  const renderOrder = buildSubPointRenderableEntries(pointItems, subPoints);

  return (
    <div
      ref={setNodeRef}
      className={`min-h-[80px] p-4 transition-all ${isOver ? 'ring-1 ring-blue-300/40 dark:ring-blue-500/30' : ''}`}
    >
      {!hasItems && !hasSubPoints ? (
        <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all">
          {t('structure.dropThoughtsHere')}
        </div>
      ) : (
        <SortableContext items={pointItems} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {renderOrder.map((entry, entryIndex) => {
              const nextEntry = entryIndex < renderOrder.length - 1 ? renderOrder[entryIndex + 1] : null;
              const gapSlot = hasSubPoints && nextEntry ? (
                <OutlinePointDropSlot
                  key={`gap-${outlinePointId}-${entryIndex + 1}`}
                  slotId={`${outlinePointId}-${entryIndex + 1}`}
                  containerId={containerId}
                  outlinePointId={outlinePointId}
                  afterItemId={findPreviousRenderableItemId(renderOrder, entryIndex + 1)}
                  beforeItemId={findNextRenderableItemId(renderOrder, entryIndex + 1)}
                  prevPosition={getRenderableEntryPosition(entry)}
                  nextPosition={getRenderableEntryPosition(nextEntry)}
                  activeId={activeId}
                  t={t}
                />
              ) : null;

              if (entry.type === 'item') {
                return (
                  <React.Fragment key={`item-${entry.item.id}`}>
                    {renderItem(entry.item, null)}
                    {gapSlot}
                  </React.Fragment>
                );
              }
              const { subPoint: sp, items: spItems } = entry;
              return (
                <React.Fragment key={`spg-${sp.id}`}>
                  <SubPointDropTarget
                    subPoint={sp}
                    items={spItems}
                    containerId={containerId}
                    outlinePointId={outlinePointId}
                    renderItem={(item) => renderItem(item, sp.text)}
                    activeId={activeId}
                    t={t}
                    renderRecorder={renderSubPointRecorder}
                    showNotes={showNotes}
                    isReadOnly={isPointLocked}
                    onEditNote={(note) => onSetSubPointNote?.(outlinePointId, sp.id, note)}
                  />
                  {gapSlot}
                </React.Fragment>
              );
            })}

            {/* Minimal spacer at bottom for collision detection */}
          </div>
        </SortableContext>
      )}
    </div>
  );
};

// Component for rendering unassigned thoughts drop target
export const UnassignedThoughtLane: React.FC<{
  items: Item[];
  renderItem: ThoughtItemRenderer;
  containerId: string;
  t: Translate;
}> = ({
  items,
  renderItem,
  containerId,
  t,
}) => {
    const { setNodeRef, isOver } = useDroppable({
      id: `unassigned-${containerId}`,
      data: { container: containerId, outlinePointId: null } // null means unassigned
    });

    return (
      <div
        ref={setNodeRef}
        className={`min-h-[80px] p-4 transition-all rounded-lg ${isOver ? 'bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-400 dark:ring-blue-500' : BG_GRAY_LIGHT_DARK
          }`}
      >
        {items.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 text-sm py-6 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all">
            {t('structure.dropToUnassign', { defaultValue: 'Drop thoughts here to unassign them from structure points' })}
          </div>
        ) : (
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <div className="space-y-4">
              {items.map(item => renderItem(item))}

              {/* Additional drop area at the end for consistency */}
              <div className={`text-center text-gray-400 dark:text-gray-500 text-sm py-4 mt-2 px-4 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded transition-all ${isOver ? 'border-blue-400 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20' : ''
                }`}>
                {t('structure.dropToUnassign')}
              </div>
            </div>
          </SortableContext>
        )}
      </div>
    );
  };
