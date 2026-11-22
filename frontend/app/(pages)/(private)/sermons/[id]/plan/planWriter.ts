import { createContext, useContext } from 'react';

import type { Sermon, SermonOutline, Thought } from '@/models/models';

export type PlanMode = NonNullable<Sermon['planMode']>;
export interface PlanTextContext { userId?: string; baselineByNodeId?: Record<string, string | null>; revisionsByNodeId?: Record<string, number | null>; orphaned?: true }
export interface SubpointTextTransfer {
  parentText: string;
  openingText: string;
  parentOpeningText: string;
  baselineByNodeId: Record<string, string | null>;
  revisionsByNodeId: Record<string, number | null>;
  draftCaptureScope?: string;
}

/**
 * EVERY WRITE THE PLAN SCREENS MAKE, BEHIND ONE SEAM — the same arrangement as the structure
 * board (components/sermon/structureWriter.ts). The writer is useEnginePlanWriter, with its
 * per-cell rule and StaleWriteError; outside its provider every write is refused.
 */
export interface PlanWriter {
  savePlanText(sermonId: string, changedText: Record<string, string>, removedNodeIds?: string[], context?: PlanTextContext): Promise<void>;
  discardPlanText?(nodeIds: readonly string[]): Promise<void>;
  restorePlanText?(cells: Record<string, string>): Promise<void>;
  applyPlanProposal?(cells: Record<string, string>, before: Record<string, string>): Promise<boolean> | null;
  savePlanMode(sermonId: string, mode: PlanMode): Promise<void>;
  preparePlanMode(sermonId: string, mode: PlanMode): () => Promise<void>;
  initializePlanMode(sermonId: string, mode: PlanMode): Promise<void>;
  removeSubPoint(sermonId: string, pointId: string, subPointId: string, transfer?: SubpointTextTransfer): Promise<
    { kind: 'removed'; outline: SermonOutline } | { kind: 'absent'; outline: SermonOutline | null; parentText?: string; sourceText?: string }
  >;
  captureOutlineUpdate(): Promise<void>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine'): Promise<SermonOutline | null>;
}

const noWriter = (): Promise<never> => Promise.reject(new Error('No plan writer: render inside the engine PlanWriterContext.Provider'));

/** Outside its provider a plan screen can be drawn, but every write is refused out loud. */
export const PlanWriterContext = createContext<PlanWriter>({
  savePlanText: noWriter, savePlanMode: noWriter, preparePlanMode: () => noWriter, initializePlanMode: noWriter, updateThought: noWriter, updateSermonOutline: noWriter, removeSubPoint: noWriter, captureOutlineUpdate: noWriter,
});

export function usePlanWriter(): PlanWriter {
  return useContext(PlanWriterContext);
}
