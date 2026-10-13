import { createContext, useContext } from 'react';

import type { SermonOutline, Thought } from '@/models/models';

export type PlanMode = 'manual' | 'ai' | 'note';
export interface PlanTextContext { userId?: string; baselineByNodeId?: Record<string, string | null> }

/**
 * EVERY WRITE THE PLAN SCREENS MAKE, BEHIND ONE SEAM — the same arrangement as the structure
 * board (components/sermon/structureWriter.ts). The writer is useEnginePlanWriter, with its
 * per-cell rule and StaleWriteError; outside its provider every write is refused.
 */
export interface PlanWriter {
  savePlanText(sermonId: string, changedText: Record<string, string>, removedNodeIds?: string[], context?: PlanTextContext): Promise<void>;
  savePlanMode(sermonId: string, mode: PlanMode): Promise<void>;
  updateThought(sermonId: string, thought: Thought, baseThought: Thought | null): Promise<Thought>;
  updateSermonOutline(sermonId: string, outline: SermonOutline, baseOutline?: SermonOutline | null,
    onCollision?: 'refuse' | 'preferMine'): Promise<SermonOutline | null>;
}

const noWriter = (): Promise<never> => Promise.reject(new Error('No plan writer: render inside the engine PlanWriterContext.Provider'));

/** Outside its provider a plan screen can be drawn, but every write is refused out loud. */
export const PlanWriterContext = createContext<PlanWriter>({
  savePlanText: noWriter, savePlanMode: noWriter, updateThought: noWriter, updateSermonOutline: noWriter,
});

export function usePlanWriter(): PlanWriter {
  return useContext(PlanWriterContext);
}
